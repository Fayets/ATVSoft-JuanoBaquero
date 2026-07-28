import re
from datetime import date, datetime, time, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.lead_display_utils import lead_display_nombre
from src.lead_formulario import merge_formulario, normalize_formulario
from src.models import CallReport as CallReportEntity
from src.models import Lead as LeadEntity, ReelContent, StorySequence, YoutubeContent
from src.schemas import (
    LeadCreateRequest,
    LeadOut,
    LeadPatchRequest,
    LeadsListResponse,
    LeadsMetricsOut,
    LlamadasHoyOut,
    ManualCallCreateRequest,
)
from src.services.agent_closer_service import AR_TZ, list_llamadas_dia, list_llamadas_hoy
from src.services.programs_services import (
    build_program_norm_price_map,
    program_price_usd_for_prog_raw,
)
from src.services.call_report_service import (
    analyze_call_report,
    get_or_create_report,
    is_fathom_link,
    normalize_fathom_url,
)

router = APIRouter(prefix="/api/leads", tags=["leads"], redirect_slashes=False)

_AR = ZoneInfo("America/Argentina/Buenos_Aires")

_STORY_AGENDA_PREFIX = "story:"
_YOUTUBE_AGENDA_PREFIX = "youtube:"


def _normalize_channel_anchor_value(user_id_int: int, raw: str | None) -> str:
    """Valor canónico para `punto_agenda`: bio, reel id, story:<id>, youtube:<id>, texto libre."""
    s = (str(raw) if raw is not None else "").strip()
    if not s:
        return ""
    low = s.casefold()
    if low == "bio":
        return "bio"
    if low.startswith(_STORY_AGENDA_PREFIX):
        rest = s[len(_STORY_AGENDA_PREFIX) :].strip()
        try:
            sid = int(rest)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="punto_agenda de historia inválido.",
            ) from None
        try:
            seq = StorySequence.get(id=sid)
        except ObjectNotFound as e:
            raise HTTPException(
                status_code=400,
                detail="Secuencia de historia no encontrada.",
            ) from e
        if int(seq.user_id) != user_id_int:
            raise HTTPException(status_code=400, detail="Secuencia de historia no encontrada.")
        return f"{_STORY_AGENDA_PREFIX}{sid}"
    if low.startswith(_YOUTUBE_AGENDA_PREFIX):
        rest = s[len(_YOUTUBE_AGENDA_PREFIX) :].strip()
        try:
            yid = int(rest)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Referencia de YouTube inválida (usar youtube:<id>).",
            ) from None
        try:
            yrow = YoutubeContent.get(id=yid)
        except ObjectNotFound as e:
            raise HTTPException(status_code=400, detail="Video de YouTube no encontrado.") from e
        if int(yrow.user_id) != user_id_int:
            raise HTTPException(status_code=400, detail="Video de YouTube no encontrado.")
        return f"{_YOUTUBE_AGENDA_PREFIX}{yid}"
    try:
        rid = int(s)
    except ValueError:
        rid = None
    if rid is not None:
        try:
            row = ReelContent.get(id=rid, user_id=user_id_int)
            return str(row.id)
        except ObjectNotFound:
            pass
        try:
            seq = StorySequence.get(id=rid)
        except ObjectNotFound:
            seq = None
        if seq is not None and int(seq.user_id) == user_id_int:
            return f"{_STORY_AGENDA_PREFIX}{rid}"
    try:
        insta_row = ReelContent.get(instagram_id=s)
    except ObjectNotFound:
        insta_row = None
    if insta_row is not None and int(insta_row.user_id) == user_id_int:
        return str(insta_row.id)
    return s


def _normalize_punto_agenda_value(user_id_int: int, raw: str | None) -> str:
    """Normaliza `punto_agenda`: reel, historia, youtube, bio, u otro texto."""
    return _normalize_channel_anchor_value(user_id_int, raw)


