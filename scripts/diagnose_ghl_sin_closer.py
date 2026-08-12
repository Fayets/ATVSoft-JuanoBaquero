#!/usr/bin/env python3
"""Diagnóstico citas GHL sin closer + fix typos TeamMember."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from decouple import config  # noqa: E402
import psycopg2  # noqa: E402

UID = 1


def pg():
    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default="5432"),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def main() -> None:
    conn = pg()
    cur = conn.cursor()

    print("=== 3.1 Jose Ortiz / 2026-08-11 ===")
    cur.execute(
        """
        SELECT id, nombre, email, telefono, call, closer, triajer,
               ghl_appointment_id, ghl_contact_id, source, created_at
        FROM lead
        WHERE user_id = %s
          AND (lower(nombre) LIKE '%%ortiz%%' OR call::date = '2026-08-11')
        ORDER BY id
        """,
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    print("\n=== 3.2 Citas sin closer con ghl_appointment_id ===")
    cur.execute(
        """
        SELECT id, nombre, call, ghl_appointment_id, ghl_contact_id, source, created_at
        FROM lead
        WHERE user_id = %s
          AND COALESCE(closer,'') = ''
          AND COALESCE(TRIM(ghl_appointment_id),'') <> ''
        ORDER BY call
        """,
        (UID,),
    )
    rows = cur.fetchall()
    print(f"total={len(rows)}")
    for r in rows:
        print(r)

    print("\n=== Martín Jácome leads ===")
    cur.execute(
        "SELECT COUNT(*) FROM lead WHERE user_id=%s AND closer IN ('Martin Jácome','Martín Jácome')",
        (UID,),
    )
    print("count", cur.fetchone()[0])

    print("\n=== TeamMember actual ===")
    cur.execute(
        "SELECT id, nombre, rol, activo FROM teammember WHERE user_id=%s ORDER BY id",
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    print("\n=== triajer distribution ===")
    cur.execute(
        """
        SELECT triajer, COUNT(*) FROM lead
        WHERE user_id=%s AND COALESCE(TRIM(triajer),'') <> ''
        GROUP BY 1 ORDER BY 2 DESC
        """,
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    conn.close()


if __name__ == "__main__":
    main()
