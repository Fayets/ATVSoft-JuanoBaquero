#!/usr/bin/env python3
"""Unificar Agustín Olivero — tenant juano (user_id=1).

Uso:
  python scripts/unificar_agustin.py --dry-run
  python scripts/unificar_agustin.py --yes
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
from src.models import Lead, TeamMember  # noqa: E402
from src.services.legacy_juano_import import normalize_closer  # noqa: E402

USER_ID = 1
MEMBER_ID = 24
CANONICAL = "Agustín Olivero"
ORIGIN = "unificacion_agustin"


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
    team_renamed: bool = False
    leads_agustin: list[int] = field(default_factory=list)
    leads_norm_backfill: list[int] = field(default_factory=list)


@db_session
def run(*, dry_run: bool) -> Stats:
    stats = Stats()
    member = TeamMember.get(id=MEMBER_ID)
    if member is None or int(member.user_id) != USER_ID:
        raise SystemExit(f"TeamMember id={MEMBER_ID} no encontrado para user_id={USER_ID}")
    if (member.nombre or "").strip() != "Agustin":
        print(f"[warn] TeamMember id={MEMBER_ID} nombre actual: {member.nombre!r} (esperado Agustin)")

    dup = [
        m
        for m in TeamMember.select()
        if int(m.user_id) == USER_ID
        and m.id != MEMBER_ID
        and (m.nombre or "").strip().casefold() == CANONICAL.casefold()
    ]
    if dup:
        raise SystemExit(f"Ya existe otro TeamMember con nombre {CANONICAL!r}: ids={[m.id for m in dup]}")

    for lead in list(Lead.select()):
        if int(lead.user_id) != USER_ID:
            continue
        closer = (lead.closer or "").strip()
        if closer == "Agustin":
            stats.leads_agustin.append(int(lead.id))
            if not dry_run:
                before_closer = closer
                before_norm = (lead.closer_norm or "").strip()
                lead.closer = CANONICAL
                lead.closer_norm = CANONICAL
                meta = merge_meta(getattr(lead, "legacy_meta", None), {})
                append_audit(meta, "closer", before_closer, CANONICAL)
                if before_norm != CANONICAL:
                    append_audit(meta, "closer_norm", before_norm, CANONICAL)
                lead.legacy_meta = meta
            continue
        if closer == CANONICAL and not (lead.closer_norm or "").strip():
            stats.leads_norm_backfill.append(int(lead.id))
            if not dry_run:
                before_norm = (lead.closer_norm or "").strip()
                lead.closer_norm = CANONICAL
                meta = merge_meta(getattr(lead, "legacy_meta", None), {})
                append_audit(meta, "closer_norm", before_norm, CANONICAL)
                lead.legacy_meta = meta

    stats.team_renamed = (member.nombre or "").strip() == "Agustin"
    if stats.team_renamed and not dry_run:
        member.nombre = CANONICAL

    if not dry_run:
        flush()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    init_db()
    stats = run(dry_run=args.dry_run)

    mode = "DRY-RUN" if args.dry_run else "APPLY"
    print(f"=== {mode} unificacion_agustin ===")
    print(f"TeamMember id={MEMBER_ID} renombrar Agustin -> {CANONICAL}: {stats.team_renamed}")
    print(f"Leads closer=Agustin -> {CANONICAL}: {len(stats.leads_agustin)}")
    print(f"Leads backfill closer_norm vacío: {len(stats.leads_norm_backfill)}")
    if args.dry_run and (stats.leads_agustin or stats.leads_norm_backfill):
        print(f"  ids Agustin (muestra): {stats.leads_agustin[:5]}...")
        print(f"  ids norm backfill (muestra): {stats.leads_norm_backfill[:5]}...")


if __name__ == "__main__":
    main()
