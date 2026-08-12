"""Cobranzas: deudores (Lead.debe > 0) + historial de pagos."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.models import Lead, LeadPayment
from src.schemas import (
    CobranzaLeadOut,
    CobranzaLeadPatchRequest,
    CobranzaPagoMonthEntryOut,
    CobranzaPerfilOut,
    CobranzasListResponse,
    CobranzasMonthPagosOut,
    LeadPaymentCreateRequest,
    LeadPaymentOut,
    LeadPaymentPatchRequest,
)
from src.services.lead_financials_service import (
    merge_meta,
    normalize_concepto,
    recalc_lead_from_db,
)

router = APIRouter(prefix="/api/cobranzas", tags=["cobranzas"], redirect_slashes=False)

_BOGOTA = ZoneInfo("America/Bogota")


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e


def _date_iso(d: date | None) -> str:
    if d is None:
        return ""
    return d.isoformat()


def _dt_iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


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


def _today_bogota() -> date:
    return datetime.now(timezone.utc).astimezone(_BOGOTA).date()


def _precio_contrato_from_lead(lead: Lead) -> float | None:
    meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
    pc = meta.get("precio_contrato")
    if pc is None:
        return None
    try:
        val = float(pc)
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def _payment_out(row: LeadPayment) -> LeadPaymentOut:
    return LeadPaymentOut(
        id=str(row.id),
        lead_id=str(row.lead_id),
        monto=float(row.monto or 0),
        fecha=_date_iso(row.fecha),
        concepto=(row.concepto or "").strip(),
        metodo=(getattr(row, "metodo", None) or "").strip(),
        nota=row.nota or "",
        comprobante_url=(getattr(row, "comprobante_url", None) or "").strip() or None,
        created_at=_dt_iso(row.created_at),
    )


def _lead_summary(lead: Lead, total_hist: float, count: int) -> CobranzaLeadOut:
    debe_raw = lead.debe
    return CobranzaLeadOut(
        id=str(lead.id),
        nombre=lead.nombre or "",
        ig=lead.ig or "",
        telefono=lead.telefono or "",
        email=lead.email or "",
        avatar=lead.avatar or "",
        status=(lead.status or lead.estado or "").strip(),
        closer=lead.closer or "",
        setter=lead.setter or "",
        programa_ofrecido=lead.programa_ofrecido or "",
        pago=float(lead.pago or 0),
        debe=float(debe_raw) if debe_raw is not None else None,
        precio_contrato=_precio_contrato_from_lead(lead),
        debe_desconocido=debe_raw is None,
        comprobante_url=(getattr(lead, "comprobante_url", None) or "").strip() or None,
        total_pagado_historial=float(total_hist),
        cantidad_pagos=int(count),
    )


def _hist_for_leads(uid: int, lead_ids: list[int]) -> dict[int, tuple[float, int]]:
    """lead_id → (suma montos, cantidad)."""
    out: dict[int, tuple[float, int]] = {lid: (0.0, 0) for lid in lead_ids}
    if not lead_ids:
        return out
    id_set = set(lead_ids)
    for p in list(LeadPayment.select()):
        if int(p.user_id) != uid:
            continue
        lid = int(p.lead_id)
        if lid not in id_set:
            continue
        total, n = out.get(lid, (0.0, 0))
        out[lid] = (total + float(p.monto or 0), n + 1)
    return out


def _sum_cuotas_lead(uid: int, lead_id: int, exclude_pago_id: int | None = None) -> float:
    total = 0.0
    for p in list(LeadPayment.select()):
        if int(p.user_id) != uid or int(p.lead_id) != lead_id:
            continue
        if exclude_pago_id is not None and int(p.id) == exclude_pago_id:
            continue
        total += float(p.monto or 0)
    return total


def _debe_is_unknown(lead: Lead) -> bool:
    return lead.debe is None


def _assert_cuota_within_debt(
    lead: Lead,
    uid: int,
    nuevo_monto: float,
    exclude_pago_id: int | None = None,
) -> None:
    """La suma de cuotas no puede superar Lead.debe cuando la deuda es conocida."""
    if _debe_is_unknown(lead):
        return
    deuda_max = float(lead.debe or 0)
    if deuda_max <= 0:
        raise HTTPException(
            status_code=400,
            detail="Este lead no tiene deuda registrada en Leads.",
        )
    ya = _sum_cuotas_lead(uid, int(lead.id), exclude_pago_id=exclude_pago_id)
    if ya + float(nuevo_monto) > deuda_max + 1e-9:
        restante = max(0.0, deuda_max - ya)
        raise HTTPException(
            status_code=400,
            detail=(
                f"La cuota supera la deuda. Máximo permitido: {restante:.2f} "
                f"(deuda Leads {deuda_max:.2f}, ya cargado {ya:.2f})."
            ),
        )


def _require_concepto(raw: str | None) -> str:
    concepto = normalize_concepto(raw)
    if not concepto:
        raise HTTPException(
            status_code=400,
            detail="concepto inválido (PIF, 1ra Cuota, 2da Cuota, 3ra Cuota, Fee, Otro).",
        )
    return concepto


def _get_lead_for_user(uid: int, lid: int) -> Lead:
    try:
        lead = Lead[lid]
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
    if int(lead.user_id) != uid:
        raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
    return lead


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


@router.get("", response_model=CobranzasListResponse)
def list_deudores(
    user_id: Annotated[str, Depends(require_user_id)],
) -> CobranzasListResponse:
    """Leads con debe > 0 + resumen de historial."""
    uid = _parse_uid(user_id)
    with db_session:
        leads = [
            r
            for r in list(Lead.select())
            if int(r.user_id) == uid and r.debe is not None and float(r.debe) > 0
        ]
        leads.sort(
            key=lambda r: (
                -float(r.debe or 0),
                (r.nombre or "").lower(),
            )
        )
        hist = _hist_for_leads(uid, [int(r.id) for r in leads])
        deudores = [
            _lead_summary(r, *hist.get(int(r.id), (0.0, 0))) for r in leads
        ]
    return CobranzasListResponse(deudores=deudores)


@router.get("/pagos/month", response_model=CobranzasMonthPagosOut)
def list_pagos_month(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str = Query(..., description="YYYY-MM; filtra por fecha del pago"),
) -> CobranzasMonthPagosOut:
    """Total de cuotas/pagos del historial cobranzas en el mes."""
    uid = _parse_uid(user_id)
    month_key = _parse_month_query(month)
    if month_key is None:
        raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
    year_m, month_m = month_key
    month_str = f"{year_m}-{month_m:02d}"

    with db_session:
        alive_lead_ids = {
            int(r.id) for r in list(Lead.select()) if int(r.user_id) == uid
        }
        entries: list[CobranzaPagoMonthEntryOut] = []
        total = 0.0
        lead_ids_with_history: set[int] = {
            int(p.lead_id)
            for p in list(LeadPayment.select())
            if int(p.user_id) == uid
        }
        for p in list(LeadPayment.select()):
            if int(p.user_id) != uid:
                continue
            lid = int(p.lead_id)
            if lid not in alive_lead_ids:
                p.delete()
                continue
            if p.fecha is None:
                continue
            if p.fecha.year != year_m or p.fecha.month != month_m:
                continue
            monto = float(p.monto or 0)
            total += monto
            entries.append(
                CobranzaPagoMonthEntryOut(
                    fecha=_date_iso(p.fecha),
                    monto=monto,
                    lead_id=str(p.lead_id),
                    concepto=(p.concepto or "").strip(),
                    nota=p.nota or "",
                )
            )
        entries.sort(key=lambda e: e.fecha, reverse=True)

    return CobranzasMonthPagosOut(
        month=month_str,
        total=total,
        entries=entries,
        lead_ids_with_history=sorted(str(i) for i in lead_ids_with_history),
    )


@router.get("/{lead_id}", response_model=CobranzaPerfilOut)
def get_perfil(
    lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CobranzaPerfilOut:
    uid = _parse_uid(user_id)
    try:
        lid = int(lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id inválido") from e

    with db_session:
        lead = _get_lead_for_user(uid, lid)
        pagos_rows = [
            p
            for p in list(LeadPayment.select())
            if int(p.user_id) == uid and int(p.lead_id) == lid
        ]
        pagos_rows.sort(
            key=lambda p: (
                p.fecha or date.min,
                p.created_at or datetime.min,
            ),
            reverse=True,
        )
        total = sum(float(p.monto or 0) for p in pagos_rows)
        return CobranzaPerfilOut(
            lead=_lead_summary(lead, total, len(pagos_rows)),
            pagos=[_payment_out(p) for p in pagos_rows],
        )


@router.patch("/{lead_id}", response_model=CobranzaLeadOut)
def patch_lead_contrato(
    lead_id: str,
    body: CobranzaLeadPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CobranzaLeadOut:
    """Registra precio de contrato en legacy_meta y recalcula debe."""
    uid = _parse_uid(user_id)
    try:
        lid = int(lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id inválido") from e

    with db_session:
        lead = _get_lead_for_user(uid, lid)
        lead.legacy_meta = merge_meta(
            getattr(lead, "legacy_meta", None),
            {"precio_contrato": float(body.precio_contrato)},
        )
        recalc_lead_from_db(uid, lead)
        hist = _hist_for_leads(uid, [lid]).get(lid, (0.0, 0))
        return _lead_summary(lead, *hist)


@router.post("/{lead_id}/pagos", response_model=LeadPaymentOut)
def create_pago(
    lead_id: str,
    body: LeadPaymentCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadPaymentOut:
    uid = _parse_uid(user_id)
    try:
        lid = int(lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id inválido") from e

    fecha_val = _parse_date_in(body.fecha) if body.fecha else _today_bogota()
    if fecha_val is None:
        raise HTTPException(status_code=400, detail="fecha inválida (usar YYYY-MM-DD).")
    concepto = _require_concepto(body.concepto)

    with db_session:
        lead = _get_lead_for_user(uid, lid)
        _assert_cuota_within_debt(lead, uid, float(body.monto))

        row = LeadPayment(
            user_id=uid,
            lead_id=lid,
            source="atv",
            monto=float(body.monto),
            fecha=fecha_val,
            concepto=concepto,
            metodo=(body.metodo or "").strip(),
            nota=(body.nota or "").strip() or concepto,
            comprobante_url=(body.comprobante_url or "").strip(),
        )
        recalc_lead_from_db(uid, lead)
        return _payment_out(row)


@router.patch("/pagos/{pago_id}", response_model=LeadPaymentOut)
def patch_pago(
    pago_id: str,
    body: LeadPaymentPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadPaymentOut:
    uid = _parse_uid(user_id)
    try:
        pid = int(pago_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="pago_id inválido") from e

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")

    with db_session:
        try:
            row = LeadPayment[pid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Pago no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Pago no encontrado.")

        lead = _get_lead_for_user(uid, int(row.lead_id))

        nuevo_monto = float(data["monto"]) if "monto" in data and data["monto"] is not None else float(row.monto or 0)
        _assert_cuota_within_debt(lead, uid, nuevo_monto, exclude_pago_id=int(row.id))

        if "monto" in data and data["monto"] is not None:
            row.monto = float(data["monto"])
        if "fecha" in data:
            parsed = _parse_date_in(data["fecha"])
            if parsed is None:
                raise HTTPException(status_code=400, detail="fecha inválida (usar YYYY-MM-DD).")
            row.fecha = parsed
        if "concepto" in data and data["concepto"] is not None:
            row.concepto = _require_concepto(data["concepto"])
        if "metodo" in data:
            row.metodo = (data["metodo"] or "").strip()
        if "nota" in data:
            row.nota = (data["nota"] or "").strip() or (row.concepto or "Cuota")
        if "comprobante_url" in data:
            row.comprobante_url = (data["comprobante_url"] or "").strip()

        recalc_lead_from_db(uid, lead)
        return _payment_out(row)


@router.delete("/pagos/{pago_id}")
def delete_pago(
    pago_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    uid = _parse_uid(user_id)
    try:
        pid = int(pago_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="pago_id inválido") from e

    with db_session:
        try:
            row = LeadPayment[pid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Pago no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Pago no encontrado.")
        lead = _get_lead_for_user(uid, int(row.lead_id))
        row.delete()
        recalc_lead_from_db(uid, lead)

    return {"status": "ok", "id": str(pid)}
