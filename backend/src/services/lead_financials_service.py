"""Recálculo de Lead.pago / Lead.debe desde historial lead_payment."""

from __future__ import annotations

from typing import Any

from src.models import Lead, LeadPayment

CIERRE_NUEVO_CONCEPTOS = frozenset({"PIF", "1ra Cuota"})

PAYMENT_CONCEPTOS = frozenset(
    {"PIF", "1ra Cuota", "2da Cuota", "3ra Cuota", "Fee", "Otro"}
)


def merge_meta(existing: Any, patch: dict) -> dict:
    base: dict = dict(existing) if isinstance(existing, dict) else {}
    base.update(patch)
    return base


def normalize_producto_norm(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s or s.casefold() == "null":
        return ""
    if "herramienta 3 meses" in s.casefold():
        return "Otro"
    return s


def normalize_concepto(raw: str | None) -> str:
    c = (raw or "").strip()
    if c in PAYMENT_CONCEPTOS:
        return c
    return ""


def payments_for_lead(uid: int, lead_id: int) -> list[LeadPayment]:
    return [
        p
        for p in list(LeadPayment.select())
        if int(p.user_id) == uid and int(p.lead_id) == lead_id
    ]


def recalc_lead_financials(uid: int, lead: Lead, payments: list[LeadPayment]) -> None:
    del uid  # compat firma legacy
    lead_payments = [p for p in payments if int(p.lead_id) == int(lead.id)]
    total = 0.0
    for p in lead_payments:
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        if meta.get("es_programado"):
            continue
        if meta.get("monto_cero"):
            continue
        total += float(p.monto or 0)
    lead.pago = total

    contract_prices: list[float] = []
    conflict = False
    cierre_prices: list[float] = []

    lead_meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
    lead_pc = lead_meta.get("precio_contrato")
    if lead_pc is not None:
        try:
            contract_prices.append(float(lead_pc))
        except (TypeError, ValueError):
            pass

    for p in lead_payments:
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        pc = meta.get("precio_contrato")
        if pc is None:
            continue
        try:
            val = float(pc)
        except (TypeError, ValueError):
            continue
        contract_prices.append(val)
        if (p.concepto or "") in CIERRE_NUEVO_CONCEPTOS:
            cierre_prices.append(val)

    contract: float | None = None
    if len(cierre_prices) == 1:
        contract = cierre_prices[0]
    elif len(cierre_prices) > 1:
        contract = max(cierre_prices)
        conflict = True
    elif contract_prices:
        contract = max(contract_prices)
        if len(set(contract_prices)) > 1:
            conflict = True

    if contract is not None:
        raw_debe = contract - total
        meta = merge_meta(getattr(lead, "legacy_meta", None), {})
        if raw_debe < 0:
            meta["sobrepago"] = True
            meta["sobrepago_monto"] = abs(raw_debe)
            lead.debe = 0.0
        else:
            lead.debe = raw_debe
        if conflict:
            meta["precio_contrato_conflicto"] = True
        lead.legacy_meta = meta
    else:
        lead.debe = None
        meta = merge_meta(getattr(lead, "legacy_meta", None), {})
        if conflict:
            meta["precio_contrato_conflicto"] = True
            lead.legacy_meta = meta

    valid_product = ""
    for p in lead_payments:
        prod = normalize_producto_norm(p.producto)
        if prod and prod not in ("Sin especificar", "Otro"):
            valid_product = prod
            break
        if prod and not valid_product:
            valid_product = prod
    if valid_product and not (lead.programa_ofrecido or "").strip():
        lead.programa_ofrecido = valid_product

    for p in lead_payments:
        if (p.concepto or "") in CIERRE_NUEVO_CONCEPTOS:
            st = (lead.status or lead.estado or "").strip()
            if st in ("", "Pendiente", "Agendado", "agendado"):
                lead.status = "Cerrado"
                lead.estado = "Cerrado"
            break


def recalc_lead_from_db(uid: int, lead: Lead) -> None:
    recalc_lead_financials(uid, lead, payments_for_lead(uid, int(lead.id)))
