#!/usr/bin/env python3
"""Reconciliar lead.pago / lead.debe con historial lead_payment (post-cobranzas manuales).

Uso:
  cd backend
  python ../scripts/reconcile_lead_pago.py --user-id 1 --dry-run
  python ../scripts/reconcile_lead_pago.py --user-id 1 --yes   # aplicar (solo tras revisar dry-run)
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from pony.orm import db_session, rollback  # noqa: E402

from src.models import Lead, LeadPayment  # noqa: E402
from src.services.legacy_juano_import import ensure_db_mapping  # noqa: E402
from src.services.lead_financials_service import (  # noqa: E402
    payments_for_lead,
    recalc_lead_financials,
)


@dataclass
class LeadDelta:
    lead_id: int
    nombre: str
    pago_old: float
    pago_new: float
    debe_old: float | None
    debe_new: float | None
    pagos: int


def _fmt_debe(v: float | None) -> str:
    if v is None:
        return "NULL"
    return f"{v:.2f}"


def compute_deltas(uid: int) -> list[LeadDelta]:
    deltas: list[LeadDelta] = []
    lead_ids = {
        int(p.lead_id)
        for p in list(LeadPayment.select())
        if int(p.user_id) == uid
    }
    for lid in sorted(lead_ids):
        try:
            lead = Lead[lid]
        except Exception:
            continue
        if int(lead.user_id) != uid:
            continue
        payments = payments_for_lead(uid, lid)
        pago_old = float(lead.pago or 0)
        debe_old = lead.debe if lead.debe is None else float(lead.debe)
        recalc_lead_financials(uid, lead, payments)
        pago_new = float(lead.pago or 0)
        debe_new = lead.debe if lead.debe is None else float(lead.debe)
        if abs(pago_old - pago_new) > 1e-9 or debe_old != debe_new:
            deltas.append(
                LeadDelta(
                    lead_id=lid,
                    nombre=(lead.nombre or "").strip() or "(sin nombre)",
                    pago_old=pago_old,
                    pago_new=pago_new,
                    debe_old=debe_old,
                    debe_new=debe_new,
                    pagos=len(payments),
                )
            )
        # revert in-memory for dry-run (rollback handles persist)
        lead.pago = pago_old
        lead.debe = debe_old
    return deltas


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconciliar lead.pago desde lead_payment")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true", help="Solo reporte (default si no --yes)")
    parser.add_argument("--yes", action="store_true", help="Aplicar cambios en BD")
    args = parser.parse_args()
    apply = args.yes and not args.dry_run
    if not apply:
        print("Modo DRY-RUN (sin escrituras). Usá --yes para aplicar.\n")

    ensure_db_mapping()
    uid = args.user_id

    with db_session:
        deltas = compute_deltas(uid)
        if not apply:
            rollback()
        elif deltas:
            for d in deltas:
                lead = Lead[d.lead_id]
                payments = payments_for_lead(uid, d.lead_id)
                recalc_lead_financials(uid, lead, payments)

    print(f"user_id={uid} leads con delta: {len(deltas)}")
    if not deltas:
        print("Nada que reconciliar.")
        return 0

    total_pago_shift = sum(d.pago_new - d.pago_old for d in deltas)
    print(f"Suma delta pago: {total_pago_shift:+.2f} USD\n")
    print(f"{'id':>6}  {'pagos':>5}  {'pago old':>10}  {'pago new':>10}  {'debe old':>10}  {'debe new':>10}  nombre")
    print("-" * 90)
    for d in deltas[:50]:
        print(
            f"{d.lead_id:6d}  {d.pagos:5d}  {d.pago_old:10.2f}  {d.pago_new:10.2f}  "
            f"{_fmt_debe(d.debe_old):>10}  {_fmt_debe(d.debe_new):>10}  {d.nombre[:40]}"
        )
    if len(deltas) > 50:
        print(f"... y {len(deltas) - 50} más")

    if apply:
        print("\n✓ Cambios aplicados.")
    else:
        print("\n(dry-run — no se escribió nada)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
