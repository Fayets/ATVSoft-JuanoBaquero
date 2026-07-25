"""CRM BIO (ManyChat / perfil): endpoints sobre tabla `Lead` (Neon / Pony)."""

from datetime import datetime
from typing import Annotated

from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.models import ApiConnection, Lead as LeadEntity
from src.schemas import BioLeadResponse, BioLeadStatusPatchRequest, BioLeadsListResponse, BioMetricsResponse, BioViaOptionsResponse

router = APIRouter(prefix="/api/bio", tags=["bio"], redirect_slashes=False)

VIA_OPTIONS_FIXED = ["Perfil", "Automático - ManyChat", "Referido", "Otro"]

# Fallback si el usuario no configuró credentials["bio_keyword"] en ManyChat.
BIO_PROFILE_KEYWORD_DEFAULT = "info"


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_month(month: str | None) -> tuple[int, int] | None:
    if not month or not str(month).strip():
        return None
    parts = str(month).strip().split("-", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    try:
        y, m = int(parts[0]), int(parts[1])
    except ValueError as e:
        raise HTTPException(status_code=400, detail="month inválido.") from e
    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Mes inválido (1–12).")
    return y, m


def _anchor_dt(row: LeadEntity) -> datetime | None:
    """Mes operativo BIO: fecha_bot si existe; si no, created_at."""
    return row.fecha_bot or row.created_at


_AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _today_calendar_ar() -> tuple[int, int, int]:
    d = datetime.now(_AR_TZ).date()
    return d.year, d.month, d.day


def _max_day_mtd(month_key: tuple[int, int] | None) -> int | None:
    """Si el mes pedido es el mes actual en Argentina, contar solo hasta hoy (MTD). Si no, mes completo."""
    if month_key is None:
        return None
    y, mn = month_key
    ty, tm, td = _today_calendar_ar()
    if ty == y and tm == mn:
        return td
    return None


def _in_month_calendar(row: LeadEntity, y: int, mn: int, max_day: int | None) -> bool:
    """Lead en el mes calendario (y, mn); si max_day está definido, solo días 1..max_day."""
    ref = _anchor_dt(row)
    if ref is None:
        return False
    dt = ref.replace(tzinfo=None) if ref.tzinfo else ref
    if dt.year != y or dt.month != mn:
        return False
    if max_day is None:
        return True
    return 1 <= dt.day <= max_day


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _is_cerrado(row: LeadEntity) -> bool:
    s = (row.status or row.estado or "").strip().lower()
    return s == "cerrado"


def _lead_keyword_tokens(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [t.strip().lower() for t in str(raw).split(",") if t.strip()]


def _bio_profile_keyword_for_user(uid: int) -> str:
    """Keyword de bio del usuario (ApiConnection manychat); fallback 'info'."""
    with db_session:
        try:
            conn = ApiConnection.get(user_id=uid, platform="manychat")
        except ObjectNotFound:
            return BIO_PROFILE_KEYWORD_DEFAULT
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        raw = str(creds.get("bio_keyword") or "").strip()
        if not raw:
            return BIO_PROFILE_KEYWORD_DEFAULT
        return raw.lower()


def _is_bio_profile_lead(
    row: LeadEntity,
    user_id: int,
    *,
    bio_keyword: str | None = None,
) -> bool:
    kw = (bio_keyword or _bio_profile_keyword_for_user(user_id)).lower()
    return kw in _lead_keyword_tokens(row.keyword)


def _lead_to_response(row: LeadEntity) -> BioLeadResponse:
    st = (row.status or row.estado or "").strip() or None
    prog = row.programa_ofrecido
    subscribed = _anchor_dt(row)
    return BioLeadResponse(
        id=str(row.id),
        handle=(row.ig or "").strip() or "",
        nombre=row.nombre,
        avatar_url=None,
        subscribed_at=_dt_iso(subscribed),
        keyword=row.keyword,
        via=row.origen,
        airtable_found=True,
        airtable_record_id=str(row.id),
        status=st,
        setter=None,
        programa=prog,
        pago=float(row.pago) if row.pago is not None else None,
        fecha_agendo=_dt_iso(row.agendo),
        llamada_url=row.link_llamada,
        dolores=row.dolores_setting or row.dolores_llamada,
        razon_compra=row.razon_compra,
        notas=row.notas,
        manychat_chat_url=row.content_url,
        respondio_auto=bool(row.respondio_auto),
        content_url=row.content_url,
        manychat_contact_id=row.manychat_contact_id,
        programa_ofrecido=prog,
        fecha_bot=_dt_iso(row.fecha_bot),
        agendo=row.agendo is not None,
    )


def _rows_for_user_month(uid: int, month_key: tuple[int, int] | None) -> list[LeadEntity]:
    with db_session:
        rows = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]
    max_day = _max_day_mtd(month_key)
    if month_key is not None:
        y, mn = month_key
        rows = [r for r in rows if _in_month_calendar(r, y, mn, max_day)]
    bio_kw = _bio_profile_keyword_for_user(uid)
    return [r for r in rows if _is_bio_profile_lead(r, uid, bio_keyword=bio_kw)]


@router.get("/leads", response_model=BioLeadsListResponse)
def list_bio_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="YYYY-MM; filtra por fecha_bot o created_at. Mes actual en AR = solo hasta hoy (MTD)."),
) -> BioLeadsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key = _parse_month(month)
    rows = _rows_for_user_month(uid, month_key)

    def _sort_key(r: LeadEntity) -> float:
        c = _anchor_dt(r)
        return float(c.timestamp()) if c is not None else 0.0

    rows.sort(key=_sort_key, reverse=True)
    return BioLeadsListResponse(
        leads=[_lead_to_response(r) for r in rows],
        manychat_active=True,
        connected_to_airtable=False,
        bio_profile_keyword=_bio_profile_keyword_for_user(uid),
    )


