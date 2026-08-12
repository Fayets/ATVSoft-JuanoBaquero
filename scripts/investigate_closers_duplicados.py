#!/usr/bin/env python3
"""Investigación closers duplicados — solo lectura."""
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

    print("=== §4 Sin closer ===")
    cur.execute(
        """
        SELECT COALESCE(source,'atv') AS source,
               COUNT(*) AS llamadas,
               COUNT(*) FILTER (WHERE ghl_appointment_id IS NOT NULL) AS con_ghl_id,
               MIN(call)::date AS desde,
               MAX(call)::date AS hasta
        FROM lead
        WHERE user_id = %s AND call IS NOT NULL AND COALESCE(closer,'') = ''
        GROUP BY 1 ORDER BY 2 DESC
        """,
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    print("\n=== §3 Thomas vs Santiago Gamba por día ===")
    cur.execute(
        """
        SELECT closer, call::date AS dia, COUNT(*)
        FROM lead
        WHERE user_id = %s AND closer IN ('Thomas Gamba','Santiago Gamba')
        GROUP BY 1,2 ORDER BY 2, 1
        """,
        (UID,),
    )
    rows = cur.fetchall()
    days_thomas = {r[1] for r in rows if r[0] == "Thomas Gamba"}
    days_santiago = {r[1] for r in rows if r[0] == "Santiago Gamba"}
    overlap = days_thomas & days_santiago
    print(f"dias_thomas={len(days_thomas)} dias_santiago={len(days_santiago)} solapamiento={len(overlap)}")
    if overlap:
        print("Días con AMBOS:", sorted(overlap)[:10], "..." if len(overlap) > 10 else "")
    for r in rows[:20]:
        print(r)
    print(f"... total filas {len(rows)}")

    print("\n=== Distribución closer (top) ===")
    cur.execute(
        """
        SELECT closer, COUNT(*), MIN(call)::date, MAX(call)::date
        FROM lead WHERE user_id=%s AND call IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20
        """,
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    print("\n=== TeamMember closers ===")
    cur.execute(
        "SELECT id, nombre, activo FROM teammember WHERE user_id=%s AND rol='closer' ORDER BY nombre",
        (UID,),
    )
    for r in cur.fetchall():
        print(r)

    print("\n=== Variantes a unificar ===")
    for variant in ("Agus Olivero", "Matías Sandobal", "Catalina"):
        cur.execute(
            "SELECT COUNT(*) FROM lead WHERE user_id=%s AND closer=%s",
            (UID, variant),
        )
        print(variant, cur.fetchone()[0])

    print("\n=== Anclas ===")
    cur.execute(
        "SELECT COUNT(*), ROUND(COALESCE(SUM(monto),0)::numeric,2) FROM lead_payment WHERE user_id=%s AND source='legacy_juano'",
        (UID,),
    )
    print("legacy_pagos", cur.fetchone())
    cur.execute(
        "SELECT COUNT(*) FROM lead WHERE user_id=%s AND COALESCE(link_llamada,'') <> ''",
        (UID,),
    )
    print("links", cur.fetchone()[0])

    conn.close()


if __name__ == "__main__":
    main()
