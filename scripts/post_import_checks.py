#!/usr/bin/env python3
"""Chequeos manuales post-import incremental."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from dotenv import load_dotenv

load_dotenv(BACKEND / ".env")

from decouple import config  # noqa: E402
import psycopg2  # noqa: E402

UID = 1


def main() -> int:
    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default="5432"),
        sslmode=config("DB_SSLMODE", default="require"),
    )
    cur = conn.cursor()

    print("=== MÉTRICAS PRINCIPALES ===")
    cur.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM lead_payment WHERE user_id=%s AND source='legacy_juano'),
          (SELECT ROUND(SUM(monto)::numeric,2) FROM lead_payment WHERE user_id=%s AND source='legacy_juano'),
          (SELECT COUNT(*) FROM lead_payment WHERE user_id=%s AND COALESCE(comprobante_url,'') <> ''),
          (SELECT COUNT(*) FROM lead WHERE user_id=%s AND COALESCE(link_llamada,'') <> ''),
          (SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id=%s),
          (SELECT COUNT(*) FROM legacy_cuota_ref WHERE user_id=%s)
        """,
        (UID,) * 6,
    )
    print("pagos, usd, comprobantes, links, lead_refs, cuota_refs:", cur.fetchone())

    cur.execute(
        """
        SELECT COUNT(*), ROUND(SUM(monto)::numeric,2)
        FROM lead_payment
        WHERE user_id=%s AND source='legacy_juano'
          AND fecha >= '2026-07-01' AND fecha < '2026-08-01'
        """,
        (UID,),
    )
    print("julio:", cur.fetchone())

    print("\n=== 3.1 Miguel Arango 1855/6989 ===")
    cur.execute(
        """
        SELECT lead_id, rol, LEFT(legacy_id::text,8), motivo
        FROM legacy_lead_ref
        WHERE user_id=%s AND lead_id IN (1855, 6989)
        ORDER BY lead_id
        """,
        (UID,),
    )
    for row in cur.fetchall():
        print(row)

    print("\n=== 3.2 Pagos en huérfanos ===")
    cur.execute(
        """
        SELECT COUNT(*)
        FROM lead_payment p
        JOIN lead l ON l.id = p.lead_id
        WHERE p.user_id=%s AND COALESCE(l.legacy_meta->>'merged_into','') <> ''
        """,
        (UID,),
    )
    print("pagos_en_huerfanos:", cur.fetchone()[0])

    print("\n=== 3.3 Closers viejos ===")
    cur.execute(
        """
        SELECT closer, COUNT(*)
        FROM lead
        WHERE user_id=%s AND closer IN ('Agus Olivero', 'Matías Sandobal', 'Catalina')
        GROUP BY 1
        """,
        (UID,),
    )
    rows = cur.fetchall()
    print(rows if rows else "0 filas OK")

    print("\n=== 3.4 Citas julio recuperadas ===")
    cur.execute(
        """
        SELECT id, nombre, call::date, closer
        FROM lead
        WHERE user_id=%s AND id IN (1460, 1458, 1470, 1473, 1465, 1462)
        ORDER BY id
        """,
        (UID,),
    )
    for row in cur.fetchall():
        print(row)

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
