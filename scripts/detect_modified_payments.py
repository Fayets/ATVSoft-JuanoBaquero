#!/usr/bin/env python3
"""Compara pagos.csv vs lead_payment legacy en BD — detecta altas y modificaciones."""
from __future__ import annotations

import argparse
import csv
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from pony.orm import db_session  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import LeadPayment  # noqa: E402


def _dec(x: object) -> Decimal:
    try:
        return Decimal(str(x or "0").replace(",", "."))
    except Exception:
        return Decimal("0")


def main() -> int:
    parser = argparse.ArgumentParser(description="Detectar pagos legacy modificados vs CSV")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=ROOT / "data" / "legacy",
    )
    args = parser.parse_args()

    csv_path = args.data_dir / "pagos.csv"
    if not csv_path.is_file():
        print(f"ERROR: no existe {csv_path}", file=sys.stderr)
        return 1

    csv_rows = {r["id"]: r for r in csv.DictReader(open(csv_path, encoding="utf-8"))}
    init_db()

    @db_session
    def run() -> tuple[list, list, list, Decimal]:
        uid = args.user_id
        bd_map: dict[str, LeadPayment] = {}
        for p in LeadPayment.select():
            if p.user_id != uid:
                continue
            if (getattr(p, "source", None) or "") != "legacy_juano":
                continue
            lid = (p.legacy_id or "").strip()
            if lid:
                bd_map[lid] = p

        diffs: list[dict] = []
        only_csv: list[dict] = []
        only_bd: list[str] = []
        total_delta = Decimal("0")

        for lid, row in csv_rows.items():
            if lid not in bd_map:
                only_csv.append(row)
                continue
            p = bd_map[lid]
            changes: list[dict] = []
            csv_usd = _dec(row.get("usd"))
            bd_usd = _dec(p.monto)
            if csv_usd != bd_usd:
                delta = csv_usd - bd_usd
                changes.append({"campo": "usd", "bd": float(bd_usd), "csv": float(csv_usd), "delta": float(delta)})
                total_delta += delta
            csv_fecha = (row.get("fecha") or "")[:10]
            bd_fecha = p.fecha.isoformat() if p.fecha else ""
            if csv_fecha and bd_fecha and csv_fecha != bd_fecha:
                changes.append({"campo": "fecha", "bd": bd_fecha, "csv": csv_fecha})
            for field, csv_key, bd_attr in (
                ("concepto", "concepto", "concepto"),
                ("producto", "producto_norm", "producto"),
            ):
                cv = (row.get(csv_key) or "").strip()
                bv = (getattr(p, bd_attr, None) or "").strip()
                if cv and bv and cv != bv:
                    changes.append({"campo": field, "bd": bv, "csv": cv})
            if changes:
                diffs.append(
                    {
                        "legacy_id": lid,
                        "cliente": (row.get("cliente") or "").strip(),
                        "lead_id": p.lead_id,
                        "payment_id": p.id,
                        "changes": changes,
                    }
                )

        for lid in bd_map:
            if lid not in csv_rows:
                only_bd.append(lid)

        return diffs, only_csv, only_bd, total_delta

    diffs, only_csv, only_bd, total_delta = run()

    print("=== PAGOS MODIFICADOS EN ORIGEN ===\n")
    if not diffs:
        print("(ninguno)")
    else:
        print(f"{'legacy_id':36} {'cliente':28} {'campo':8} {'BD':>12} {'CSV':>12} {'delta':>10}")
        print("-" * 110)
        for d in sorted(diffs, key=lambda x: -max(abs(c.get("delta") or 0) for c in x["changes"])):
            for ch in d["changes"]:
                if ch["campo"] == "usd":
                    print(
                        f"{d['legacy_id'][:36]:36} {d['cliente'][:28]:28} "
                        f"{ch['campo']:8} {ch['bd']:12.2f} {ch['csv']:12.2f} {ch['delta']:+.2f}"
                    )
                else:
                    print(
                        f"{d['legacy_id'][:36]:36} {d['cliente'][:28]:28} "
                        f"{ch['campo']:8} {ch['bd']!s:>12} {ch['csv']!s:>12}"
                    )
            print(f"  → lead_id={d['lead_id']} payment_id={d['payment_id']}")

    print(f"\nTOTAL DELTA USD: {float(total_delta):+.2f}")
    print(f"\nSolo CSV (nuevos): {len(only_csv)}  USD={float(sum(_dec(r.get('usd')) for r in only_csv)):.2f}")
    print(f"Solo BD (no en CSV): {len(only_bd)}")

    if only_csv:
        print("\n--- NUEVOS ---")
        for r in only_csv:
            print(f"  {r['id'][:8]}… {r.get('fecha','')} {r.get('cliente','')[:30]} USD {r.get('usd')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
