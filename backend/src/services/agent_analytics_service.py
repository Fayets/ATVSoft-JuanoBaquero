"""Embudo de ventas y performance de equipo para el agente externo (port de leads-analytics.ts)."""

from __future__ import annotations

import calendar
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pony.orm import db_session

from src.models import CloserReport, Lead, OfferedProgram, SeguimientoReport, SetterReport, TeamMember
from src.services.programs_services import build_program_norm_price_map, program_price_usd_for_prog_raw
from src.services.reels_services import ReelsServices
from src.services.stories_service import StoriesService

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
COMMISSION_PCT = 5.0


@dataclass
class _DailyReportRow:
    date: str
    conversaciones: int = 0
    agendas: int = 0
    leads_nuevos: int = 0
    seguimientos: int = 0
    outbounds: int = 0
    shows: int = 0
    cierres: int = 0
    ingreso: float = 0.0


def _parse_month(month: str) -> tuple[int, int]:
    if not re.match(r"^\d{4}-\d{2}$", month.strip()):
        raise ValueError("month debe ser YYYY-MM.")
    y_s, m_s = month.strip().split("-")
    y, m = int(y_s), int(m_s)
    if m < 1 or m > 12:
        raise ValueError("Mes inválido en month.")
    return y, m


def current_month_ar() -> str:
    return datetime.now(AR_TZ).strftime("%Y-%m")


def month_range(month: str) -> tuple[date, date]:
    y, m = _parse_month(month)
    start = date(y, m, 1)
    end = date(y, m, calendar.monthrange(y, m)[1])
    return start, end


def _lead_effective_dt(row: Lead) -> datetime | None:
    return row.fecha_bot or row.created_at


def _lead_month_ar(row: Lead) -> tuple[int, int] | None:
    dt = _lead_effective_dt(row)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_utc = dt.replace(tzinfo=timezone.utc)
    d_ar = d_utc.astimezone(AR_TZ)
    return d_ar.year, d_ar.month


