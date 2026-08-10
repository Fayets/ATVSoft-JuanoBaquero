#!/usr/bin/env python3
"""Alcance de leads huérfanos creados por import de pagos (decision-huerfanos-reconciliacion.md §1)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from decouple import Config, RepositoryEnv

config = Config(RepositoryEnv(ROOT / "backend" / ".env"))
import psycopg2
from psycopg2.extras import RealDictCursor

Q_COUNT = """
SELECT COUNT(*) AS huerfanos_de_pagos
FROM lead l
WHERE l.user_id = 1
  AND l.source = 'legacy_juano'
  AND NOT EXISTS (
    SELECT 1 FROM legacy_lead_ref r WHERE r.lead_id = l.id
  );
"""

Q_DETAIL = """
SELECT
  l.id, l.nombre, l.email, l.telefono, l.status,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos,
  (SELECT SUM(p.monto) FROM lead_payment p WHERE p.lead_id = l.id) AS usd
FROM lead l
WHERE l.user_id = 1
  AND l.source = 'legacy_juano'
  AND NOT EXISTS (SELECT 1 FROM legacy_lead_ref r WHERE r.lead_id = l.id)
ORDER BY usd DESC NULLS LAST, l.id
LIMIT 50;
"""

Q_KNOWN = """
SELECT l.id, l.nombre,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos,
  (SELECT SUM(p.monto) FROM lead_payment p WHERE p.lead_id = l.id) AS usd
FROM lead l
WHERE l.id IN (6969, 6972)
ORDER BY l.id;
"""


def main() -> int:
    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute(Q_COUNT)
    count = int(cur.fetchone()["huerfanos_de_pagos"])
    print(f"HUERFANOS_DE_PAGOS={count}")

    cur.execute(Q_DETAIL)
    rows = cur.fetchall()
    print(f"DETALLE (hasta 50, obtenidos {len(rows)}):")
    total_usd = 0.0
    for r in rows:
        d = dict(r)
        usd = float(d.get("usd") or 0)
        total_usd += usd
        print(json.dumps(d, ensure_ascii=False, default=str))
    print(f"USD_EN_LISTADO={total_usd:.2f}")

    print("\nCASOS_CONOCIDOS:")
    cur.execute(Q_KNOWN)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
