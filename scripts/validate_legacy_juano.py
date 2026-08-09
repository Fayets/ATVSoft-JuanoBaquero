#!/usr/bin/env python3
"""Validaciones post-migración CRM legacy juano.

Ejecutar desde backend:
  python ../scripts/validate_legacy_juano.py --user-id 1
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from decouple import config  # noqa: E402


EXPECTED = {
    "pagos_count": 351,
    "pagos_sum": 255699.99,
    "pagos_jul_count": 211,
    "pagos_jul_sum": 163195.80,
    "leads_count": 2478,
    "presento_si": 366,
    "cuotas_count": 20,
}


def _pg_conn():
    import psycopg2

    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )


def run_checks(user_id: int) -> list[tuple[str, object, object, bool]]:
    results: list[tuple[str, object, object, bool]] = []
    with _pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(monto), 0) FROM lead_payment "
                "WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            cnt, total = cur.fetchone()
            results.append(("Conteo pagos", EXPECTED["pagos_count"], int(cnt), int(cnt) == EXPECTED["pagos_count"]))
            results.append(
                (
                    "Suma pagos USD",
                    EXPECTED["pagos_sum"],
                    round(float(total), 2),
                    abs(float(total) - EXPECTED["pagos_sum"]) < 0.02,
                )
            )

            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(monto), 0) FROM lead_payment "
                "WHERE user_id = %s AND source = 'legacy_juano' "
                "AND fecha >= '2026-07-01' AND fecha < '2026-08-01'",
                (user_id,),
            )
            jcnt, jsum = cur.fetchone()
            results.append(("Filas julio", EXPECTED["pagos_jul_count"], int(jcnt), int(jcnt) == EXPECTED["pagos_jul_count"]))
            results.append(("Suma julio", EXPECTED["pagos_jul_sum"], float(jsum), abs(float(jsum) - EXPECTED["pagos_jul_sum"]) < 0.02))

            cur.execute(
                "SELECT COUNT(*) FROM lead WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            lcnt = cur.fetchone()[0]
            results.append(("Filas leads", EXPECTED["leads_count"], int(lcnt), int(lcnt) == EXPECTED["leads_count"]))

            cur.execute(
                "SELECT COUNT(*) FROM lead WHERE user_id = %s AND source = 'legacy_juano' "
                "AND legacy_meta->>'presento' = 'Sí'",
                (user_id,),
            )
            pcnt = cur.fetchone()[0]
            results.append(("Presento Sí", EXPECTED["presento_si"], int(pcnt), int(pcnt) == EXPECTED["presento_si"]))

            cur.execute(
                "SELECT COUNT(*) FROM legacy_cuota_ref WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            ccnt = cur.fetchone()[0]
            results.append(("Filas cuotas", EXPECTED["cuotas_count"], int(ccnt), int(ccnt) == EXPECTED["cuotas_count"]))

            cur.execute(
                "SELECT COUNT(*) FROM lead WHERE source = 'legacy_juano' AND legacy_id IS NULL"
            )
            null_lead = cur.fetchone()[0]
            results.append(("legacy_id NULL leads", 0, int(null_lead), int(null_lead) == 0))

            cur.execute(
                "SELECT COUNT(*) FROM lead_payment WHERE source = 'legacy_juano' AND legacy_id IS NULL"
            )
            null_pay = cur.fetchone()[0]
            results.append(("legacy_id NULL pagos", 0, int(null_pay), int(null_pay) == 0))

    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, required=True)
    args = parser.parse_args()

    print(f"Validando migración legacy_juano user_id={args.user_id}\n")
    print(f"{'Check':<24} {'Esperado':>14} {'Obtenido':>14} {'OK':>6}")
    print("-" * 62)
    failed = 0
    for label, expected, got, ok in run_checks(args.user_id):
        mark = "OK" if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"{label:<24} {str(expected):>14} {str(got):>14} {mark:>6}")
    print("-" * 62)
    if failed:
        print(f"\n{failed} validación(es) fallaron.")
        return 1
    print("\nTodas las validaciones pasaron.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
