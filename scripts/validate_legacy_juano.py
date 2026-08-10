#!/usr/bin/env python3
"""Validaciones post-migración CRM legacy juano.

Ejecutar desde backend:
  python ../scripts/validate_legacy_juano.py --user-id 1

Requiere:
  - data/legacy/expected_counts.json (query control al exportar)
  - data/legacy/import_summary.json (generado por import o dry-run)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from decouple import config  # noqa: E402
from src.services.legacy_juano_import import EXCLUDED_ALERT_RATIO, load_import_summary  # noqa: E402


def load_expected(data_dir: Path) -> dict:
    path = data_dir / "expected_counts.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"Falta {path}. Corré la query de control en Supabase al exportar y guardá el JSON."
        )
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("expected_counts.json debe ser un objeto JSON")
    return data


def _pg_conn():
    import psycopg2

    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )


def _fmt_ok(ok: bool) -> str:
    return "OK" if ok else "FAIL"


def _line(label: str, value: object, width: int = 28) -> str:
    return f"  {label:<{width}}: {value!s:>8}"


def validate(user_id: int, data_dir: Path) -> int:
    expected = load_expected(data_dir)
    summary = load_import_summary(data_dir)

    excluded_leads = int(summary.get("excluded", {}).get("leads", {}).get("count", 0))
    excluded_cuotas = int(summary.get("excluded", {}).get("cuotas", {}).get("count", 0))

    origin_leads = int(expected.get("leads_total", 0))
    origin_cuotas = int(expected.get("cuotas_total", 0))
    net_leads = origin_leads - excluded_leads
    net_cuotas = origin_cuotas - excluded_cuotas

    failed = 0

    exported = expected.get("exportado_en", "?")
    print(f"Validando migración legacy_juano user_id={user_id}")
    print(f"Ancla origen: expected_counts.json (exportado_en={exported})")
    print(f"Exclusiones: import_summary.json (dry_run={summary.get('dry_run')})\n")

    # Umbral excluidos
    for label, excluded, origin in (
        ("leads", excluded_leads, origin_leads),
        ("cuotas", excluded_cuotas, origin_cuotas),
    ):
        if origin > 0 and excluded / origin > EXCLUDED_ALERT_RATIO and excluded > 1:
            print(f"ALERTA: excluidos {label} ({excluded}) > {EXCLUDED_ALERT_RATIO:.0%} del origen ({origin})")
            failed += 1

    with _pg_conn() as conn:
        with conn.cursor() as cur:
            # --- PAGOS (comparación directa, sin resta) ---
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(monto), 0) FROM lead_payment "
                "WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            pay_cnt, pay_sum = cur.fetchone()
            pay_cnt = int(pay_cnt)
            pay_sum = round(float(pay_sum), 2)

            exp_pagos = int(expected.get("pagos_total", 0))
            exp_sum = float(expected.get("pagos_usd_total", 0))
            ok_pagos = pay_cnt == exp_pagos
            ok_sum = abs(pay_sum - exp_sum) < 0.02
            if not ok_pagos or not ok_sum:
                failed += 1

            print("PAGOS (comparación directa — ancla USD)")
            print(_line("Origen (expected_counts)", exp_pagos))
            print(_line("Importados", pay_cnt) + f"   {_fmt_ok(ok_pagos)}")
            print(_line("Suma USD esperada", exp_sum))
            print(_line("Suma USD obtenida", pay_sum) + f"   {_fmt_ok(ok_sum)}")

            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(monto), 0) FROM lead_payment "
                "WHERE user_id = %s AND source = 'legacy_juano' "
                "AND fecha >= '2026-07-01' AND fecha < '2026-08-01'",
                (user_id,),
            )
            jcnt, jsum = cur.fetchone()
            jcnt = int(jcnt)
            jsum = round(float(jsum), 2)
            exp_jul = int(expected.get("pagos_julio", 0))
            exp_jul_sum = float(expected.get("pagos_usd_julio", 0))
            ok_jul = jcnt == exp_jul
            ok_jul_sum = abs(jsum - exp_jul_sum) < 0.02
            if not ok_jul or not ok_jul_sum:
                failed += 1
            print(_line("Julio count", f"{jcnt} / {exp_jul}") + f"   {_fmt_ok(ok_jul)}")
            print(_line("Julio USD", f"{jsum} / {exp_jul_sum}") + f"   {_fmt_ok(ok_jul_sum)}")
            print()

            # --- LEADS (esperado neto) ---
            cur.execute(
                "SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = %s",
                (user_id,),
            )
            lead_ref_cnt = int(cur.fetchone()[0])
            ok_lead_ref = lead_ref_cnt == net_leads

            cur.execute(
                "SELECT COUNT(*) FROM lead WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            new_legacy = int(cur.fetchone()[0])

            cur.execute(
                "SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = %s AND rol = 'merge_winner'",
                (user_id,),
            )
            merge_winners = int(cur.fetchone()[0])
            cur.execute(
                "SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = %s AND rol = 'merge_absorbed'",
                (user_id,),
            )
            merge_absorbed = int(cur.fetchone()[0])
            cur.execute(
                "SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = %s AND rol = 'new'",
                (user_id,),
            )
            ref_new = int(cur.fetchone()[0])

            applied = summary.get("applied", {}).get("leads", {})
            exp_merge = int(applied.get("merged", merge_winners + merge_absorbed))
            exp_new = int(applied.get("new", ref_new))
            ok_leads = ok_lead_ref
            if merge_winners + merge_absorbed + ref_new != net_leads:
                failed += 1
                ok_leads = False
            if not ok_lead_ref:
                failed += 1

            print("LEADS")
            print(_line("Origen (expected_counts)", origin_leads))
            print(_line("Excluidos (es_prueba)", excluded_leads))
            print(_line("Esperado neto", net_leads))
            print(_line("legacy_lead_ref", lead_ref_cnt) + f"   {_fmt_ok(ok_lead_ref)}")
            print(_line("  merge_winner", merge_winners))
            print(_line("  merge_absorbed", merge_absorbed))
            print(_line("  new", ref_new))
            print(_line("lead source=legacy_juano", new_legacy))
            print(_line("Resumen merge (import)", exp_merge))
            print(_line("Resumen nuevos (import)", exp_new))
            print()

            # --- CUOTAS (esperado neto) ---
            cur.execute(
                "SELECT COUNT(*) FROM legacy_cuota_ref WHERE user_id = %s AND source = 'legacy_juano'",
                (user_id,),
            )
            cuotas_cnt = int(cur.fetchone()[0])
            ok_cuotas = cuotas_cnt == net_cuotas
            if not ok_cuotas:
                failed += 1

            print("CUOTAS")
            print(_line("Origen (expected_counts)", origin_cuotas))
            print(_line("Excluidos (prueba)", excluded_cuotas))
            print(_line("Esperado neto", net_cuotas))
            print(_line("Importadas", cuotas_cnt) + f"   {_fmt_ok(ok_cuotas)}")
            print()

            # --- Presento Sí ---
            cur.execute(
                """
                SELECT COUNT(*) FROM legacy_lead_ref
                WHERE user_id = %s AND payload->>'presento' = 'Sí'
                """,
                (user_id,),
            )
            pcnt = int(cur.fetchone()[0])
            exp_pres = int(expected.get("leads_presento_si", 0))
            ok_pres = pcnt == exp_pres
            if not ok_pres:
                failed += 1
            print("INTEGRIDAD")
            print(_line("Presento Sí", f"{pcnt} / {exp_pres}") + f"   {_fmt_ok(ok_pres)}")

            cur.execute(
                """
                SELECT COUNT(*) FROM lead
                WHERE source = 'legacy_juano' AND legacy_id IS NULL
                  AND COALESCE(legacy_meta->>'created_from', '') <> 'pagos.csv'
                """
            )
            null_lead = int(cur.fetchone()[0])
            ok_null_lead = null_lead == 0
            if not ok_null_lead:
                failed += 1
            print(_line("legacy_id NULL leads", null_lead) + f"   {_fmt_ok(ok_null_lead)}")

            cur.execute(
                "SELECT COUNT(*) FROM lead_payment WHERE source = 'legacy_juano' AND legacy_id IS NULL"
            )
            null_pay = int(cur.fetchone()[0])
            ok_null_pay = null_pay == 0
            if not ok_null_pay:
                failed += 1
            print(_line("legacy_id NULL pagos", null_pay) + f"   {_fmt_ok(ok_null_pay)}")

    print()
    if failed:
        print(f"{failed} validación(es) fallaron.")
        return 1
    print("Todas las validaciones pasaron.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=ROOT / "data" / "legacy",
    )
    args = parser.parse_args()

    try:
        return validate(args.user_id, args.data_dir)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
