#!/usr/bin/env python3
"""Unifica variantes de closer duplicadas (tenant juano).

Uso:
  cd backend && python ../scripts/unificar_closers_duplicados.py --user-id 1 --dry-run
  cd backend && python ../scripts/unificar_closers_duplicados.py --user-id 1 --yes
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LegacyCuotaRef, TeamMember  # noqa: E402
from src.services.legacy_juano_import import normalize_closer  # noqa: E402

ORIGIN = "unificar_closers_duplicados"

# Variante exacta en lead.closer → canónico GHL
CLOSER_CANONICAL: dict[str, str] = {
    "Agus Olivero": "Agustín Olivero",
    "Matías Sandobal": "Matias Sandobal",
    "Catalina": "Catalina Zarlenga",
}

TEAM_RENAMES: dict[str, str] = {
    "Agus Olivero": "Agustín Olivero",
}


def merge_meta(existing, patch: dict) -> dict:
    base: dict = dict(existing) if isinstance(existing, dict) else {}
    base.update(patch)
    return base


def append_audit(meta: dict, campo: str, antes: object, despues: object) -> None:
    actualizaciones = meta.get("actualizaciones")
    if not isinstance(actualizaciones, list):
        actualizaciones = []
    actualizaciones.append(
        {
            "fecha": date.today().isoformat(),
            "campo": campo,
            "antes": antes,
            "despues": despues,
            "origen": ORIGIN,
        }
    )
    meta["actualizaciones"] = actualizaciones


@dataclass
class Stats:
    leads_updated: list[tuple[int, str, str]] = field(default_factory=list)
    cuotas_updated: list[tuple[int, str, str]] = field(default_factory=list)
    team_updated: list[tuple[int, str, str]] = field(default_factory=list)


def apply_lead_closer(lead: Lead, variant: str, canonical: str, stats: Stats, *, dry_run: bool) -> None:
    before_closer = (lead.closer or "").strip()
    before_norm = (lead.closer_norm or "").strip()
    if before_closer != variant:
        return
    stats.leads_updated.append((int(lead.id), variant, canonical))
    if dry_run:
        return
    lead.closer = canonical
    lead.closer_norm = normalize_closer(canonical)
    meta = merge_meta(getattr(lead, "legacy_meta", None), {})
    append_audit(meta, "closer", before_closer, canonical)
    if before_norm and before_norm != lead.closer_norm:
        append_audit(meta, "closer_norm", before_norm, lead.closer_norm)
    lead.legacy_meta = meta


def apply_cuota_ref(row: LegacyCuotaRef, variant: str, canonical: str, stats: Stats, *, dry_run: bool) -> None:
    raw = (row.closer_raw or "").strip()
    if raw != variant:
        return
    stats.cuotas_updated.append((int(row.id), variant, canonical))
    if dry_run:
        return
    row.closer_raw = canonical
    row.closer_norm = normalize_closer(canonical)


def apply_team_member(member: TeamMember, variant: str, canonical: str, stats: Stats, *, dry_run: bool) -> None:
    name = (member.nombre or "").strip()
    if name != variant:
        return
    stats.team_updated.append((int(member.id), variant, canonical))
    if dry_run:
        return
    member.nombre = canonical


@db_session
def run(user_id: int, *, dry_run: bool) -> Stats:
    stats = Stats()
    variants = set(CLOSER_CANONICAL.keys())

    for lead in list(Lead.select()):
        if int(lead.user_id) != user_id:
            continue
        variant = (lead.closer or "").strip()
        if variant not in variants:
            continue
        apply_lead_closer(lead, variant, CLOSER_CANONICAL[variant], stats, dry_run=dry_run)

    for row in list(LegacyCuotaRef.select()):
        if int(row.user_id) != user_id:
            continue
        variant = (row.closer_raw or "").strip()
        if variant not in variants:
            continue
        apply_cuota_ref(row, variant, CLOSER_CANONICAL[variant], stats, dry_run=dry_run)

    for member in list(TeamMember.select()):
        if int(member.user_id) != user_id or member.rol != "closer":
            continue
        variant = (member.nombre or "").strip()
        target = TEAM_RENAMES.get(variant)
        if not target:
            continue
        apply_team_member(member, variant, target, stats, dry_run=dry_run)

    if not dry_run:
        flush()
    return stats


def print_summary(stats: Stats, *, dry_run: bool) -> None:
    mode = "DRY RUN" if dry_run else "APLICADO"
    print(f"UNIFICAR CLOSERS — {mode}\n")
    print("Variantes → canónico:")
    for v, c in CLOSER_CANONICAL.items():
        n = sum(1 for _, a, b in stats.leads_updated if a == v)
        print(f"  {v!r} → {c!r}: {n} leads")
    if stats.cuotas_updated:
        print(f"\nlegacy_cuota_ref: {len(stats.cuotas_updated)}")
        for cid, a, b in stats.cuotas_updated:
            print(f"  id={cid} {a!r} → {b!r}")
    if stats.team_updated:
        print(f"\nTeamMember closers: {len(stats.team_updated)}")
        for mid, a, b in stats.team_updated:
            print(f"  id={mid} {a!r} → {b!r}")
    print(f"\nTotal leads: {len(stats.leads_updated)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Unificar variantes de closer duplicadas")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not args.yes:
        print("Usá --dry-run o --yes para aplicar.")
        return 1

    init_db()
    stats = run(args.user_id, dry_run=not args.yes)
    print_summary(stats, dry_run=not args.yes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
