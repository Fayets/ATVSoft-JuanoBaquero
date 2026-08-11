#!/usr/bin/env python3
"""Diff de contenido production vs branch Neon (solo lectura).

Uso:
  python scripts/investigate_tracker_content_diff.py --user-id 1
  python scripts/investigate_tracker_content_diff.py --user-id 1 \\
    --branch-url "postgresql://..."

Si no se pasa --branch-url, usa BRANCH_DATABASE_URL del entorno.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from decouple import config  # noqa: E402

LEAD_FIELDS = (
    "link_llamada",
    "calificacion_llamada",
    "dolores_llamada",
    "programada_ofrecido_llamada",
    "notas",
    "triaje_hecho",
    "triajer",
    "closer",
    "closer_report",
    "setter",
    "programa_ofrecido",
)

CALL_REPORT_TEXT = (
    "lead_nombre",
    "fathom_url",
    "estado",
    "error_msg",
    "participantes",
    "motivo_reunion",
    "nivel_dolor",
    "capacidad_decision",
    "capacidad_economica",
    "fit_real",
    "objecion_diagnostico",
    "resumen",
    "closer_report",
    "dolores_llamada",
    "razon_compra",
    "program_offered",
)

CLOSER_REPORT_TEXT = (
    "notas",
)


def _norm(val: object) -> str:
    if val is None:
        return ""
    if isinstance(val, bool):
        return "true" if val else "false"
    s = str(val).strip()
    return s


def _had_content(val: object) -> bool:
    return bool(_norm(val))


def _connect(url: str | None = None):
    import psycopg2

    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default=5432),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def fetch_leads(conn, user_id: int) -> dict[int, dict]:
    cols = ", ".join(["id"] + list(LEAD_FIELDS))
    with conn.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM lead WHERE user_id = %s", (user_id,))
        rows = cur.fetchall()
    out: dict[int, dict] = {}
    for row in rows:
        lid = int(row[0])
        out[lid] = {LEAD_FIELDS[i]: row[i + 1] for i in range(len(LEAD_FIELDS))}
    return out


def fetch_table_by_id(conn, table: str, fields: tuple[str, ...], user_id: int) -> dict[int, dict]:
    cols = ", ".join(["id"] + list(fields))
    with conn.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM {table} WHERE user_id = %s", (user_id,))
        rows = cur.fetchall()
    out: dict[int, dict] = {}
    for row in rows:
        rid = int(row[0])
        out[rid] = {fields[i]: row[i + 1] for i in range(len(fields))}
    return out


def diff_maps(
    before: dict[int, dict],
    after: dict[int, dict],
    table: str,
    fields: tuple[str, ...],
) -> list[dict]:
    diffs: list[dict] = []
    common = set(before) & set(after)
    for rid in sorted(common):
        for field in fields:
            b = _norm(before[rid].get(field))
            a = _norm(after[rid].get(field))
            if _had_content(b) and not _had_content(a):
                diffs.append(
                    {
                        "tabla": table,
                        "id": rid,
                        "campo": field,
                        "antes": b[:120],
                        "ahora": a or "NULL",
                    }
                )
    return diffs


def audit_clears_production(conn, user_id: int) -> list[dict]:
    """Busca en legacy_meta.actualizaciones campos que pasaron de valor a vacío."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, nombre, legacy_meta
            FROM lead
            WHERE user_id = %s AND legacy_meta IS NOT NULL
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    hits: list[dict] = []
    for lid, nombre, meta in rows:
        if not isinstance(meta, dict):
            continue
        for ev in meta.get("actualizaciones") or []:
            if not isinstance(ev, dict):
                continue
            campo = (ev.get("campo") or "").strip()
            antes = _norm(ev.get("antes"))
            despues = _norm(ev.get("despues"))
            if campo in LEAD_FIELDS and _had_content(antes) and not _had_content(despues):
                hits.append(
                    {
                        "tabla": "lead (audit)",
                        "id": lid,
                        "campo": campo,
                        "antes": antes[:120],
                        "ahora": despues or "NULL",
                        "nombre": (nombre or "")[:60],
                        "fecha": ev.get("fecha"),
                    }
                )
    return hits


