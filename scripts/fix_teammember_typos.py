#!/usr/bin/env python3
"""Corrige typos en TeamMember (nombres GHL)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import TeamMember  # noqa: E402

FIXES: dict[int, str] = {
    14: "Ignacio Claveria",
    12: "Martín Jácome",
}


@db_session
def run(*, dry_run: bool) -> None:
    for mid, canonical in FIXES.items():
        m = TeamMember.get(id=mid)
        if m is None:
            print(f"id={mid} no encontrado")
            continue
        before = (m.nombre or "").strip()
        print(f"id={mid}: {before!r} → {canonical!r}")
        if not dry_run and before != canonical:
            m.nombre = canonical
    if not dry_run:
        flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.yes:
        print("Usá --dry-run o --yes")
        return 1
    init_db()
    run(dry_run=not args.yes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
