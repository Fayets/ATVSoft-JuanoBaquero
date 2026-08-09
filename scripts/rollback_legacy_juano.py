#!/usr/bin/env python3
"""Rollback migración legacy_juano: restaura snapshots y borra filas legacy.

Ejecutar SOLO después de revisar. Preferir restore del branch Neon si hay duda.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from pony.orm import db_session, rollback  # noqa: E402

from src.db import db  # noqa: E402
from src.models import Lead, LeadPayment, LegacyCuotaRef  # noqa: E402
from src.services.legacy_juano_import import rows_leads_for_user, rows_payments_for_user, rows_cuotas_for_user  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    uid = args.user_id

    import src.models  # noqa: F401

    db.generate_mapping(create_tables=True)

    restored = 0
    deleted_pay = 0
    deleted_cuota = 0
    deleted_lead = 0

    with db_session:
        for lead in rows_leads_for_user(uid):
            meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
            snap = meta.get("pre_import_snapshot")
            if snap and isinstance(snap, dict):
                if not args.dry_run:
                    lead.pago = float(snap.get("pago") or 0)
                    lead.debe = snap.get("debe")
                    lead.status = snap.get("status") or lead.status
                    lead.estado = snap.get("status") or lead.estado
                    lead.programa_ofrecido = snap.get("programa_ofrecido") or ""
                    del meta["pre_import_snapshot"]
                    lead.legacy_meta = meta
                restored += 1

        for p in rows_payments_for_user(uid):
            if (p.source or "") == "legacy_juano":
                if not args.dry_run:
                    p.delete()
                deleted_pay += 1

        for c in rows_cuotas_for_user(uid):
            if (c.source or "") == "legacy_juano":
                if not args.dry_run:
                    c.delete()
                deleted_cuota += 1

        for lead in rows_leads_for_user(uid):
            if (lead.source or "") == "legacy_juano":
                if not args.dry_run:
                    lead.delete()
                deleted_lead += 1

        if args.dry_run:
            rollback()

    print(f"Snapshots restaurados en leads ATV: {restored}")
    print(f"lead_payment legacy borrados: {deleted_pay}")
    print(f"legacy_cuota_ref borrados: {deleted_cuota}")
    print(f"lead legacy borrados: {deleted_lead}")
    if args.dry_run:
        print("(dry-run — no se escribió nada)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
