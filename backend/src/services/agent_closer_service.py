"""Llamadas del closer para el agente externo (bot WhatsApp)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pony.orm import db_session

from src.models import Lead

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _naive_now_ar() -> datetime:
    return datetime.now(AR_TZ).replace(tzinfo=None)


def _today_bounds_ar() -> tuple[datetime, datetime, date]:
    hoy = datetime.now(AR_TZ).date()
    inicio = datetime.combine(hoy, time.min)
    fin = datetime.combine(hoy, time.max)
    return inicio, fin, hoy


def _fmt_hora(call: datetime | None) -> str:
    if call is None:
        return ""
    return call.strftime("%H:%M")


def _leads_with_call(user_id: int) -> list[Lead]:
    return list(Lead.select(lambda l: l.user_id == user_id and l.call is not None))


def _leads_call_between(user_id: int, inicio: datetime, fin: datetime) -> list[Lead]:
    """Solo leads con `call` en [inicio, fin] (filtro en query, no en Python)."""
    return list(
        Lead.select(
            lambda l: l.user_id == user_id
            and l.call is not None
            and l.call >= inicio
            and l.call <= fin
        )
    )


@db_session
def list_llamadas_hoy(user_id: int) -> dict:
    hoy = datetime.now(AR_TZ).date()
    return list_llamadas_dia(user_id, hoy)


@db_session
def list_llamadas_dia(user_id: int, fecha: date) -> dict:
    inicio = datetime.combine(fecha, time.min)
    fin = datetime.combine(fecha, time.max)
    rows = _leads_call_between(user_id, inicio, fin)
    rows.sort(key=lambda l: l.call or datetime.min)
    return {
        "fecha": fecha.isoformat(),
        "llamadas": [_llamada_item(l) for l in rows],
    }


def _call_iso(call: datetime | None) -> str | None:
    """UTC ISO con Z para que el frontend solo aplique Intl.timeZone una vez."""
    if call is None:
        return None
    from datetime import timezone as _tz

    dt = call
    if dt.tzinfo is not None:
        dt = dt.astimezone(_tz.utc).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


def _llamada_item(l: Lead) -> dict:
    status = (l.status or l.estado or "Pendiente").strip() or "Pendiente"
    return {
        "id": int(l.id),
        "hora": _fmt_hora(l.call),
        "lead": (l.nombre or "").strip(),
        "closer": (l.closer or "").strip(),
        "link_llamada": (l.link_llamada or "").strip(),
        "status": status,
        "payment": float(l.pago or 0),
        "owed": float(l.debe or 0),
        "program_offered": (l.programa_ofrecido or "").strip(),
        "programada_ofrecido_llamada": (l.programada_ofrecido_llamada or "").strip(),
        "calificacion_llamada": (getattr(l, "calificacion_llamada", None) or "").strip(),
        "call": _call_iso(l.call),
    }


@db_session
def list_proximas_llamadas(user_id: int, ventana: int) -> dict:
    ahora = _naive_now_ar()
    limite = ahora + timedelta(minutes=ventana)
    rows = [
        l
        for l in _leads_with_call(user_id)
        if ahora <= l.call <= limite and not bool(l.recordatorio_enviado)
    ]
    resultado = [
        {
            "hora": _fmt_hora(l.call),
            "lead": (l.nombre or "").strip(),
            "closer": (l.closer or "").strip(),
        }
        for l in rows
    ]
    for l in rows:
        l.recordatorio_enviado = True
    return {"llamadas": resultado}