def _week_index(day_of_month: int) -> int:
    return min(3, (day_of_month - 1) // 7)


def _program_prices_display(user_id: int) -> dict[str, float]:
    t = unicodedata.normalize("NFD", (name or "").strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def _program_prices_display(user_id: int) -> dict[str, float]:
    """Mapa nombre original → precio (para facturación como en el front)."""
    with db_session:
        rows = [p for p in list(OfferedProgram.select()) if int(p.user_id) == user_id]
    out: dict[str, float] = {}
    for p in rows:
        name = str(p.name or "").strip()
        if name:
            out[name] = float(p.price_usd or 0)
    return out


def _leads_for_month(user_id: int, month: str) -> list[Lead]:
    month_key = _parse_month(month)
    with db_session:
        rows = [
            r
            for r in list(Lead.select())
            if int(r.user_id) == user_id and r.agendo is not None
        ]
    return [r for r in rows if (mb := _lead_month_ar(r)) is not None and mb == month_key]


def _lead_facturacion_usd(
    row: Lead,
    *,
    catalog_defined: bool,
    program_prices: dict[str, float],
    norm_prices: dict[str, float],
) -> float:
    prog = (row.programa_ofrecido or "").strip()
    api_price = program_price_usd_for_prog_raw(norm_prices, row.programa_ofrecido)

    if not prog:
        if not catalog_defined and api_price is None:
            return float(row.pago or 0)
        return 0.0

    if api_price is not None:
        return float(api_price)

    nk = _norm_program_key(prog)
    for k, v in program_prices.items():
        if _norm_program_key(k) == nk:
            return float(v)
    return float(row.pago or 0)


def _load_team_reports(user_id: int, start: date, end: date) -> tuple[list[_DailyReportRow], list[_DailyReportRow]]:
    setter_rows: list[_DailyReportRow] = []
    closer_rows: list[_DailyReportRow] = []
    with db_session:
        for r in list(SetterReport.select()):
            if r.user_id != user_id or not (start <= r.fecha <= end):
                continue
            setter_rows.append(
                _DailyReportRow(
                    date=r.fecha.isoformat(),
                    conversaciones=int(r.conversaciones or 0),
                    agendas=int(r.agendas or 0),
                    leads_nuevos=int(getattr(r, "leads_nuevos", 0) or 0),
                    seguimientos=int(getattr(r, "seguimientos", 0) or 0),
                    outbounds=int(getattr(r, "outbounds", 0) or 0),
                )
            )
        for r in list(CloserReport.select()):
            if r.user_id != user_id or not (start <= r.fecha <= end):
                continue
            closer_rows.append(
                _DailyReportRow(
                    date=r.fecha.isoformat(),
                    shows=int(r.shows or 0),
                    cierres=int(r.cierres or 0),
                    ingreso=float(r.ingreso or 0),
                )
            )
    return setter_rows, closer_rows


def _sum_field(rows: list[_DailyReportRow], field: str) -> float:
    return float(sum(getattr(r, field, 0) for r in rows))


def _content_chats(user_id: int, month: str) -> tuple[int, int, int]:
    uid_str = str(user_id)
    reels = ReelsServices().get_metrics(uid_str, month)
    stories = StoriesService().get_metrics(uid_str, month)
    chats_reels = int(reels.get("chats_del_mes") or 0)
    chats_stories = int(stories.get("chats_del_mes") or 0)
    return chats_reels + chats_stories, chats_reels, chats_stories


def _seguimiento_month(user_id: int, start: date, end: date) -> tuple[float, list[dict[str, Any]]]:
    entries: list[dict[str, Any]] = []
    with db_session:
        for r in list(SeguimientoReport.select()):
            if r.user_id != user_id or not (start <= r.fecha <= end):
                continue
            entries.append({"fecha": r.fecha.isoformat(), "monto": float(r.monto or 0)})
    total = sum(e["monto"] for e in entries)
    return total, entries


def _build_weekly_buckets(
    setter_rows: list[_DailyReportRow],
    closer_rows: list[_DailyReportRow],
) -> dict[str, list[int]]:
    agendas = [0, 0, 0, 0]
    cierres = [0, 0, 0, 0]
    for r in setter_rows:
        try:
            day = int(r.date.split("-")[2])
        except (IndexError, ValueError):
            continue
        w = _week_index(day)
        agendas[w] += int(r.agendas)
    for r in closer_rows:
        try:
            day = int(r.date.split("-")[2])
        except (IndexError, ValueError):
            continue
        w = _week_index(day)
        cierres[w] += int(r.cierres)
    return {"agendas": agendas, "cierres": cierres}


def build_resumen(user_id: int, month: str) -> dict[str, Any]:
    start, end = month_range(month)
    leads = _leads_for_month(user_id, month)
    program_prices = _program_prices_display(user_id)
    with db_session:
        norm_prices = build_program_norm_price_map(user_id)

    setter_rows, closer_rows = _load_team_reports(user_id, start, end)
    seguimiento_total, _ = _seguimiento_month(user_id, start, end)
    chats, _, _ = _content_chats(user_id, month)

    conversaciones = int(_sum_field(setter_rows, "conversaciones"))
    leads_nuevos = int(_sum_field(setter_rows, "leads_nuevos"))
    agendas = int(_sum_field(setter_rows, "agendas"))
    shows = int(_sum_field(closer_rows, "shows"))
    cierres = int(_sum_field(closer_rows, "cierres"))
    ingresos_reports = _sum_field(closer_rows, "ingreso")

    cash_from_leads = sum(float(r.pago or 0) for r in leads)
    ingresos = cash_from_leads + seguimiento_total

    catalog_defined = len(program_prices) > 0
    leads_with_program = sum(1 for r in leads if (r.programa_ofrecido or "").strip())

    revenue_leads = sum(
        _lead_facturacion_usd(
            r,
            catalog_defined=catalog_defined,
            program_prices=program_prices,
            norm_prices=norm_prices,
        )
        for r in leads
    )
    facturacion = revenue_leads if revenue_leads > 0 else ingresos_reports

    billing_uses_programs = catalog_defined or any(
        (r.programa_ofrecido or "").strip()
        and program_price_usd_for_prog_raw(norm_prices, r.programa_ofrecido) is not None
        for r in leads
    )
    avg_ticket_from_billing: float | None = None
    if (catalog_defined or billing_uses_programs) and leads_with_program > 0:
        avg_ticket_from_billing = facturacion / leads_with_program

    if avg_ticket_from_billing is not None:
        ticket_promedio = avg_ticket_from_billing
    elif cierres > 0:
        ticket_promedio = ingresos / cierres
    else:
        ticket_promedio = 0.0

    close_rate = (cierres / shows * 100.0) if shows > 0 else 0.0
    show_rate = (shows / agendas * 100.0) if agendas > 0 else 0.0
    tasa_agendamiento = (agendas / conversaciones * 100.0) if conversaciones > 0 else 0.0
    cash_por_chat = (ingresos / chats) if chats > 0 else 0.0

    prog_map: dict[str, dict[str, float | int]] = {}
    for row in leads:
        p = (row.programa_ofrecido or "").strip()
        if not p:
            continue
        bucket = prog_map.setdefault(p, {"ventas": 0, "ingresos": 0.0})
        bucket["ventas"] = int(bucket["ventas"]) + 1
        if catalog_defined:
            bucket["ingresos"] = float(bucket["ingresos"]) + _lead_facturacion_usd(
                row,
                catalog_defined=catalog_defined,
                program_prices=program_prices,
                norm_prices=norm_prices,
            )
        else:
            bucket["ingresos"] = float(bucket["ingresos"]) + float(row.pago or 0)

    programas = [
        {"nombre": nombre, "ventas": int(v["ventas"]), "ingresos": round(float(v["ingresos"]), 2)}
        for nombre, v in sorted(prog_map.items(), key=lambda x: float(x[1]["ingresos"]), reverse=True)
    ]

    por_semana = _build_weekly_buckets(setter_rows, closer_rows)

    return {
        "month": month.strip(),
        "conversaciones": conversaciones,
        "leads_nuevos": leads_nuevos,
        "agendas": agendas,
        "shows": shows,
        "cierres": cierres,
        "ingresos": round(ingresos, 2),
        "facturacion": round(facturacion, 2),
        "close_rate": round(close_rate, 2),
        "show_rate": round(show_rate, 2),
        "tasa_agendamiento": round(tasa_agendamiento, 2),
        "ticket_promedio": round(ticket_promedio, 2),
        "cash_por_chat": round(cash_por_chat, 2),
        "programas": programas,
        "por_semana": por_semana,
    }


def _team_avg_ticket(user_id: int, start: date, end: date) -> float:
    cash_total = 0.0
    total_cierres = 0
    with db_session:
        for r in list(CloserReport.select()):
            if r.user_id != user_id or not (start <= r.fecha <= end):
                continue
            cash_total += float(r.ingreso or 0)
            total_cierres += int(r.cierres or 0)
    return (cash_total / total_cierres) if total_cierres > 0 else 0.0


def _match_members(user_id: int, nombre: str) -> list[TeamMember]:
    q = (nombre or "").strip().casefold()
    if not q:
        return []
    with db_session:
        return [
            m
            for m in list(TeamMember.select())
            if m.user_id == user_id and q in (m.nombre or "").casefold()
        ]


def build_miembro(user_id: int, nombre: str, month: str) -> list[dict[str, Any]] | dict[str, Any] | None:
    start, end = month_range(month)
    matches = _match_members(user_id, nombre)

    if not matches:
        return None

    supported = [m for m in matches if m.rol in ("setter", "closer")]
    if not supported:
        return None

    if len(supported) > 1:
        return [{"id": int(m.id), "nombre": m.nombre, "rol": m.rol} for m in supported]

    member = supported[0]
    mid = int(member.id)
    pct = COMMISSION_PCT / 100.0

    if member.rol == "setter":
        totals = {
            "conversaciones": 0,
            "agendas": 0,
            "links_enviados": 0,
            "leads_nuevos": 0,
            "seguimientos": 0,
        }
        with db_session:
            for r in list(SetterReport.select()):
                if r.user_id != user_id or r.member_id != mid or not (start <= r.fecha <= end):
                    continue
                totals["conversaciones"] += int(r.conversaciones or 0)
                totals["agendas"] += int(r.agendas or 0)
                totals["links_enviados"] += int(r.links_enviados or 0)
                totals["leads_nuevos"] += int(getattr(r, "leads_nuevos", 0) or 0)
                totals["seguimientos"] += int(getattr(r, "seguimientos", 0) or 0)

        avg_ticket = _team_avg_ticket(user_id, start, end)
        generado = avg_ticket * totals["agendas"]
        comision = generado * pct

        return {
            "nombre": member.nombre,
            "rol": "setter",
            "month": month.strip(),
            "conversaciones": totals["conversaciones"],
            "agendas": totals["agendas"],
            "links_enviados": totals["links_enviados"],
            "leads_nuevos": totals["leads_nuevos"],
            "seguimientos": totals["seguimientos"],
            "generado": round(generado, 2),
            "comision": round(comision, 2),
        }

    totals = {
        "llamadas_agendadas": 0,
        "shows": 0,
        "cierres": 0,
        "calificados": 0,
        "descalificados": 0,
        "ingreso": 0.0,
    }
    with db_session:
        for r in list(CloserReport.select()):
            if r.user_id != user_id or r.member_id != mid or not (start <= r.fecha <= end):
                continue
            totals["llamadas_agendadas"] += int(r.llamadas_agendadas or 0)
            totals["shows"] += int(r.shows or 0)
            totals["cierres"] += int(r.cierres or 0)
            totals["calificados"] += int(r.calificados or 0)
            totals["descalificados"] += int(r.descalificados or 0)
            totals["ingreso"] += float(r.ingreso or 0)

    shows = totals["shows"]
    cierres = totals["cierres"]
    llamadas = totals["llamadas_agendadas"]
    ingreso = totals["ingreso"]
    close_rate = (cierres / shows * 100.0) if shows > 0 else 0.0
    show_rate = (shows / llamadas * 100.0) if llamadas > 0 else 0.0
    comision = ingreso * pct

    return {
        "nombre": member.nombre,
        "rol": "closer",
        "month": month.strip(),
        "llamadas_agendadas": llamadas,
        "shows": shows,
        "cierres": cierres,
        "calificados": totals["calificados"],
        "descalificados": totals["descalificados"],
        "ingreso": round(ingreso, 2),
        "close_rate": round(close_rate, 2),
        "show_rate": round(show_rate, 2),
        "comision": round(comision, 2),
    }
