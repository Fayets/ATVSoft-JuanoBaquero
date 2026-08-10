#!/usr/bin/env python3
"""Verificaciones post-import incremental (go-import-incremental.md §2)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LeadPayment, LegacyLeadRef  # noqa: E402


@db_session
def run_checks() -> dict:
    uid = 1
    out: dict = {}

    refs_1855_6989 = [
        {
            "lead_id": r.lead_id,
            "rol": r.rol,
            "legacy_id": r.legacy_id,
            "motivo": r.motivo,
        }
        for r in LegacyLeadRef.select()
        if r.user_id == uid and int(r.lead_id or 0) in (1855, 6989)
    ]
    refs_1855_6989.sort(key=lambda x: (x["lead_id"], x["rol"] or ""))
    out["refs_1855_6989"] = refs_1855_6989

    updated_payments = []
    for p in LeadPayment.select():
        if p.user_id != uid:
            continue
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        if not meta.get("actualizaciones"):
            continue
        updated_payments.append(
            {
                "legacy_id": p.legacy_id,
                "lead_id": p.lead_id,
                "monto": p.monto,
                "concepto": p.concepto,
                "fecha": p.fecha.isoformat() if p.fecha else "",
                "historial": meta.get("actualizaciones"),
            }
        )
    out["updated_payments"] = updated_payments

    huerfanos_vaciados = sum(
        1
        for l in Lead.select()
        if l.user_id == uid and (l.legacy_meta or {}).get("merged_into")
    )
    pagos_en_huerfanos = 0
    for p in LeadPayment.select():
        if p.user_id != uid:
            continue
        lead = Lead.get(id=p.lead_id)
        if lead and (lead.legacy_meta or {}).get("merged_into"):
            pagos_en_huerfanos += 1
    out["huerfanos_vaciados"] = huerfanos_vaciados
    out["pagos_en_huerfanos"] = pagos_en_huerfanos

    julio_cnt = 0
    julio_usd = 0.0
    pay_cnt = 0
    pay_usd = 0.0
    for p in LeadPayment.select():
        if p.user_id != uid or (p.source or "") != "legacy_juano":
            continue
        pay_cnt += 1
        pay_usd += float(p.monto or 0)
        if p.fecha and p.fecha.year == 2026 and p.fecha.month == 7:
            julio_cnt += 1
            julio_usd += float(p.monto or 0)
    out["julio"] = (julio_cnt, round(julio_usd, 2))
    out["pagos_legacy"] = (pay_cnt, round(pay_usd, 2))
    out["legacy_lead_ref_count"] = sum(1 for r in LegacyLeadRef.select() if r.user_id == uid)
    return out


def main() -> int:
    init_db()
    out = run_checks()

    print("=== 2.1 Lead 1855/6989 ===")
    for row in out["refs_1855_6989"]:
        print(row)

    print("\n=== 2.2 Pagos con actualizaciones ===")
    print(f"count={len(out['updated_payments'])}")
    for row in out["updated_payments"]:
        print(
            f"  {row['legacy_id'][:8]}… lead_id={row['lead_id']} "
            f"monto={row['monto']} concepto={row['concepto']!r} fecha={row['fecha']}"
        )
        print(f"    historial={json.dumps(row['historial'], ensure_ascii=False)}")

    print("\n=== 2.3 Huérfanos ===")
    print(f"huerfanos_vaciados: {out['huerfanos_vaciados']}")
    print(f"pagos_en_huerfanos: {out['pagos_en_huerfanos']}")

    print("\n=== 2.4 Ancla julio ===")
    print(f"julio: {out['julio']}")

    print("\n=== Totales pagos legacy ===")
    print(f"pagos/usd: {out['pagos_legacy']}")

    print("\n=== legacy_lead_ref ===")
    print(f"count: {out['legacy_lead_ref_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
