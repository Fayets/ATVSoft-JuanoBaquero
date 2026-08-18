"""Métricas en vivo por closer para Dashboard equipo (lead + lead_payment)."""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from src.models import Lead, LeadPayment, SeguimientoReport, TeamMember
from src.services.legacy_juano_import import _norm_key, normalize_closer

_STATUS_SHOW = frozenset({"cerrado", "seguimiento", "descalificado"})
_STATUS_RESUELTA = frozenset({"cerrado", "seguimiento", "descalificado", "no show"})


def _dt_in_month(dt: datetime | None, year: int, month: int, tz: ZoneInfo) -> bool:
    if dt is None:
        return False
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    local = dt.replace(tzinfo=timezone.utc).astimezone(tz)
    return local.year == year and local.month == month


def _status_norm(lead: Lead) -> str:
    return (lead.status or lead.estado or "").strip().lower()


def _lead_closer_raw(lead: Lead) -> str:
    cn = (lead.closer_norm or "").strip()
    c = (lead.closer or "").strip()
    return cn or c


def closer_match_key(raw: str) -> str:
    canonical = normalize_closer(raw)
    if not canonical:
        return ""
    return _norm_key(canonical)


@dataclass
class CloserLiveStats:
    llamadas_agendadas: int = 0
    resueltas: int = 0
    shows: int = 0
    cierres: int = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0.0

    @property
    def cobertura(self) -> float:
        if self.llamadas_agendadas <= 0:
            return 0.0
        return round(self.resueltas / self.llamadas_agendadas * 100.0, 2)


def _lead_effective_dt(lead: Lead) -> datetime | None:
    return lead.call or lead.agendo or lead.fecha_bot or lead.created_at


def _lead_operative_month(lead: Lead, tz: ZoneInfo) -> tuple[int, int] | None:
    """Mes operativo del lead (mismo criterio que GET /leads ?month=)."""
    dt = _lead_effective_dt(lead)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_local = dt.replace(tzinfo=timezone.utc).astimezone(tz)
    return (d_local.year, d_local.month)


def _lead_is_merged(lead: Lead) -> bool:
    st = (lead.status or lead.estado or "").strip().lower()
    if st == "merged":
        return True
    meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
    return bool(str(meta.get("merged_into") or "").strip())


@dataclass
class CloserLiveAggregation:
    by_member_id: dict[int, CloserLiveStats]
    ingreso_sin_closer: float = 0.0
    ingreso_closer_fuera_equipo: float = 0.0
    ingreso_fallback_pago: float = 0.0
    cash_collected: float = 0.0
    ingreso_atribuido_closers: float = 0.0
    ingreso_sin_atribuir: float = 0.0
    leads_sin_match: int = 0


def _month_date_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    return start, end


def aggregate_closer_stats_live(
    user_id: int,
    year: int,
    month: int,
    tz: ZoneInfo,
    active_closers: list[TeamMember],
) -> CloserLiveAggregation:
    member_by_key: dict[str, int] = {}
    for m in active_closers:
        key = closer_match_key(m.nombre)
        if key:
            member_by_key[key] = m.id

    stats: dict[int, CloserLiveStats] = {m.id: CloserLiveStats() for m in active_closers}

    all_leads = [l for l in Lead.select() if int(l.user_id) == user_id]
    lead_by_id = {int(l.id): l for l in all_leads}

    leads_sin_match = 0
    for lead in all_leads:
        if lead.call is None or not _dt_in_month(lead.call, year, month, tz):
            continue
        st = _status_norm(lead)
        if st == "merged":
            continue

        raw = _lead_closer_raw(lead)
        key = closer_match_key(raw) if raw else ""
        mid = member_by_key.get(key) if key else None
        if mid is None:
            if raw:
                leads_sin_match += 1
            continue

        s = stats[mid]
        s.llamadas_agendadas += 1
        if st in _STATUS_RESUELTA:
            s.resueltas += 1
        if st in _STATUS_SHOW:
            s.shows += 1
        if st == "cerrado":
            s.cierres += 1
        cal = (lead.calificacion_llamada or "").strip().lower()
        if cal == "calificado":
            s.calificados += 1
        elif cal == "descalificado":
            s.descalificados += 1

    ingreso_sin_closer = 0.0
    ingreso_closer_fuera_equipo = 0.0
    payment_month_total = 0.0
    start, end = _month_date_range(year, month)
    for p in LeadPayment.select():
        if int(p.user_id) != user_id:
            continue
        if not (start <= p.fecha <= end):
            continue
        monto = float(p.monto or 0)
        if monto == 0:
            continue
        payment_month_total += monto
        lead = lead_by_id.get(int(p.lead_id))
        if lead is None:
            ingreso_sin_closer += monto
            continue
        raw = _lead_closer_raw(lead)
        if not raw:
            ingreso_sin_closer += monto
            continue
        key = closer_match_key(raw)
        mid = member_by_key.get(key)
        if mid is None:
            ingreso_closer_fuera_equipo += monto
            continue
        stats[mid].ingreso += monto

    lead_ids_with_history = {
        int(p.lead_id) for p in LeadPayment.select() if int(p.user_id) == user_id
    }
    ingreso_fallback_pago = 0.0
    target_month = (year, month)
    for lead in all_leads:
        if _lead_is_merged(lead):
            continue
        if int(lead.id) in lead_ids_with_history:
            continue
        op_month = _lead_operative_month(lead, tz)
        if op_month != target_month:
            continue
        pago = float(lead.pago or 0)
        if pago > 0:
            ingreso_fallback_pago += pago

    seguimiento_total = 0.0
    for r in SeguimientoReport.select():
        if int(r.user_id) != user_id:
            continue
        if not (start <= r.fecha <= end):
            continue
        seguimiento_total += float(r.monto or 0)

    ingreso_atribuido_closers = sum(s.ingreso for s in stats.values())
    cash_collected = payment_month_total + seguimiento_total + ingreso_fallback_pago
    ingreso_sin_atribuir = max(0.0, cash_collected - ingreso_atribuido_closers)

    return CloserLiveAggregation(
        by_member_id=stats,
        ingreso_sin_closer=ingreso_sin_closer,
        ingreso_closer_fuera_equipo=ingreso_closer_fuera_equipo,
        ingreso_fallback_pago=ingreso_fallback_pago,
        cash_collected=cash_collected,
        ingreso_atribuido_closers=ingreso_atribuido_closers,
        ingreso_sin_atribuir=ingreso_sin_atribuir,
        leads_sin_match=leads_sin_match,
    )
