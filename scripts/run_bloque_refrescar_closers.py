#!/usr/bin/env python3
"""Ejecuta bloque refrescar closers: Jose Ortiz, huérfanas jul, reporte Martín."""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session  # noqa: E402

from src.controllers.ghl_controller import _run_ghl_sync  # noqa: E402
from src.db import init_db  # noqa: E402
from src.models import ApiConnection, Lead  # noqa: E402
from src.services.ghl_refrescar_closers_service import refrescar_closers_from_ghl  # noqa: E402

UID = 1


def _ghl_creds() -> tuple[str, str, str]:
    with db_session:
        conn = ApiConnection.get(user_id=UID, platform="ghl")
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        location_id = str(creds.get("location_id") or "").strip()
        calendar_id = str(creds.get("calendar_id") or "").strip()
        if not token or not location_id or not calendar_id:
            raise RuntimeError("Faltan credenciales GHL")
        return token, location_id, calendar_id


def step_jose_ortiz() -> None:
    print("\n=== 1. Sync Jose Ortiz (2026-08-11) ===")
    token, location_id, calendar_id = _ghl_creds()
    result = _run_ghl_sync(
        UID, token, location_id, calendar_id, month=None, fecha=date(2026, 8, 11)
    )
    print("sync result:", result)
    with db_session:
        lead = Lead.get(id=7022)
        if lead:
            print(
                f"lead 7022: closer={lead.closer!r} call={lead.call} appt={lead.ghl_appointment_id}"
            )


def step_huerfanas() -> None:
    print("\n=== 3. Recuperación 15 huérfanas jul ===")
    token, location_id, calendar_id = _ghl_creds()
    ranges = [
        (date(2026, 7, 1), date(2026, 7, 3)),
        (date(2026, 7, 25), date(2026, 7, 25)),
    ]
    total = {"revisadas": 0, "actualizadas": 0, "sin_cambio": 0, "api_error": 0}
    detalle: list[dict] = []
    for desde, hasta in ranges:
        print(f"Rango {desde} → {hasta}")
        r = refrescar_closers_from_ghl(
            UID, token, location_id, calendar_id, desde=desde, hasta=hasta
        )
        for k in total:
            total[k] += int(r[k])
        detalle.extend(r["detalle"])
        print(r)

    print("\nRECUPERACIÓN 15 CITAS HUÉRFANAS")
    print(f"Revisadas        : {total['revisadas']}")
    print(f"Recuperadas      : {total['actualizadas']}")
    print(f"Sin cambio       : {total['sin_cambio']}")
    print(f"API error        : {total['api_error']}")
    if detalle:
        print("\nDetalle recuperadas:")
        for d in detalle:
            with db_session:
                lead = Lead.get(id=d["lead_id"])
                call_d = lead.call.date() if lead and lead.call else "?"
            print(f"  {d['lead_id']} | {d['nombre']} | {call_d} | {d['despues']}")

    import psycopg2
    from decouple import config

    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default="5432"),
        sslmode=config("DB_SSLMODE", default="require"),
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, nombre, call::date, ghl_appointment_id
        FROM lead
        WHERE user_id = %s
          AND COALESCE(closer,'') = ''
          AND COALESCE(TRIM(ghl_appointment_id),'') <> ''
        ORDER BY call
        """,
        (UID,),
    )
    remaining = cur.fetchall()
    cur.execute(
        """
        SELECT COUNT(*) FROM lead
        WHERE user_id = %s
          AND COALESCE(closer,'') = ''
          AND COALESCE(TRIM(ghl_appointment_id),'') <> ''
        """,
        (UID,),
    )
    count = cur.fetchone()[0]
    print(f"\nsin_closer_con_ghl_id: {count} (antes: 15)")
    if remaining:
        print("Sin recuperar:")
        for row in remaining:
            print(f"  {row}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jose-only", action="store_true")
    parser.add_argument("--huerfanas-only", action="store_true")
    parser.add_argument("--skip-jose", action="store_true")
    parser.add_argument("--skip-huerfanas", action="store_true")
    args = parser.parse_args()

    init_db()

    if args.huerfanas_only:
        step_huerfanas()
        return 0
    if args.jose_only:
        step_jose_ortiz()
        return 0

    if not args.skip_jose:
        step_jose_ortiz()
    if not args.skip_huerfanas:
        step_huerfanas()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
