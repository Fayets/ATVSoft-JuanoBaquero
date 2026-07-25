from datetime import date, datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.models import HotLead as HotLeadEntity
from src.schemas import (
    HotLeadCreateRequest,
    HotLeadOut,
    HotLeadPatchRequest,
    HotLeadsListResponse,
)

router = APIRouter(prefix="/api/hot-leads", tags=["hot-leads"], redirect_slashes=False)

_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


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


def _hot_lead_effective_dt(row: HotLeadEntity) -> datetime | None:
    if row.fecha is not None:
        return datetime(row.fecha.year, row.fecha.month, row.fecha.day)
    return row.created_at


def _hot_lead_month_ar(row: HotLeadEntity) -> tuple[int, int] | None:
    dt = _hot_lead_effective_dt(row)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_utc = dt.replace(tzinfo=timezone.utc)
    d_ar = d_utc.astimezone(_AR)
    return (d_ar.year, d_ar.month)


def _hot_lead_month_string_ar(row: HotLeadEntity) -> str | None:
    mb = _hot_lead_month_ar(row)
    if mb is None:
        return None
    y, m = mb
    return f"{y}-{m:02d}"


def _hot_lead_sort_ts(row: HotLeadEntity) -> float:
    dt = row.created_at
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return float(dt.replace(tzinfo=timezone.utc).timestamp())


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _date_iso(d: date | None) -> str | None:
    if d is None:
        return None
    return d.isoformat()


def _parse_date_in(val: str | None) -> date | None:
    if val is None or not str(val).strip():
        return None
    s = str(val).strip()
    head = s.split("T")[0].split(" ")[0]
    try:
        parts = head.split("-")
        if len(parts) != 3:
            return None
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        return date(y, m, d)
    except ValueError:
        return None


def _to_hot_lead_out(row: HotLeadEntity) -> HotLeadOut:
    return HotLeadOut(
        id=str(row.id),
        nombre=row.nombre or "",
        ig=row.ig or "",
        avatar=row.avatar or "",
        seguidores=row.seguidores or "",
        calidad=row.calidad or "",
        fecha=_date_iso(row.fecha),
        status=(row.status or "").strip() or "Prospectar",
        notas=row.notas or "",
        created_at=_dt_iso(row.created_at) or "",
        month=_hot_lead_month_string_ar(row),
    )


def _operative_month_for_create(month_param: str | None) -> tuple[int, int]:
    if month_param and str(month_param).strip():
        mk = _parse_month_query(month_param)
        if mk is None:
            raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).")
        return mk
    now_ar = datetime.now(timezone.utc).astimezone(_AR)
    return (now_ar.year, now_ar.month)


@router.get("", response_model=HotLeadsListResponse)
def list_hot_leads(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM; filtra por fecha o created_at (mes AR)",
    ),
) -> HotLeadsListResponse:
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
        rows = [r for r in list(HotLeadEntity.select()) if int(r.user_id) == uid]
        if month_key is not None:
            year_m, month_m = month_key
            rows = [
                r
                for r in rows
                if (mb := _hot_lead_month_ar(r)) is not None and mb == (year_m, month_m)
            ]
        rows.sort(key=_hot_lead_sort_ts, reverse=True)
        out = [_to_hot_lead_out(r) for r in rows]

    return HotLeadsListResponse(hot_leads=out)


@router.post("", response_model=HotLeadOut)
def create_hot_lead(
    body: HotLeadCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> HotLeadOut:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    fecha_val = _parse_date_in(body.fecha)
    if fecha_val is None and body.fecha and str(body.fecha).strip():
        raise HTTPException(status_code=400, detail="fecha inválida (usar YYYY-MM-DD).")

    if fecha_val is None:
        y, mn = _operative_month_for_create(body.month)
        fecha_val = date(y, mn, 15)

    st = (body.status or "").strip() or "Prospectar"

    with db_session:
        row = HotLeadEntity(
            user_id=uid,
            nombre=(body.nombre or "").strip(),
            ig=(body.ig or "").strip(),
            avatar=(body.avatar or "").strip(),
            seguidores=(body.seguidores or "").strip(),
            calidad=(body.calidad or "").strip(),
            fecha=fecha_val,
            status=st,
            notas=(body.notas or "").strip(),
        )
        return _to_hot_lead_out(row)


@router.patch("/{hot_lead_id}", response_model=HotLeadOut)
def patch_hot_lead(
    hot_lead_id: str,
    body: HotLeadPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> HotLeadOut:
    try:
        lid = int(hot_lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="hot_lead_id o user_id inválido") from e

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")

    with db_session:
        try:
            row = HotLeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Hot lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Hot lead no encontrado.")

        if "nombre" in data:
            row.nombre = (data["nombre"] or "") or ""
        if "ig" in data:
            row.ig = data["ig"] or ""
        if "avatar" in data:
            row.avatar = data["avatar"] or ""
        if "seguidores" in data:
            row.seguidores = data["seguidores"] or ""
        if "calidad" in data:
            row.calidad = data["calidad"] or ""
        if "fecha" in data:
            if data["fecha"] is None or not str(data["fecha"]).strip():
                row.fecha = None
            else:
                parsed = _parse_date_in(data["fecha"])
                if parsed is None:
                    raise HTTPException(status_code=400, detail="fecha inválida (usar YYYY-MM-DD).")
                row.fecha = parsed
        if "status" in data:
            row.status = (data["status"] or "").strip() or "Prospectar"
        if "notas" in data:
            row.notas = data["notas"] or ""

        return _to_hot_lead_out(row)


@router.delete("/{hot_lead_id}")
def delete_hot_lead(
    hot_lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        lid = int(hot_lead_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="hot_lead_id o user_id inválido") from e

    with db_session:
        try:
            row = HotLeadEntity[lid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Hot lead no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Hot lead no encontrado.")
        row.delete()

    return {"status": "ok", "id": str(lid)}
