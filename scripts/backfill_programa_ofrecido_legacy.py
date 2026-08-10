#!/usr/bin/env python3
"""Backfill Lead.programa_ofrecido desde pagos legacy → catálogo OfferedProgram."""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LeadPayment, OfferedProgram  # noqa: E402
from src.services.legacy_juano_import import LEGACY_SOURCE, normalize_producto_norm  # noqa: E402
from src.services.programs_services import normalize_program_lookup_key  # noqa: E402

SKIP_PRODUCTS = frozenset({"", "Sin especificar", "Otro"})


def build_catalog_maps(user_id: int) -> tuple[dict[str, str], dict[str, float]]:
    """norm_key → nombre canónico del catálogo; norm_key → price."""
    name_by_key: dict[str, str] = {}
    price_by_key: dict[str, float] = {}
    with db_session:
        for p in OfferedProgram.select():
            if int(p.user_id) != user_id:
                continue
            name = (p.name or "").strip()
            nk = normalize_program_lookup_key(name)
            if nk:
                name_by_key[nk] = name
                price_by_key[nk] = float(p.price_usd or 0)
    return name_by_key, price_by_key


def _strip_price_suffix(raw: str) -> str:
    """Quita sufijos legacy tipo ' ($1200)' para lookup."""
    import re

    s = (raw or "").strip()
    s = re.sub(r"\s*\(\$\d+\)\s*$", "", s)
    return s.strip()


def resolve_canonical_program(
    raw: str,
    name_by_key: dict[str, str],
) -> tuple[str, str]:
    """Retorna (valor_canónico, fuente_lookup)."""
    candidates = [raw]
    stripped = _strip_price_suffix(raw)
    if stripped != raw:
        candidates.append(stripped)
    norm = normalize_producto_norm(raw)
    if norm and norm not in candidates:
        candidates.append(norm)

    for cand in candidates:
        nk = normalize_program_lookup_key(cand)
        if nk in name_by_key:
            return name_by_key[nk], "catalog"
    # Sin match catálogo: preferir producto de pago ya normalizado
    best = normalize_producto_norm(raw) or stripped or raw
    return best, "normalized"


def product_from_payments(user_id: int, lead_id: int) -> str:
    for p in LeadPayment.select():
        if p.user_id != user_id or int(p.lead_id) != lead_id:
            continue
        if (p.source or "") != LEGACY_SOURCE:
            continue
        prod = normalize_producto_norm(p.producto)
        if prod and prod not in SKIP_PRODUCTS:
            return prod
    return ""


@db_session
def run_backfill(user_id: int, *, dry_run: bool) -> tuple[list[dict], Counter]:
    name_by_key, _ = build_catalog_maps(user_id)
    changes: list[dict] = []
    sources: Counter = Counter()

    for lead in Lead.select():
        if lead.user_id != user_id or (lead.source or "") != LEGACY_SOURCE:
            continue
        old = (lead.programa_ofrecido or "").strip()
        from_payment = product_from_payments(user_id, int(lead.id))
        raw_source = from_payment or old
        if not raw_source or raw_source in SKIP_PRODUCTS:
            continue
        new, lookup = resolve_canonical_program(raw_source, name_by_key)
        if not new or new == old:
            continue
        source = "payment" if from_payment else "lead"
        if lookup == "catalog":
            source = f"{source}+catalog"
        changes.append(
            {
                "lead_id": int(lead.id),
                "nombre": (lead.nombre or "")[:40],
                "old": old,
                "new": new,
                "source": source,
            }
        )
        sources[source] += 1
        if not dry_run:
            lead.programa_ofrecido = new
            flush()

    return changes, sources


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill programa_ofrecido legacy_juano")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--yes", action="store_true", help="Aplicar (default: dry-run)")
    args = parser.parse_args()
    dry_run = not args.yes

    init_db()
    changes, sources = run_backfill(args.user_id, dry_run=dry_run)

    mode = "DRY-RUN" if dry_run else "APLICADO"
    print(f"=== BACKFILL programa_ofrecido ({mode}) user_id={args.user_id} ===\n")
    print(f"Leads a actualizar: {len(changes)}")
    for src, cnt in sources.most_common():
        print(f"  fuente {src}: {cnt}")

    if changes:
        print(f"\n{'lead_id':>8} {'nombre':32} {'antes':28} → {'después':28}")
        print("-" * 110)
        for c in changes[:40]:
            print(
                f"{c['lead_id']:8d} {c['nombre'][:32]:32} "
                f"{c['old'][:28]:28} → {c['new'][:28]:28}  [{c['source']}]"
            )
        if len(changes) > 40:
            print(f"  ... y {len(changes) - 40} más")

    @db_session
    def mayo_summary(uid: int) -> list[tuple[str, int]]:
        from datetime import datetime

        counts: Counter[str] = Counter()
        for lead in Lead.select():
            if lead.user_id != uid or (lead.source or "") != LEGACY_SOURCE:
                continue
            ref_date = lead.call or lead.agendo or lead.fecha_bot or lead.created_at
            if not ref_date:
                continue
            if isinstance(ref_date, datetime):
                d = ref_date.date()
            else:
                d = ref_date
            if d.year == 2026 and d.month == 5:
                prog = (lead.programa_ofrecido or "").strip() or "(vacío)"
                counts[prog] += 1
        return counts.most_common()

    print("\n--- PROGRAMAS mayo 2026 (legacy) post-backfill ---")
    name_by_key, price_by_key = build_catalog_maps(args.user_id)
    for prog, cnt in mayo_summary(args.user_id):
        nk = normalize_program_lookup_key(prog)
        price = price_by_key.get(nk)
        price_s = f"${price:.0f}" if price is not None else "$0 (sin match catálogo)"
        print(f"  {cnt:4d}  {prog[:40]:40}  facturación/unidad: {price_s}")

    if dry_run:
        print("\nDry-run. Usá --yes para aplicar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