@router.get("/metrics", response_model=BioMetricsResponse)
def bio_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="YYYY-MM; mismo criterio que /leads. Mes actual AR = hasta hoy (MTD)."),
) -> BioMetricsResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    month_key = _parse_month(month)
    rows = _rows_for_user_month(uid, month_key)

    total = len(rows)
    agendaron = sum(1 for r in rows if r.agendo is not None)
    cerrados = sum(1 for r in rows if _is_cerrado(r))
    respondio_auto_n = sum(1 for r in rows if r.respondio_auto is True)

    cash_total = sum(float(r.pago or 0) for r in rows)

    tasa_agenda = (agendaron / total * 100.0) if total else 0.0
    cash_por_chat = (cash_total / total) if total else 0.0
    tasa_respuesta_auto_val = (respondio_auto_n / total * 100.0) if total else None

    cash_por_lead = (cash_total / cerrados) if cerrados else 0.0

    return BioMetricsResponse(
        total_leads=total,
        agendaron=agendaron,
        cerrados=cerrados,
        tasa_agenda=round(tasa_agenda, 2),
        cash_total=round(cash_total, 2),
        cash_por_chat=round(cash_por_chat, 2),
        respondio_auto=respondio_auto_n,
        tasa_respuesta_auto=round(tasa_respuesta_auto_val, 2) if tasa_respuesta_auto_val is not None else None,
        cash_por_lead=round(cash_por_lead, 2),
        tasa_conversion=round(tasa_agenda, 2),
    )


@router.get("/via-options", response_model=BioViaOptionsResponse)
def bio_via_options(
    _user_id: Annotated[str, Depends(require_user_id)],
) -> BioViaOptionsResponse:
    return BioViaOptionsResponse(options=list(VIA_OPTIONS_FIXED))


@router.patch("/leads/{lead_id}/status", response_model=BioLeadResponse)
def patch_lead_status(
    lead_id: str,
    body: BioLeadStatusPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> BioLeadResponse:
    try:
        lid = int(lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    status_new = (body.status or "").strip()
    if not status_new:
        raise HTTPException(status_code=400, detail="status no puede estar vacío.")

    with db_session:
        try:
            row = LeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")
        row.status = status_new
        row.estado = status_new
        return _lead_to_response(row)
