#!/usr/bin/env python3
"""Baseline pre-incremental comprobantes."""
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
EXPECTED = (362, 265526.99, 2512, 21, 356)


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
    cur.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM lead_payment WHERE user_id=%s AND source='legacy_juano'),
          (SELECT ROUND(SUM(monto)::numeric,2) FROM lead_payment WHERE user_id=%s AND source='legacy_juano'),
          (SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id=%s),
          (SELECT COUNT(*) FROM legacy_cuota_ref WHERE user_id=%s),
          (SELECT COUNT(*) FROM lead WHERE user_id=%s AND COALESCE(link_llamada,'') <> '')
        """,
        (UID, UID, UID, UID, UID),
    )
    row = cur.fetchone()
    print("Baseline actual:", row)
    print("Esperado:       ", EXPECTED)
    ok = (
        row[0] == EXPECTED[0]
        and float(row[1]) == EXPECTED[1]
        and row[2] == EXPECTED[2]
        and row[3] == EXPECTED[3]
        and row[4] == EXPECTED[4]
    )
    print("OK" if ok else "NO COINCIDE — parar")
    conn.close()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
