"""Generación automática del reporte diario de ventas del closer desde leads del panel."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from pony.orm import db_session, flush

from src.models import CloserReport, Lead, TeamMember
from src.services.agent_closer_service import _day_bounds_utc_naive, _tz_for_user
from src.services.discord_service import DiscordServices

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
discord_service = DiscordServices()


def _day_bounds(user_id: int, fecha: date) -> tuple[datetime, datetime]:
    """Día civil del tenant → [inicio, fin] UTC naive (igual que el panel diario)."""
    return _day_bounds_utc_naive(fecha, _tz_for_user(user_id))


def _lead_status(l: Lead) -> str:
    return (l.status or l.estado or "Pendiente").strip().lower()


def _lead_closer_name(l: Lead) -> str:
    return (l.closer or "").strip()


def _calificacion(l: Lead) -> str:
    return (getattr(l, "calificacion_llamada", None) or "").strip().lower()


def leads_for_closer_on_date(user_id: int, fecha: date, closer_name: str) -> list[Lead]:
    inicio, fin = _day_bounds(user_id, fecha)
    target = closer_name.strip().lower()
    rows: list[Lead] = []
    for lead in list(Lead.select()):
        if int(lead.user_id) != user_id or lead.call is None:
            continue
        if not (inicio <= lead.call <= fin):
            continue
        if _lead_closer_name(lead).lower() != target:
            continue
        rows.append(lead)
    return rows


def aggregate_closer_metrics(leads: list[Lead]) -> dict[str, int | float]:
    llamadas = len(leads)
    shows = sum(1 for lead in leads if _lead_status(lead) != "no show")
    cierres = sum(1 for lead in leads if _lead_status(lead) == "cerrado")
    calificados = sum(1 for lead in leads if _calificacion(lead) == "calificado")
    descalificados = sum(1 for lead in leads if _calificacion(lead) == "descalificado")
    ingreso = sum(float(lead.pago or 0) for lead in leads)
    return {
        "llamadas_agendadas": llamadas,
        "shows": shows,
        "cierres": cierres,
        "calificados": calificados,
        "descalificados": descalificados,
        "ingreso": ingreso,
    }


def find_closer_member(user_id: int, closer_name: str) -> TeamMember | None:
    target = closer_name.strip().lower()
    for member in list(TeamMember.select()):
        if int(member.user_id) != user_id or not member.activo or member.rol != "closer":
            continue
        if member.nombre.strip().lower() == target:
            return member
    return None


def closer_names_with_calls_on_date(user_id: int, fecha: date) -> set[str]:
    inicio, fin = _day_bounds(user_id, fecha)
    names: set[str] = set()
    for lead in list(Lead.select()):
        if int(lead.user_id) != user_id or lead.call is None:
            continue
        if not (inicio <= lead.call <= fin):
            continue
        name = _lead_closer_name(lead)
        if name:
            names.add(name)
    return names


def _member_name(user_id: int, member_id: int) -> str:
    for member in list(TeamMember.select()):
        if int(member.user_id) == user_id and int(member.id) == member_id:
            return member.nombre
    return "(sin miembro)"


def _discord_payload_from_report(report: CloserReport) -> dict[str, Any]:
    return {
        "fecha": report.fecha.isoformat(),
        "llamadas_agendadas": int(report.llamadas_agendadas),
        "shows": int(report.shows),
        "cierres": int(report.cierres),
        "calificados": int(report.calificados),
        "descalificados": int(report.descalificados),
        "ingreso": float(report.ingreso),
    }


def upsert_closer_report(
    user_id: int,
    member_id: int,
    fecha: date,
    metrics: dict[str, int | float],
    *,
    send_discord: bool = True,
) -> CloserReport:
    existing = [
        report
        for report in list(CloserReport.select())
        if int(report.user_id) == user_id
        and int(report.member_id) == member_id
        and report.fecha == fecha
    ]
    if existing:
        report = existing[0]
        report.llamadas_agendadas = int(metrics["llamadas_agendadas"])
        report.shows = int(metrics["shows"])
        report.cierres = int(metrics["cierres"])
        report.calificados = int(metrics["calificados"])
        report.descalificados = int(metrics["descalificados"])
        report.ingreso = float(metrics["ingreso"])
        report.shows_organico = 0
        report.shows_ads = 0
        report.cierres_organico = 0
        report.cierres_ads = 0
        report.notas = ""
    else:
        report = CloserReport(
            user_id=user_id,
            member_id=member_id,
            fecha=fecha,
            llamadas_agendadas=int(metrics["llamadas_agendadas"]),
            shows=int(metrics["shows"]),
            cierres=int(metrics["cierres"]),
            calificados=int(metrics["calificados"]),
            descalificados=int(metrics["descalificados"]),
            ingreso=float(metrics["ingreso"]),
            shows_organico=0,
            shows_ads=0,
            cierres_organico=0,
            cierres_ads=0,
            notas="",
        )
        flush()

    if send_discord and discord_service.is_closer_ventas_webhook_configured():
        member_name = _member_name(user_id, member_id)
        try:
            discord_service.send_closer_ventas_to_discord(
                member_name,
                _discord_payload_from_report(report),
            )
        except Exception:
            pass

    return report


@db_session
def generate_closer_report_for_member(
    user_id: int,
    member_id: int,
    fecha: date,
    *,
    send_discord: bool = True,
) -> tuple[CloserReport, bool]:
    """Genera o actualiza el reporte del closer desde el panel diario."""
    member = None
    for row in TeamMember.select():
        if int(row.user_id) == user_id and int(row.id) == member_id:
            member = row
            break
    if member is None or member.rol != "closer":
        raise ValueError("Closer no encontrado.")

    had_existing = any(
        int(report.user_id) == user_id
        and int(report.member_id) == member_id
        and report.fecha == fecha
        for report in list(CloserReport.select())
    )

    leads = leads_for_closer_on_date(user_id, fecha, member.nombre)
    if not leads:
        raise ValueError("No hay llamadas en el panel para este closer en esta fecha.")

    metrics = aggregate_closer_metrics(leads)
    report = upsert_closer_report(
        user_id,
        member_id,
        fecha,
        metrics,
        send_discord=send_discord,
    )
    return report, had_existing


@db_session
def preview_closer_report(user_id: int, member_id: int, fecha: date) -> dict[str, int | float]:
    member = None
    for row in TeamMember.select():
        if int(row.user_id) == user_id and int(row.id) == member_id:
            member = row
            break
    if member is None or member.rol != "closer":
        raise ValueError("Closer no encontrado.")
    leads = leads_for_closer_on_date(user_id, fecha, member.nombre)
    return aggregate_closer_metrics(leads)


@db_session
def generate_daily_reports_for_user(
    user_id: int,
    fecha: date | None = None,
    *,
    send_discord: bool = True,
) -> int:
    target_date = fecha or datetime.now(AR_TZ).date()
    generated = 0
    for closer_name in closer_names_with_calls_on_date(user_id, target_date):
        member = find_closer_member(user_id, closer_name)
        if member is None:
            continue
        leads = leads_for_closer_on_date(user_id, target_date, closer_name)
        if not leads:
            continue
        metrics = aggregate_closer_metrics(leads)
        upsert_closer_report(
            user_id,
            int(member.id),
            target_date,
            metrics,
            send_discord=send_discord,
        )
        generated += 1
    return generated


def generate_daily_reports_all_users(*, send_discord: bool = True) -> None:
    user_ids: set[int] = set()
    with db_session:
        for lead in list(Lead.select()):
            if lead.call is not None:
                user_ids.add(int(lead.user_id))
    for uid in sorted(user_ids):
        try:
            count = generate_daily_reports_for_user(uid, send_discord=send_discord)
            print(f"[closer-auto] user={uid} reportes={count}")
        except Exception as exc:
            print(f"[closer-auto] user={uid} error: {exc}")
