"""Restaura lead.status desde lead.estado (trabajo del equipo pisado por GHL).

Por defecto es DRY-RUN (no escribe). Para aplicar: --apply
  🛑 No correr --apply hasta autorización explícita post-revisión.

Tenant default: user_id=1 (juano).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

USER_ID_DEFAULT = 1
ORIGEN = "restauracion_status_ghl"


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _connect(env: dict[str, str]):
    return psycopg2.connect(
        user=env["DB_USER"],
        password=env["DB_PASS"],
        host=env["DB_HOST"],
        dbname=env["DB_NAME"],
        sslmode=env.get("DB_SSLMODE", "require"),
    )


SELECT_SQL = """
SELECT id, nombre, status, estado, closer, pago,
       COALESCE(TRIM(link_llamada), '') <> '' AS tiene_fathom,
       ((call AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date AS dia_bogota
FROM lead
WHERE user_id = %s
  AND LOWER(TRIM(COALESCE(status, ''))) = 'agendado'
  AND LOWER(TRIM(COALESCE(estado, ''))) NOT IN ('', 'agendado', 'pendiente')
ORDER BY dia_bogota NULLS LAST, id
"""


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, default=USER_ID_DEFAULT)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Escribe status=estado. Requiere autorización. Default: dry-run.",
    )
    args = parser.parse_args()

    env = _load_env()
    conn = _connect(env)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(SELECT_SQL, (args.user_id,))
            rows = cur.fetchall()
    finally:
        if not args.apply:
            conn.close()

    dest = Counter((r["estado"] or "").strip() for r in rows)
    con_pago = sum(1 for r in rows if float(r["pago"] or 0) > 0)
    pago_sum = sum(float(r["pago"] or 0) for r in rows)
    con_fathom = sum(1 for r in rows if r["tiene_fathom"])

    print(f"user_id={args.user_id}  candidatos={len(rows)}")
    print("desglose por estado destino:")
    for name, n in dest.most_common():
        print(f"  {name!r}: {n}")
    print(f"con pago>0: {con_pago}  suma_pago: {pago_sum:.2f}  con_fathom: {con_fathom}")
    print()
    print("muestra (hasta 25):")
    for r in rows[:25]:
        print(
            f"  id={r['id']} {r['nombre']!r} {r['status']!r} -> {r['estado']!r} "
            f"closer={r['closer']!r} pago={r['pago']} dia={r['dia_bogota']}"
        )
    if len(rows) > 25:
        print(f"  ... +{len(rows) - 25} mas")

    if not args.apply:
        print("\nDRY-RUN: no se escribió nada. Revisar y autorizar --apply.")
        return 0

    print("\nAPPLY: actualizando status = estado + legacy_meta.actualizaciones …")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    updated = 0
    try:
        with conn.cursor() as cur:
            for r in rows:
                lid = int(r["id"])
                nuevo = (r["estado"] or "").strip()
                cur.execute(
                    "SELECT legacy_meta FROM lead WHERE id = %s AND user_id = %s",
                    (lid, args.user_id),
                )
                meta_row = cur.fetchone()
                meta = meta_row[0] if meta_row else {}
                if not isinstance(meta, dict):
                    meta = {}
                actualizaciones = meta.get("actualizaciones")
                if not isinstance(actualizaciones, list):
                    actualizaciones = []
                actualizaciones.append(
                    {
                        "fecha": now,
                        "campo": "status",
                        "antes": r["status"] or "",
                        "despues": nuevo,
                        "origen": ORIGEN,
                    }
                )
                meta["actualizaciones"] = actualizaciones
                cur.execute(
                    """
                    UPDATE lead
                    SET status = %s,
                        legacy_meta = %s::jsonb,
                        updated_at = NOW() AT TIME ZONE 'utc'
                    WHERE id = %s AND user_id = %s
                    """,
                    (nuevo, json.dumps(meta), lid, args.user_id),
                )
                updated += cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f"aplicados: {updated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
