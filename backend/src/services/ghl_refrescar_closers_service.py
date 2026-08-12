"""Refresca solo closer/closer_norm desde GHL para leads con cita."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from pony.orm import db_session, flush

from src.controllers.ghl_controller import (
    _GHL_NAIVE_TZ,
    _ghl_appointment_id,
    _ghl_get,
    _ghl_owner_from_sync,
    _iter_contacts_with_appointments,
)
from src.models import Lead
from src.services.legacy_juano_import import merge_meta, normalize_closer


def _call_day_bogota(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    aware = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return aware.astimezone(_GHL_NAIVE_TZ).date()


def _norm_closer(name: str) -> str:
    return normalize_closer((name or "").strip()).casefold()


def _append_refrescar_audit(meta: dict[str, Any], antes: str, despues: str) -> dict[str, Any]:
    base = merge_meta(meta, {})
    actualizaciones = base.get("actualizaciones")
    if not isinstance(actualizaciones, list):
        actualizaciones = []
    actualizaciones.append(
        {
            "fecha": date.today().isoformat(),
            "campo": "closer",
            "antes": antes,
            "despues": despues,
            "origen": "refrescar_closers_ghl",
        }
    )
    base["actualizaciones"] = actualizaciones
    return base


def _fetch_event_map_for_day(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    day: date,
    contact_cache: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """appointment_id → {appointment, contact}."""
    out: dict[str, dict[str, Any]] = {}
    for item in _iter_contacts_with_appointments(
        client, token, location_id, calendar_id, fecha=day
    ):
        appt = item["appointment"]
        appt_id = _ghl_appointment_id(appt)
        if appt_id:
            out[appt_id] = item
    return out


def _fetch_event_fallback(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    appt_id: str,
    call_day: date | None,
    contact_cache: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if call_day is not None:
        found = _fetch_event_map_for_day(
            client, token, location_id, calendar_id, call_day, contact_cache
        ).get(appt_id)
        if found:
            return found

    headers = {"Authorization": f"Bearer {token}", "Version": "2021-07-28"}
    for path in (f"/calendars/events/{appt_id}", f"/calendars/appointments/{appt_id}"):
        try:
            r = client.get(
                f"https://services.leadconnectorhq.com{path}",
                headers=headers,
                params={"locationId": location_id},
            )
            if r.status_code == 404:
                continue
            r.raise_for_status()
            data = r.json()
            event = data.get("event") or data.get("appointment") or data
            if not isinstance(event, dict):
                continue
            cid = str(event.get("contactId") or event.get("contact_id") or "").strip()
            contact: dict[str, Any] = {}
            if cid:
                if cid not in contact_cache:
                    cdata = _ghl_get(client, token, f"/contacts/{cid}")
                    contact = (
                        cdata.get("contact")
                        if isinstance(cdata.get("contact"), dict)
                        else cdata
                    )
                    if not isinstance(contact, dict):
                        contact = {"id": cid}
                    contact_cache[cid] = contact
                else:
                    contact = contact_cache[cid]
            return {"appointment": event, "contact": contact}
        except Exception:
            continue
    return None


@db_session
def _lead_snapshots_in_range(user_id: int, desde: date, hasta: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for lead in list(Lead.select()):
        if int(lead.user_id) != user_id:
            continue
        appt_id = (lead.ghl_appointment_id or "").strip()
        if not appt_id:
            continue
        call_day = _call_day_bogota(lead.call)
        if call_day is None or call_day < desde or call_day > hasta:
            continue
        rows.append(
            {
                "id": int(lead.id),
                "ghl_appointment_id": appt_id,
                "call": lead.call,
                "closer": (lead.closer or "").strip(),
                "nombre": (lead.nombre or "").strip(),
                "legacy_meta": (
                    dict(lead.legacy_meta) if isinstance(lead.legacy_meta, dict) else {}
                ),
            }
        )
    return rows


@db_session
def _apply_closer_updates(updates: list[dict[str, Any]]) -> None:
    for item in updates:
        lead = Lead.get(id=item["lead_id"])
        if lead is None:
            continue
        lead.closer = item["despues"]
        lead.closer_norm = item["despues"]
        lead.legacy_meta = item["legacy_meta"]
    if updates:
        flush()


def refrescar_closers_from_ghl(
    user_id: int,
    token: str,
    location_id: str,
    calendar_id: str,
    *,
    desde: date,
    hasta: date,
) -> dict[str, Any]:
    if desde > hasta:
        raise ValueError("desde no puede ser posterior a hasta.")

    leads = _lead_snapshots_in_range(user_id, desde, hasta)
    revisadas = len(leads)

    actualizadas = 0
    sin_cambio = 0
    api_error = 0
    detalle: list[dict[str, Any]] = []
    pending_updates: list[dict[str, Any]] = []

    user_cache: dict[str, str] = {}
    contact_cache: dict[str, dict[str, Any]] = {}
    event_cache: dict[str, dict[str, Any]] = {}

    with httpx.Client(timeout=300.0) as client:
        day = desde
        while day <= hasta:
            event_cache.update(
                _fetch_event_map_for_day(
                    client, token, location_id, calendar_id, day, contact_cache
                )
            )
            day += timedelta(days=1)

        for lead in leads:
            appt_id = lead["ghl_appointment_id"]
            item = event_cache.get(appt_id)
            if item is None:
                item = _fetch_event_fallback(
                    client,
                    token,
                    location_id,
                    calendar_id,
                    appt_id,
                    _call_day_bogota(lead["call"]),
                    contact_cache,
                )
            if item is None:
                api_error += 1
                continue

            appointment = item["appointment"]
            contact = item.get("contact") or {}
            try:
                ghl_closer_raw = _ghl_owner_from_sync(
                    client, token, appointment, contact, user_cache
                )
            except Exception:
                api_error += 1
                continue

            ghl_closer = (
                normalize_closer(ghl_closer_raw.strip()) if ghl_closer_raw.strip() else ""
            )
            if not ghl_closer:
                sin_cambio += 1
                continue

            atv_closer = lead["closer"]
            if _norm_closer(ghl_closer) == _norm_closer(atv_closer):
                sin_cambio += 1
                continue

            meta = _append_refrescar_audit(lead["legacy_meta"], atv_closer, ghl_closer)
            pending_updates.append(
                {
                    "lead_id": lead["id"],
                    "legacy_meta": meta,
                    "despues": ghl_closer,
                }
            )
            actualizadas += 1
            detalle.append(
                {
                    "lead_id": lead["id"],
                    "nombre": lead["nombre"],
                    "antes": atv_closer,
                    "despues": ghl_closer,
                }
            )

    if pending_updates:
        _apply_closer_updates(pending_updates)

    return {
        "revisadas": revisadas,
        "actualizadas": actualizadas,
        "sin_cambio": sin_cambio,
        "api_error": api_error,
        "detalle": detalle,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
    }
