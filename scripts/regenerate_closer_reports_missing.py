#!/usr/bin/env python3
"""Regenera CloserReport solo para días faltantes de closers dados."""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import CloserReport, Lead, TeamMember  # noqa: E402
from src.services.closer_report_auto_service import (  # noqa: E402
    aggregate_closer_metrics,
    generate_closer_report_for_member,
    leads_for_closer_on_date,
    upsert_closer_report,
)

UID = 1
TARGETS = ("Ignacio Claveria", "Martín Jácome")


@db_session
def existing_report_dates(member_id: int) -> set[date]:
    return {
        r.fecha
        for r in CloserReport.select()
        if int(r.user_id) == UID and int(r.member_id) == member_id
    }


@db_session
def call_dates_for_closer(closer_name: str) -> set[date]:
    target = closer_name.strip().lower()
    days: set[date] = set()
    for lead in list(Lead.select()):
        if int(lead.user_id) != UID or lead.call is None:
            continue
        if (lead.closer or "").strip().lower() != target:
            continue
        days.add(lead.call.date())
    return days


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.yes:
        print("Usá --dry-run o --yes")
        return 1

    init_db()

    print("=== CloserReport existentes ===")
    with db_session:
        for name in TARGETS:
            member = TeamMember.get(user_id=UID, nombre=name)
            if member is None:
                print(f"{name}: miembro no encontrado")
                continue
            mid = int(member.id)
            existing = sorted(existing_report_dates(mid))
            call_days = sorted(call_dates_for_closer(name))
            missing = [d for d in call_days if d not in set(existing)]
            print(f"\n{name} (id={mid}):")
            print(f"  llamadas en {len(call_days)} días: {call_days[0] if call_days else '-'} → {call_days[-1] if call_days else '-'}")
            print(f"  reportes existentes: {len(existing)}")
            if existing:
                print(f"    fechas: {[d.isoformat() for d in existing]}")
            print(f"  días SIN reporte: {len(missing)}")
            if missing:
                print(f"    {[d.isoformat() for d in missing]}")

            if args.dry_run:
                continue

            for d in missing:
                leads = leads_for_closer_on_date(UID, d, name)
                if not leads:
                    print(f"  skip {d}: sin leads")
                    continue
                metrics = aggregate_closer_metrics(leads)
                upsert_closer_report(UID, mid, d, metrics, send_discord=False)
                print(f"  generado {d}: {metrics['llamadas_agendadas']} llamadas")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
