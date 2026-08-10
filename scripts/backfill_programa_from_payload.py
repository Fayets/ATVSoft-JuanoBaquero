#!/usr/bin/env python3
"""Backfill complementario: programa_ofrecido desde payload y/o leads.csv."""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from claude_report import report_footer, write_claude_report  # noqa: E402
from src.db import init_db  # noqa: E402
from src.models import Lead, LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import LEGACY_SOURCE, normalize_producto_norm  # noqa: E402
from src.services.programs_services import normalize_program_lookup_key  # noqa: E402

REPORT_NAME = "BACKFILL_PROGRAMAS_PAYLOAD_JUANO.md"
SKIP = frozenset({"", "null", "none", "Sin especificar", "Otro"})
NULLISH = frozenset({"", "null", "none"})

# Nombres canónicos legacy (NO mapear a TIY)
LEGACY_PRODUCT_ALIASES: dict[str, str] = {
    "premium (6 meses)": "Premium 6 meses",
    "premium": "Premium 6 meses",
    "programa ($1500)": "Premium 6 meses",
    "programa ($1200)": "Premium 6 meses",
    "programa": "Premium 6 meses",
    "vip (6 meses)": "VIP 6 meses",
    "vip anual (12 meses)": "VIP Anual (12 meses)",
    "imperio studio pro": "Imperio Studio Pro",
    "imperio studio": "Imperio Studio",
    "express": "Express / Downsell",
    "express ($250)": "Express / Downsell",
    "express ($100)": "Express / Downsell",
}


def _strip_price_suffix(raw: str) -> str:
    s = (raw or "").strip()
    s = re.sub(r"\s*\(\$\d+\)\s*$", "", s)
    return s.strip()


def normalize_payload_producto(raw: str | None) -> str:
    s = _strip_price_suffix(str(raw or "").strip())
    if s.casefold() in NULLISH:
        return ""
    nk = normalize_program_lookup_key(s)
    if nk in LEGACY_PRODUCT_ALIASES:
        return LEGACY_PRODUCT_ALIASES[nk]
    norm = normalize_producto_norm(s)
    if norm and norm not in SKIP:
        return norm
    # CSV ya normalizado (ej. "Premium 6 meses")
    if nk.startswith("premium") and "meses" in nk:
        return "Premium 6 meses"
    if nk.startswith("vip") and "anual" in nk:
        return "VIP Anual (12 meses)"
    if nk.startswith("vip"):
        return "VIP 6 meses"
    if "express" in nk or "downsell" in nk:
        return "Express / Downsell"
    if "imperio studio pro" in nk:
        return "Imperio Studio Pro"
    if "imperio studio" in nk:
        return "Imperio Studio"
    return ""


@db_session
def build_refs_by_lead(user_id: int) -> dict[int, list[LegacyLeadRef]]:
    out: dict[int, list[LegacyLeadRef]] = defaultdict(list)
    for ref in LegacyLeadRef.select():
        if ref.user_id != user_id or not ref.lead_id:
            continue
        out[int(ref.lead_id)].append(ref)
    return out


def producto_from_refs(refs: list[LegacyLeadRef], csv_rows: dict[str, dict[str, str]]) -> tuple[str, str]:
    order = {"merge_winner": 0, "new": 1, "merge_absorbed": 2}
    refs_sorted = sorted(refs, key=lambda r: order.get(r.rol or "", 9))
    for ref in refs_sorted:
        payload = ref.payload if isinstance(ref.payload, dict) else {}
        prod = normalize_payload_producto(payload.get("producto"))
        if prod:
            return prod, "payload"
        lid = (ref.legacy_id or "").strip()
        csv_prod = normalize_payload_producto((csv_rows.get(lid, {}).get("producto") or ""))
        if csv_prod:
            return csv_prod, "csv"
    return "", ""


@db_session
def run_backfill(
    user_id: int,
    csv_rows: dict[str, dict[str, str]],
    *,
    dry_run: bool,
) -> tuple[list[dict], Counter]:
    refs_by_lead = build_refs_by_lead(user_id)
    changes: list[dict] = []
    skipped_has_programa = 0
    skipped_no_payload = 0

    for lead in Lead.select():
        if lead.user_id != user_id or (lead.source or "") != LEGACY_SOURCE:
            continue
        if (lead.programa_ofrecido or "").strip():
            skipped_has_programa += 1
            continue
        refs = refs_by_lead.get(int(lead.id), [])
        if not refs:
            skipped_no_payload += 1
            continue
        new, src = producto_from_refs(refs, csv_rows)
        if not new:
            skipped_no_payload += 1
            continue
        changes.append(
            {
                "lead_id": int(lead.id),
                "nombre": (lead.nombre or "")[:36],
                "new": new,
                "source": src,
            }
        )
        if not dry_run:
            lead.programa_ofrecido = new
            flush()

    stats: Counter = Counter(
        {
            "updated": len(changes),
            "skipped_already_filled": skipped_has_programa,
            "skipped_no_producto": skipped_no_payload,
        }
    )
    return changes, stats


def build_markdown(changes: list[dict], stats: Counter, user_id: int, *, dry_run: bool) -> str:
    mode = "DRY-RUN" if dry_run else "APLICADO"
    lines = [
        f"Modo: **{mode}**",
        "",
        f"- Actualizados (payload o CSV vía legacy_id): **{stats['updated']}**",
        f"- Omitidos (ya tenían programa, p. ej. backfill pagos): **{stats['skipped_already_filled']}**",
        f"- Omitidos (sin producto en payload): **{stats['skipped_no_producto']}**",
        "",
        "> Solo rellena `programa_ofrecido` **vacío**. No pisa los 79 del backfill por pagos.",
        "",
    ]
    if changes:
        lines.extend([
            "### Muestra",
            "",
            "| lead_id | nombre | programa_ofrecido | fuente |",
            "|--------:|--------|-------------------|--------|",
        ])
        for c in changes[:40]:
            lines.append(f"| {c['lead_id']} | {c['nombre']} | {c['new']} | {c['source']} |")
        if len(changes) > 40:
            lines.append(f"\n*… y {len(changes) - 40} más.*")
    lines.append(report_footer("backfill_programa_from_payload.py", user_id))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill programa_ofrecido desde payload")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--no-write-docs", action="store_true")
    args = parser.parse_args()
    dry_run = not args.yes

    csv_path = ROOT / "data" / "legacy" / "leads.csv"
    csv_rows = {r["id"]: r for r in csv.DictReader(open(csv_path, encoding="utf-8-sig"))}

    init_db()
    changes, stats = run_backfill(args.user_id, csv_rows, dry_run=dry_run)
    md = build_markdown(changes, stats, args.user_id, dry_run=dry_run)
    print(md)

    if not args.no_write_docs:
        path = write_claude_report(REPORT_NAME, md, title="Backfill programa desde payload")
        print(f"\nReporte guardado: {path}", file=sys.stderr)

    if dry_run:
        print("\nDry-run. Usá --yes para aplicar.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
