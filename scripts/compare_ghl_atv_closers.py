#!/usr/bin/env python3
"""Compara closer en ATV vs responsable actual en GHL (API).

Uso:
  cd backend && python ../scripts/compare_ghl_atv_closers.py
  cd backend && python ../scripts/compare_ghl_atv_closers.py --appointment guLCqReFbgEq8S9dvase
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import httpx  # noqa: E402
from pony.orm import db_session  # noqa: E402

from src.controllers.ghl_controller import (  # noqa: E402
    _GHL_API,
    _GHL_NAIVE_TZ,
    _GHL_VERSION,
    _day_bounds_ms,
    _extract_events_list,
    _ghl_appointment_id,
    _ghl_get,
    _ghl_owner_from_sync,
    _ghl_person_display_name,
    _resolve_ghl_user_name,
)
from src.db import init_db  # noqa: E402
from src.models import ApiConnection, Lead  # noqa: E402
from src.services.legacy_juano_import import normalize_closer  # noqa: E402

UID = 1
BOGOTA = ZoneInfo("America/Bogota")


def _norm(name: str) -> str:
    return normalize_closer((name or "").strip()).casefold()


def _load_ghl_creds() -> dict[str, str]:
    with db_session:
        conn = ApiConnection.get(user_id=UID, platform="ghl")
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        location_id = str(creds.get("location_id") or "").strip()
        calendar_id = str(creds.get("calendar_id") or "").strip()
        if not token or not location_id or not calendar_id:
            raise RuntimeError("Faltan credenciales GHL en ApiConnection")
        return {"token": token, "location_id": location_id, "calendar_id": calendar_id}


def _fetch_event_by_id(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    appt_id: str,
    call_day: date | None,
) -> dict | None:
    """Intenta GET directo; fallback: lista eventos del día de la cita."""
    headers = {"Authorization": f"Bearer {token}", "Version": _GHL_VERSION}
    for path in (f"/calendars/events/{appt_id}", f"/calendars/appointments/{appt_id}"):
        try:
            time.sleep(0.2)
            r = client.get(f"{_GHL_API}{path}", headers=headers, params={"locationId": location_id})
            if r.status_code == 404:
                continue
            r.raise_for_status()
            data = r.json()
            event = data.get("event") or data.get("appointment") or data
            if isinstance(event, dict) and _ghl_appointment_id(event):
                return event
        except Exception:
            continue

    if call_day is None:
        return None
    start_ms, end_ms = _day_bounds_ms(call_day)
    data = _ghl_get(
        client,
        token,
        "/calendars/events",
        params={
            "locationId": location_id,
            "calendarId": calendar_id,
            "startTime": start_ms,
            "endTime": end_ms,
        },
    )
    for event in _extract_events_list(data):
        if isinstance(event, dict) and _ghl_appointment_id(event) == appt_id:
            return event
    return None


def _ghl_closer_for_event(
    client: httpx.Client,
    token: str,
    event: dict,
    contact: dict,
    cache: dict[str, str],
) -> tuple[str, str]:
    closer = _ghl_owner_from_sync(client, token, event, contact, cache)
    user_id = str(event.get("assignedUserId") or event.get("assigned_user_id") or "").strip()
    return closer, user_id


def _contact_for_event(
    client: httpx.Client,
    token: str,
    event: dict,
    cache: dict[str, dict],
) -> dict:
    cid = str(event.get("contactId") or event.get("contact_id") or "").strip()
    if not cid:
        return {}
    if cid in cache:
        return cache[cid]
    time.sleep(0.2)
    data = _ghl_get(client, token, f"/contacts/{cid}")
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else data
    if not isinstance(contact, dict):
        contact = {"id": cid}
    cache[cid] = contact
    return contact


@db_session
def _sample_leads(limit: int, include_id: int | None) -> list[Lead]:
    rows = [
        l
        for l in list(Lead.select())
        if int(l.user_id) == UID and (l.ghl_appointment_id or "").strip()
    ]
    rows.sort(key=lambda x: x.call or datetime.min, reverse=True)
    picked: list[Lead] = []
    seen: set[str] = set()
    if include_id is not None:
        for l in rows:
            if int(l.id) == include_id:
                ap = (l.ghl_appointment_id or "").strip()
                if ap:
                    picked.append(l)
                    seen.add(ap)
                break
    for l in rows:
        ap = (l.ghl_appointment_id or "").strip()
        if not ap or ap in seen:
            continue
        picked.append(l)
        seen.add(ap)
        if len(picked) >= limit:
            break
    return picked


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=30)
    parser.add_argument("--appointment", default="guLCqReFbgEq8S9dvase")
    parser.add_argument("--lead-id", type=int, default=7022)
    args = parser.parse_args()

    init_db()
    creds = _load_ghl_creds()
    token = creds["token"]
    location_id = creds["location_id"]
    calendar_id = creds["calendar_id"]

    user_cache: dict[str, str] = {}
    contact_cache: dict[str, dict] = {}

    with httpx.Client(timeout=120.0) as client:
        print("=== 1.1 Jose Ortiz — appointment en GHL ===")
        with db_session:
            lead = Lead.get(id=args.lead_id)
            call_day = None
            if lead and lead.call:
                call_day = lead.call.replace(tzinfo=ZoneInfo("UTC")).astimezone(BOGOTA).date()

        event = _fetch_event_by_id(
            client, token, location_id, calendar_id, args.appointment, call_day
        )
        if event is None:
            print(f"NO encontrado en GHL: {args.appointment}")
        else:
            contact = _contact_for_event(client, token, event, contact_cache)
            ghl_closer, ghl_user_id = _ghl_closer_for_event(
                client, token, event, contact, user_cache
            )
            start = event.get("startTime") or event.get("start_time")
            status = event.get("appointmentStatus") or event.get("status")
            print(f"appointment_id: {args.appointment}")
            print(f"startTime: {start}")
            print(f"status: {status}")
            print(f"assignedUserId: {ghl_user_id}")
            print(f"closer GHL (resuelto): {ghl_closer!r}")
            if lead:
                print(f"ATV lead {lead.id}: closer={lead.closer!r} created_at={lead.created_at}")
                print(f"¿Coincide? {'SÍ' if _norm(ghl_closer) == _norm(lead.closer or '') else 'NO'}")

        print("\n=== 1.3 Muestra GHL vs ATV ===")
        leads = _sample_leads(args.sample, include_id=args.lead_id)
        print(f"Leads muestreados: {len(leads)}")

        match = 0
        mismatch = 0
        empty_atv = 0
        empty_ghl = 0
        api_miss = 0
        rows_out: list[tuple] = []

        for lead in leads:
            appt_id = (lead.ghl_appointment_id or "").strip()
            call_day = None
            if lead.call:
                call_day = lead.call.replace(tzinfo=ZoneInfo("UTC")).astimezone(BOGOTA).date()

            event = _fetch_event_by_id(
                client, token, location_id, calendar_id, appt_id, call_day
            )
            if event is None:
                api_miss += 1
                rows_out.append((appt_id[:16], lead.nombre[:20], "?", lead.closer or "", "?", "API?"))
                continue

            contact = _contact_for_event(client, token, event, contact_cache)
            ghl_closer, _ = _ghl_closer_for_event(client, token, event, contact, user_cache)
            atv_closer = (lead.closer or "").strip()
            ok = bool(ghl_closer and atv_closer and _norm(ghl_closer) == _norm(atv_closer))
            if not ghl_closer:
                empty_ghl += 1
            if not atv_closer:
                empty_atv += 1
            if ok:
                match += 1
                flag = "OK"
            elif not ghl_closer and not atv_closer:
                match += 1
                flag = "OK(vacío)"
            else:
                mismatch += 1
                flag = "NO"
            rows_out.append(
                (appt_id[:16], (lead.nombre or "")[:20], ghl_closer[:22], atv_closer[:22], flag, str(lead.call)[:16])
            )

        print(f"\n{'appt_id':16} {'contacto':20} {'GHL':22} {'ATV':22} {'ok':8} call")
        print("-" * 100)
        for row in rows_out:
            print(f"{row[0]:16} {row[1]:20} {row[2]:22} {row[3]:22} {row[4]:8} {row[5]}")

        comparable = len(leads) - api_miss
        print(f"\nCoinciden: {match}/{comparable} (muestra total {len(leads)}, API miss {api_miss})")
        print(f"Discrepancias: {mismatch} | ATV sin closer: {empty_atv} | GHL sin closer: {empty_ghl}")

        if mismatch:
            print("\nDiscrepancias detalle:")
            for row in rows_out:
                if row[4] == "NO":
                    print(f"  {row[1]} | GHL={row[2]!r} ATV={row[3]!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
