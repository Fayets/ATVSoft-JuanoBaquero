#!/usr/bin/env python3
"""Desglose de leads modificados por campo — CSV vs legacy_lead_ref.payload."""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT))
os.chdir(BACKEND)

from pony.orm import db_session  # noqa: E402

from claude_report import report_footer, write_claude_report  # noqa: E402
from src.db import init_db  # noqa: E402
from src.models import LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import normalize_csv_row  # noqa: E402

REPORT_NAME = "MODIFIED_LEADS_BREAKDOWN_JUANO.md"
NULLISH = frozenset({"", "null", "none", "n/a", "—", "–", "-"})

FIELDS: tuple[tuple[str, str], ...] = (
    ("presento", "presento"),
    ("situacion", "situacion"),
    ("cierre", "cierre"),
    ("fecha_llamada", "fecha_llamada"),
    ("fecha_agenda", "fecha_agenda"),
    ("fecha (bot)", "fecha"),
    ("producto", "producto"),
    ("calificado", "calificado"),
    ("correo", "correo"),
    ("telefono", "telefono"),
    ("tel_norm", "tel_norm"),
    ("nombre", "nombre"),
    ("closer", "closer"),
    ("setter", "setter"),
    ("fuente", "fuente"),
    ("origen", "origen"),
    ("ghl_contact_id", "ghl_contact_id"),
)


def norm_val(raw: object) -> str:
    s = str(raw or "").strip()
    if s.casefold() in NULLISH:
        return ""
    return s


def norm_date(raw: object) -> str:
    s = norm_val(raw)
    return s[:10] if len(s) >= 10 else s


def load_csv(data_dir: Path) -> dict[str, dict[str, str]]:
    path = data_dir / "leads.csv"
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {(r.get("id") or "").strip(): normalize_csv_row(r) for r in csv.DictReader(f)}


def values_equal(field: str, bd: str, csv: str) -> bool:
    if field.startswith("fecha"):
        return norm_date(bd) == norm_date(csv)
    return norm_val(bd) == norm_val(csv)


@db_session
def run_breakdown(user_id: int, csv_rows: dict[str, dict[str, str]]) -> dict:
    by_field: dict[str, list[dict]] = defaultdict(list)
    leads_any: set[str] = set()
    counts: dict[str, int] = {label: 0 for label, _ in FIELDS}

    for ref in LegacyLeadRef.select():
        if ref.user_id != user_id:
            continue
        lid = (ref.legacy_id or "").strip()
        if lid not in csv_rows:
            continue
        row = csv_rows[lid]
        payload = ref.payload if isinstance(ref.payload, dict) else {}
        nombre = (row.get("nombre") or payload.get("nombre") or "").strip()

        for label, key in FIELDS:
            bv = payload.get(key, "")
            cv = row.get(key, "")
            if values_equal(label, bv, cv):
                continue
            counts[label] += 1
            leads_any.add(lid)
            if len(by_field[label]) < 3:
                by_field[label].append(
                    {
                        "legacy_id": lid,
                        "nombre": nombre,
                        "bd": norm_val(bv) or repr(bv)[:30],
                        "csv": norm_val(cv) or repr(cv)[:30],
                    }
                )

    return {
        "counts": counts,
        "examples": dict(by_field),
        "leads_any": len(leads_any),
    }


def build_markdown(data: dict, user_id: int) -> str:
    counts = data["counts"]
    examples = data["examples"]
    lines = [
        "## Resumen",
        "",
        f"- Leads con al menos un campo distinto (payload vs CSV): **{data['leads_any']}**",
        f"- Suma de diferencias por campo (un lead puede contar en varios): **{sum(counts.values())}**",
        "",
        "> Solo compara `legacy_lead_ref.payload` vs CSV. **No** incluye `lead.status` derivado.",
        "",
        "## Por campo",
        "",
        "| campo | leads | ejemplos BD → CSV |",
        "|-------|------:|-------------------|",
    ]

    for label, _ in FIELDS:
        cnt = counts.get(label, 0)
        ex = examples.get(label, [])
        ex_str = " — ".join(f'{e["bd"]!r} → {e["csv"]!r}' for e in ex[:3]) if ex else "—"
        lines.append(f"| {label} | {cnt} | {ex_str} |")

    lines.extend(["", "## Ejemplos detallados (3 por campo con diferencias)", ""])
    for label, _ in FIELDS:
        cnt = counts.get(label, 0)
        if cnt == 0:
            continue
        lines.append(f"### {label} ({cnt} leads)")
        lines.append("")
        for ex in examples.get(label, []):
            lines.append(
                f"- `{ex['legacy_id'][:8]}…` **{ex['nombre'][:32]}** — "
                f"BD `{ex['bd']}` → CSV `{ex['csv']}`"
            )
        lines.append("")

    lines.extend([
        "## Gap validate Presento Sí",
        "",
        "CSV=`Sí` y payload≠`Sí`: verificar post-upsert con `validate_legacy_juano.py`.",
        "",
    ])
    lines.append(report_footer("detect_modified_leads_breakdown.py", user_id))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Desglose leads modificados por campo")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "legacy")
    parser.add_argument("--no-write-docs", action="store_true")
    args = parser.parse_args()

    csv_rows = load_csv(args.data_dir)
    init_db()
    data = run_breakdown(args.user_id, csv_rows)
    md = build_markdown(data, args.user_id)
    print(md)

    if not args.no_write_docs:
        path = write_claude_report(REPORT_NAME, md, title="Leads modificados — desglose por campo")
        print(f"\nReporte guardado: {path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