def _lead_effective_dt(row: LeadEntity) -> datetime | None:
    """Fecha para mes AR y orden en listados.
    Prioridad: call (fecha real de la llamada) > agendo > fecha_bot > created_at.
    Un lead que agenda en junio pero tiene la llamada en julio aparece en julio,
    porque el cierre y la facturación pertenecen al mes de la llamada."""
    return row.call or row.agendo or row.fecha_bot or row.created_at


def _lead_month_ar(row: LeadEntity) -> tuple[int, int] | None:
    """(año, mes) en Argentina; mismo criterio de calendario que métricas de reels."""
    dt = _lead_effective_dt(row)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_utc = dt.replace(tzinfo=timezone.utc)
    d_ar = d_utc.astimezone(_AR)
    return (d_ar.year, d_ar.month)


def _lead_month_string_ar(row: LeadEntity) -> str | None:
    """YYYY-MM del mes operativo (mismo criterio que GET /leads ?month=)."""
    mb = _lead_month_ar(row)
    if mb is None:
        return None
    y, m = mb
    return f"{y}-{m:02d}"


def _lead_sort_ts(row: LeadEntity) -> float:
    dt = _lead_effective_dt(row)
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return float(dt.replace(tzinfo=timezone.utc).timestamp())


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _dt_iso(dt: datetime | None) -> str | None:
    """Serializa datetimes de call/agenda como UTC con sufijo Z (sin ambigüedad local)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    # Naive en BD = UTC wall-clock (contrato Calendly/GHL normalizado).
    return dt.isoformat(timespec="seconds") + "Z"


def _agendo_en_looks_like_iso_datetime(val: str | None) -> bool:
    s = (val or "").strip()
    return bool(s) and bool(re.match(r"^\d{4}-\d{2}-\d{2}", s))


def _scheduled_at_from_row(row: LeadEntity) -> str | None:
    if row.call is not None:
        return _dt_iso(row.call)
    s = (row.agendo_en or "").strip()
    if _agendo_en_looks_like_iso_datetime(s):
        d = _parse_dt_in(s)
        return _dt_iso(d) if d else None
    return None


def _agendo_en_channel_for_api(row: LeadEntity) -> str | None:
    s = (row.agendo_en or "").strip()
    if _agendo_en_looks_like_iso_datetime(s):
        return "Chat"
    if s:
        return s
    if row.agendo is not None:
        return "Chat"
    return None


def _parse_dt_in(val: str | None) -> datetime | None:
    if val is None or not str(val).strip():
        return None
    s = str(val).strip()
    try:
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return datetime.fromisoformat(s[:10] + "T00:00:00")
        cleaned = s.replace("Z", "").split("+")[0]
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _to_lead_out(row: LeadEntity, norm_prices: dict[str, float] | None = None) -> LeadOut:
    st = (row.status or row.estado or "").strip() or "Pendiente"
    created = row.created_at
    if created is not None and created.tzinfo is not None:
        created = created.replace(tzinfo=None)
    date_s = created.date().isoformat() if created else date.today().isoformat()
    month_s = _lead_month_string_ar(row)
    if month_s is None and created is not None:
        month_s = f"{created.year}-{created.month:02d}"
    kw = row.keyword
    price_catalog = program_price_usd_for_prog_raw(norm_prices or {}, row.programa_ofrecido)
    return LeadOut(
        id=str(row.id),
        lead_user_id=str(row.user_id),
        client_name=lead_display_nombre(row.nombre, row.ig),
        ig_handle=row.ig,
        phone=row.telefono,
        avatar_type=row.avatar,
        status=st,
        origin=row.origen,
        entry_funnel=kw,
        keyword=kw,
        agenda_point=row.punto_agenda,
        fecha_bot=_dt_iso(row.fecha_bot),
        scheduled_at=_scheduled_at_from_row(row),
        agendo=_dt_iso(row.agendo),
        agendo_en=_agendo_en_channel_for_api(row),
        call_at=None,
        call=_dt_iso(row.call),
        call_link=row.link_llamada,
        closer_report=(row.closer_report or "").strip() or None,
        program_offered=row.programa_ofrecido,
        programada_ofrecido_llamada=(row.programada_ofrecido_llamada or "").strip() or None,
        program_price_usd=price_catalog,
        revenue=float(price_catalog or 0),
        payment=float(row.pago or 0),
        owed=float(row.debe or 0),
        closer=(row.closer or "").strip() or None,
        setter=(row.setter or "").strip() or None,
        notes=row.notas,
        date=date_s,
        month=month_s,
        email=(row.email or "").strip() or None,
        dolores_setting=row.dolores_setting,
        dolores_llamada=row.dolores_llamada,
        razon_compra=row.razon_compra,
        formulario=normalize_formulario(getattr(row, "formulario", None)),
        calendly_event_uri=None,
        calendly_invitee_uri=None,
        source_type=(
            "manual"
            if (row.origen or "").strip().casefold() == "manual"
            else "manychat"
            if (row.manychat_contact_id or "").strip()
            else "neon"
        ),
        content_url=row.content_url,
        manychat_contact_id=row.manychat_contact_id,
        respondio_auto=row.respondio_auto,
    )


@router.get("", response_model=LeadsListResponse)
def list_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; filtra por fecha_bot o created_at (mes AR); primer contacto no afecta el mes",
    ),
    include_all: bool = Query(
        default=False,
        description="Si true, incluye leads sin agendo (p. ej. conteos por origen en dashboard marketing).",
    ),
) -> LeadsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key: tuple[int, int] | None = None
    if month and str(month).strip():
        month_key = _parse_month_query(month)
        if month_key is None:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")

    with db_session:
        norm_prices = build_program_norm_price_map(uid)
        # Filtrar en query (evita cargar toda la tabla Lead).
        if include_all:
            q = LeadEntity.select(lambda r: r.user_id == uid)
        else:
            q = LeadEntity.select(lambda r: r.user_id == uid and r.agendo is not None)
        rows = list(q)
        if month_key is not None:
            year_m, month_m = month_key
            rows = [
                r
                for r in rows
                if (mb := _lead_month_ar(r)) is not None and mb == (year_m, month_m)
            ]

        rows.sort(key=_lead_sort_ts, reverse=False)
        out = [_to_lead_out(r, norm_prices) for r in rows]

    return LeadsListResponse(leads=out)


def _operative_month_for_create(month_param: str | None) -> tuple[int, int]:
    """Mes operativo para anclar fecha_bot/agendo (AR si no se envía month)."""
    if month_param and str(month_param).strip():
        mk = _parse_month_query(month_param)
        if mk is None:
            raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).")
        return mk
    now_ar = datetime.now(timezone.utc).astimezone(_AR)
    return (now_ar.year, now_ar.month)


def _anchor_datetime_for_operative_month(year: int, month: int) -> datetime:
    """Mitad de mes en UTC naive: consistente con filtro GET /leads ?month= (mes AR)."""
    return datetime(year, month, 15, 15, 0, 0)


@router.post("", response_model=LeadOut)
def create_lead(
    body: LeadCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadOut:
    """Alta manual; el lead aparece en la grilla del mes elegido (como si hubiera agendado)."""
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    y, mn = _operative_month_for_create(body.month)
    anchor = _anchor_datetime_for_operative_month(y, mn)
    st = (body.status or "").strip() or "Pendiente"

    with db_session:
        row = LeadEntity(
            user_id=uid,
            nombre=(body.client_name or "").strip(),
            ig=(body.ig_handle or "").strip(),
            telefono=(body.phone or "").strip(),
            notas=(body.notes or "").strip(),
            origen="Manual",
            status=st,
            estado=st,
            fecha_bot=anchor,
            agendo=anchor,
            agendo_en="Manual",
            formulario={},
        )
        norm_prices = build_program_norm_price_map(uid)
        return _to_lead_out(row, norm_prices)


def _parse_call_hora_today(hora: str) -> datetime:
    raw = (hora or "").strip()
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", raw)
    if not match:
        raise HTTPException(status_code=400, detail="Hora inválida (usar HH:MM).")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise HTTPException(status_code=400, detail="Hora inválida (usar HH:MM).")
    hoy = datetime.now(AR_TZ).date()
    return datetime.combine(hoy, time(hour=hour, minute=minute))


def _normalize_calificacion_llamada(raw: str | None) -> str:
    val = (raw or "").strip().lower()
    if val in ("calificado", "descalificado"):
        return val
    return ""


@router.post("/manual-call", response_model=LeadOut)
def create_manual_call(
    body: ManualCallCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadOut:
    """Llamada agregada a mano en el panel diario; el lead queda en la tabla leads."""
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    call_at = _parse_call_hora_today(body.hora)
    now_ar = datetime.now(AR_TZ).replace(tzinfo=None)
    anchor = datetime(now_ar.year, now_ar.month, 15, 15, 0, 0)

    with db_session:
        row = LeadEntity(
            user_id=uid,
            nombre=(body.client_name or "").strip(),
            ig=(body.ig_handle or "").strip(),
            origen="Manual",
            status="Pendiente",
            estado="Pendiente",
            closer=(body.closer or "").strip(),
            fecha_bot=anchor,
            agendo=now_ar,
            agendo_en="Panel diario",
            call=call_at,
            formulario={},
        )
        norm_prices = build_program_norm_price_map(uid)
        return _to_lead_out(row, norm_prices)


def _parse_month_query(month: str | None) -> tuple[int, int] | None:
    if not month or not str(month).strip():
        return None
    parts = str(month).strip().split("-", 1)
    if len(parts) != 2:
        return None
    try:
        y, m = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (1 <= m <= 12):
        return None
    return y, m


@router.get("/llamadas-hoy", response_model=LlamadasHoyOut)
def leads_llamadas_hoy(
    user_id: Annotated[str, Depends(require_user_id)],
    fecha: date | None = Query(
        default=None,
        description="YYYY-MM-DD opcional; si se omite, usa el día actual (Argentina).",
    ),
) -> LlamadasHoyOut:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    payload = list_llamadas_dia(uid, fecha) if fecha is not None else list_llamadas_hoy(uid)
    return LlamadasHoyOut(**payload)


@router.get("/metrics", response_model=LeadsMetricsOut)
def leads_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; mismo filtro que GET /leads (mes AR por fecha_bot / created_at)",
    ),
) -> LeadsMetricsOut:
    """Métricas agregadas de todos los leads del mes (no filtro BIO)."""
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key: tuple[int, int] | None = None
    if month and str(month).strip():
        month_key = _parse_month_query(month)
        if month_key is None:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
    with db_session:
        rows = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]
        if month_key is not None:
            y, mn = month_key
            rows = [
                r
                for r in rows
                if (mb := _lead_month_ar(r)) is not None and mb == (y, mn)
            ]
        total = len(rows)
        agendaron = sum(1 for r in rows if r.agendo is not None)
        cash_total = sum(float(r.pago or 0) for r in rows)
    cash_por_chat = (cash_total / total) if total else 0.0
    return LeadsMetricsOut(
        total_leads=total,
        agendaron=agendaron,
        cash_total=cash_total,
        cash_por_chat=cash_por_chat,
    )


@router.patch("/{lead_id}", response_model=LeadOut)
def patch_lead(
    lead_id: str,
    body: LeadPatchRequest,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadOut:
    try:
        lid = int(lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")

    fathom_to_analyze: str | None = None

    with db_session:
        try:
            row = LeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")

        if "client_name" in data:
            row.nombre = (data["client_name"] or "") or ""
        if "ig_handle" in data:
            row.ig = data["ig_handle"] or ""
        if "phone" in data:
            row.telefono = data["phone"] or ""
        if "avatar_type" in data:
            row.avatar = data["avatar_type"] or ""
        if "status" in data:
            st = (data["status"] or "").strip() or "Pendiente"
            row.status = st
            row.estado = st
        if "origen" in data:
            row.origen = (data["origen"] or "") or ""
        elif "origin" in data:
            row.origen = (data["origin"] or "") or ""
        if "entry_funnel" in data:
            row.keyword = data["entry_funnel"] or ""
        if "keyword" in data:
            row.keyword = data["keyword"] or ""
        if "punto_agenda" in data:
            row.punto_agenda = _normalize_punto_agenda_value(uid, data.get("punto_agenda"))
        elif "agenda_point" in data:
            row.punto_agenda = _normalize_punto_agenda_value(uid, data.get("agenda_point"))
        if "scheduled_at" in data:
            row.call = _parse_dt_in(data["scheduled_at"])
        elif "call" in data:
            v = data["call"]
            row.call = _parse_dt_in(v) if v is not None and str(v).strip() else None
        if "agendo" in data:
            v = data["agendo"]
            row.agendo = _parse_dt_in(v) if v is not None and str(v).strip() else None
        if "agendo_en" in data:
            v = data["agendo_en"]
            raw = (str(v).strip() if v is not None else "") or "Chat"
            if _agendo_en_looks_like_iso_datetime(raw):
                if "scheduled_at" not in data and "call" not in data:
                    row.call = _parse_dt_in(raw)
                row.agendo_en = "Chat"
            else:
                row.agendo_en = raw or "Chat"
        if "call_link" in data:
            prev_link = normalize_fathom_url(row.link_llamada or "")
            row.link_llamada = data["call_link"] or ""
            nuevo_link = normalize_fathom_url(row.link_llamada or "")
            if is_fathom_link(nuevo_link) and nuevo_link != prev_link:
                fathom_to_analyze = nuevo_link
        if "program_offered" in data:
            row.programa_ofrecido = data["program_offered"] or ""
        if "programada_ofrecido_llamada" in data:
            row.programada_ofrecido_llamada = data["programada_ofrecido_llamada"] or ""
        if "payment" in data:
            row.pago = float(data["payment"] or 0)
        if "owed" in data:
            row.debe = float(data["owed"] or 0)
        if "notes" in data:
            row.notas = data["notes"] or ""
        if "dolores_setting" in data:
            row.dolores_setting = data["dolores_setting"] or ""
        if "dolores_llamada" in data:
            row.dolores_llamada = data["dolores_llamada"] or ""
        if "closer_report" in data:
            row.closer_report = data["closer_report"] or ""
        if "razon_compra" in data:
            row.razon_compra = data["razon_compra"] or ""
        if "formulario" in data:
            row.formulario = merge_formulario(row.formulario, data.get("formulario") or {})
        if "setter" in data:
            row.setter = (str(data["setter"]).strip() if data["setter"] is not None else "") or ""
        if "closer" in data:
            row.closer = (str(data["closer"]).strip() if data["closer"] is not None else "") or ""
        if "calificacion_llamada" in data:
            row.calificacion_llamada = _normalize_calificacion_llamada(data["calificacion_llamada"])

        norm_prices = build_program_norm_price_map(uid)
        result = _to_lead_out(row, norm_prices)

    if fathom_to_analyze:
        report_id, created = get_or_create_report(lid, fathom_to_analyze, uid)
        should_run = created
        if not created:
            with db_session:
                report_row = CallReportEntity.get(id=report_id)
                if report_row is not None and (report_row.estado or "") in ("error", "pendiente"):
                    should_run = True
                    report_row.estado = "pendiente"
                    report_row.error_msg = ""
        if should_run:
            background.add_task(analyze_call_report, report_id)

    return result


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    """Elimina un lead si pertenece al usuario. Los CallReport se conservan con snapshot del nombre."""
    try:
        lid = int(lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    with db_session:
        try:
            row = LeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")
        nombre_snap = lead_display_nombre(row.nombre, row.ig) or (row.nombre or "").strip() or "Sin nombre"
        for report in CallReportEntity.select(lambda r: r.lead_id == lid):
            if int(report.user_id) != uid:
                continue
            if not (report.lead_nombre or "").strip():
                report.lead_nombre = nombre_snap
        row.delete()

    return {"status": "ok", "id": str(lid)}