def production_stats(conn, user_id: int) -> dict:
    stats: dict[str, object] = {}
    with conn.cursor() as cur:
        for field in LEAD_FIELDS:
            if field == "triaje_hecho":
                cur.execute(
                    f"SELECT COUNT(*) FROM lead WHERE user_id=%s AND triaje_hecho = true",
                    (user_id,),
                )
            else:
                cur.execute(
                    f"SELECT COUNT(*) FROM lead WHERE user_id=%s AND COALESCE(TRIM({field}::text), '') <> ''",
                    (user_id,),
                )
            stats[f"lead.{field}"] = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM call_report cr JOIN lead l ON l.id=cr.lead_id WHERE l.user_id=%s", (user_id,))
        stats["call_report.total"] = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM closer_report WHERE user_id=%s", (user_id,))
        stats["closer_report.total"] = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM setter_report WHERE user_id=%s", (user_id,))
        stats["setter_report.total"] = int(cur.fetchone()[0])
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--branch-url", default=os.environ.get("BRANCH_DATABASE_URL", ""))
    args = parser.parse_args()

    prod = _connect()
    print(f"=== Production stats (user_id={args.user_id}) ===")
    for k, v in production_stats(prod, args.user_id).items():
        print(f"  {k}: {v}")

    print("\n=== Audit trail: campos vaciados por import (legacy_meta) ===")
    audit = audit_clears_production(prod, args.user_id)
    if not audit:
        print("  (ninguno en actualizaciones[])")
    else:
        for h in audit[:50]:
            print(
                f"  lead {h['id']} {h['campo']}: {h['antes']!r} → {h['ahora']!r}  [{h.get('nombre')}]"
            )
        if len(audit) > 50:
            print(f"  ... +{len(audit) - 50} más")
    print(f"  TOTAL audit: {len(audit)}")

    branch_url = (args.branch_url or "").strip()
    if not branch_url:
        print("\n⚠️  Sin --branch-url / BRANCH_DATABASE_URL: omitiendo diff vs recuperacion-prefathom.")
        prod.close()
        return 0

    branch = _connect(branch_url)
    print("\n=== Diff contenido: branch (10/08 12:00) → production ===")
    all_diffs: list[dict] = []

    prod_leads = fetch_leads(prod, args.user_id)
    branch_leads = fetch_leads(branch, args.user_id)
    all_diffs.extend(diff_maps(branch_leads, prod_leads, "lead", LEAD_FIELDS))

    prod_cr = fetch_table_by_id(prod, "call_report", CALL_REPORT_TEXT, args.user_id)
    branch_cr = fetch_table_by_id(branch, "call_report", CALL_REPORT_TEXT, args.user_id)
    # call_report no tiene user_id directo en fetch — re-fetch properly
    with prod.cursor() as cur:
        cols = ", ".join(["cr.id"] + [f"cr.{f}" for f in CALL_REPORT_TEXT])
        cur.execute(
            f"SELECT {cols} FROM call_report cr JOIN lead l ON l.id=cr.lead_id WHERE l.user_id=%s",
            (args.user_id,),
        )
        prod_cr = {int(r[0]): {CALL_REPORT_TEXT[i]: r[i + 1] for i in range(len(CALL_REPORT_TEXT))} for r in cur.fetchall()}
    with branch.cursor() as cur:
        cols = ", ".join(["cr.id"] + [f"cr.{f}" for f in CALL_REPORT_TEXT])
        cur.execute(
            f"SELECT {cols} FROM call_report cr JOIN lead l ON l.id=cr.lead_id WHERE l.user_id=%s",
            (args.user_id,),
        )
        branch_cr = {int(r[0]): {CALL_REPORT_TEXT[i]: r[i + 1] for i in range(len(CALL_REPORT_TEXT))} for r in cur.fetchall()}
    all_diffs.extend(diff_maps(branch_cr, prod_cr, "call_report", CALL_REPORT_TEXT))

    prod_cl = fetch_table_by_id(prod, "closer_report", CLOSER_REPORT_TEXT, args.user_id)
    branch_cl = fetch_table_by_id(branch, "closer_report", CLOSER_REPORT_TEXT, args.user_id)
    all_diffs.extend(diff_maps(branch_cl, prod_cl, "closer_report", CLOSER_REPORT_TEXT))

    if not all_diffs:
        print("CAMPOS VACIADOS entre branch y production: 0")
    else:
        print("CAMPOS VACIADOS entre 10/08 12:00 y ahora\n")
        print(f"{'tabla':<14} {'id':<8} {'campo':<28} {'antes':<40} ahora")
        for d in all_diffs[:100]:
            print(
                f"{d['tabla']:<14} {d['id']:<8} {d['campo']:<28} {d['antes'][:38]!r:<40} {d['ahora']!r}"
            )
        if len(all_diffs) > 100:
            print(f"... +{len(all_diffs) - 100} más")
        ids = {d["id"] for d in all_diffs}
        print(f"\nTOTAL: {len(ids)} registros, {len(all_diffs)} campos")

    prod.close()
    branch.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
