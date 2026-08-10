#!/usr/bin/env python3
"""Compara leads.csv vs legacy_lead_ref — detecta modificaciones en origen (solo reporte)."""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import map_situacion, normalize_csv_row, parse_date  # noqa: E402

# Campos objetivos del CSV vs BD (reporte §2 analisis-checks-fallidos)
COMPARE_FIELDS: tuple[tuple[str, str, str], ...] = (
    ("presento", "presento", "payload"),
    ("cierre", "cierre", "payload"),
    ("fecha_llamada", "fecha_llamada", "payload"),
    ("situacion", "situacion", "payload"),
    ("producto", "producto", "payload"),
    ("calificado", "calificado", "payload"),
)


def load_csv(data_dir: Path) -> dict[str, dict[str, str]]:
    path = data_dir / "leads.csv"
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {(r.get("id") or "").strip(): normalize_csv_row(r) for r in csv.DictReader(f)}


def _bd_value(ref: LegacyLeadRef, lead: Lead | None, field: str, source: str) -> str:
    if source == "payload":
        payload = ref.payload if isinstance(ref.payload, dict) else {}
        return (payload.get(field) or "").strip()
    if source == "legacy_meta" and lead:
        meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
        return (meta.get(field) or "").strip()
    if field == "fecha_llamada" and lead and lead.call:
        return lead.call.date().isoformat()
    if field == "status" and lead:
        return (lead.status or lead.estado or "").strip()
    return ""


@db_session
def run_detect(user_id: int, csv_rows: dict[str, dict[str, str]]) -> list[dict]:
    diffs: list[dict] = []
    for ref in LegacyLeadRef.select():
        if ref.user_id != user_id:
            continue
        lid = (ref.legacy_id or "").strip()
        if lid not in csv_rows:
            continue
        row = csv_rows[lid]
        lead = Lead.get(id=ref.lead_id) if ref.lead_id else None
        changes: list[dict] = []

        for label, csv_key, bd_source in COMPARE_FIELDS:
            cv = (row.get(csv_key) or "").strip()
            bv = _bd_value(ref, lead, csv_key if bd_source == "payload" else label, bd_source)
            if not cv and not bv:
                continue
            if cv != bv:
                changes.append({"campo": label, "bd": bv, "csv": cv})

        if changes:
            payload = ref.payload if isinstance(ref.payload, dict) else {}
            diffs.append(
                {
                    "legacy_id": lid,
                    "nombre": (row.get("nombre") or payload.get("nombre") or "").strip(),
                    "lead_id": ref.lead_id,
                    "rol": ref.rol,
                    "changes": changes,
                }
            )
    diffs.sort(key=lambda x: x["legacy_id"])
    return diffs


def main() -> int:
    parser = argparse.ArgumentParser(description="Detectar leads legacy modificados vs CSV")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "legacy")
    args = parser.parse_args()

    csv_rows = load_csv(args.data_dir)
    init_db()
    diffs = run_detect(args.user_id, csv_rows)

    presento_changes = sum(1 for d in diffs if any(c["campo"].startswith("presento") for c in d["changes"]))
    total_fields = sum(len(d["changes"]) for d in diffs)

    print("=== LEADS MODIFICADOS EN ORIGEN ===\n")
    if not diffs:
        print("(ninguno)")
    else:
        print(f"{'legacy_id':36} {'nombre':28} {'campo':22} {'BD':>16} {'CSV':>16}")
        print("-" * 120)
        for d in diffs:
            for ch in d["changes"]:
                print(
                    f"{d['legacy_id'][:36]:36} {d['nombre'][:28]:28} "
                    f"{ch['campo']:22} {ch['bd']!s:>16} {ch['csv']!s:>16}"
                )
            print(f"  → lead_id={d['lead_id']} rol={d['rol']}")
            print()

    print(f"TOTAL: {len(diffs)} leads, {total_fields} campos")
    print(f"  con cambio en presento: {presento_changes}  (esperado ~2 para el gap validate)")

    csv_presento_si = sum(1 for r in csv_rows.values() if (r.get("presento") or "").strip() == "Sí")
    print(f"\nPresento Sí en CSV actual: {csv_presento_si}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
