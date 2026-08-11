#!/usr/bin/env python3
"""Verificaciones hipótesis CRM viejo + Claude API (solo lectura Neon)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from decouple import config  # noqa: E402


def connect():
    import psycopg2

    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default=5432),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def main() -> int:
    uid = 1
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
                """
            )
            tables = [r[0] for r in cur.fetchall()]
            api_tables = [t for t in tables if "api" in t.lower() or "connect" in t.lower()]
            print("Tablas API/conexión:", api_tables or "(ninguna por nombre)")

            print("\n=== call_report — histórico global ===")
            cur.execute(
                """
                SELECT cr.estado, COUNT(*),
                       MIN(cr.created_at)::date, MAX(cr.created_at)::date
                FROM call_report cr
                GROUP BY cr.estado ORDER BY 2 DESC
                """
            )
            for row in cur.fetchall():
                print(row)

            print(f"\n=== call_report — user_id={uid} ===")
            cur.execute(
                """
                SELECT cr.estado, COUNT(*),
                       MIN(cr.created_at)::date, MAX(cr.created_at)::date
                FROM call_report cr
                JOIN lead l ON l.id = cr.lead_id
                WHERE l.user_id = %s
                GROUP BY cr.estado ORDER BY 2 DESC
                """,
                (uid,),
            )
            for row in cur.fetchall():
                print(row)

            cur.execute(
                """
                SELECT COUNT(*) FROM call_report cr
                JOIN lead l ON l.id = cr.lead_id
                WHERE l.user_id = %s AND cr.estado NOT IN ('error', 'pendiente')
                """,
                (uid,),
            )
            ok = int(cur.fetchone()[0])
            print(f"Reportes exitosos (estado distinto de error/pendiente): {ok}")

            for tbl in api_tables:
                print(f"\n=== {tbl} user_id={uid} ===")
                cur.execute(
                    f"""
                    SELECT platform, updated_at, last_sync_at,
                           LEFT(credentials::text, 80)
                    FROM {tbl} WHERE user_id = %s ORDER BY platform
                    """,
                    (uid,),
                )
                for platform, updated, sync, cred_preview in cur.fetchall():
                    has_claude = "claude" in (platform or "").lower()
                    cred_lower = (cred_preview or "").lower()
                    key_hint = any(
                        x in cred_lower for x in ("sk-", "api_key", "apikey", "anthropic")
                    )
                    print(
                        f"  {platform!r} updated={updated} sync={sync} "
                        f"key_hint={key_hint or has_claude}"
                    )

    supabase_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not supabase_url:
        print("\n[WARN] SUPABASE_DB_URL no definida - omitiendo query juano.leads legacy.")
        return 0

    import psycopg2

    print("\n=== Supabase juano.leads (legacy CRM) ===")
    with psycopg2.connect(supabase_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE COALESCE(data->>'linkLlamada','') <> '') AS con_link,
                  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoSetter','') <> '') AS con_ctx_setter,
                  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoTriaje','') <> '') AS con_ctx_triaje,
                  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoCloser','') <> '') AS con_ctx_closer,
                  COUNT(*) FILTER (WHERE COALESCE(data->>'preCall','') <> '') AS con_precall
                FROM juano.leads
                """
            )
            print(cur.fetchone())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
