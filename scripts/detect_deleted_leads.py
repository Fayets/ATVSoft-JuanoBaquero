#!/usr/bin/env python3
"""Refs legacy en BD que ya no están en leads.csv (bajas en origen)."""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LeadPayment, LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import map_situacion, normalize_csv_row  # noqa: E402

MARK_DATE = "2026-08-10"


def load_csv_ids(data_dir: Path) -> dict[str, dict[str, str]]:
    path = data_dir / "leads.csv"
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {(r.get("id") or "").strip(): normalize_csv_row(r) for r in csv.DictReader(f)}


@db_session
def run_detect(user_id: int, csv_ids: set[str]) -> list[dict]:
    deleted: list[dict] = []
    for ref in LegacyLeadRef.select():
        if ref.user_id != user_id:
            continue
        lid = (ref.legacy_id or "").strip()
        if not lid or lid in csv_ids:
            continue
        payload = ref.payload if isinstance(ref.payload, dict) else {}
        lead = Lead.get(id=ref.lead_id) if ref.lead_id else None
        pay_cnt = 0
        pay_usd = 0.0
        if lead:
            for p in LeadPayment.select():
                if p.user_id != user_id or int(p.lead_id) != int(lead.id):
                    continue
                pay_cnt += 1
                pay_usd += float(p.monto or 0)
        deleted.append(
            {
                "legacy_id": lid,
                "lead_id": ref.lead_id,
                "rol": ref.rol,
                "nombre": (payload.get("nombre") or (lead.nombre if lead else "") or "").strip(),
                "fecha_llamada": (payload.get("fecha_llamada") or "")[:10],
                "situacion": (payload.get("situacion") or "").strip(),
                "presento": (payload.get("presento") or "").strip(),
                "pagos": pay_cnt,
                "pagos_usd": round(pay_usd, 2),
                "already_marked": bool((lead.legacy_meta or {}).get("eliminado_en_origen")) if lead else False,
            }
        )
    deleted.sort(key=lambda x: x["legacy_id"])
    return deleted


@db_session
def apply_mark(user_id: int, deleted: list[dict], *, dry_run: bool) -> int:
    marked = 0
    for item in deleted:
        if not item.get("lead_id"):
            continue
        lead = Lead.get(id=item["lead_id"], user_id=user_id)
        if lead is None:
            continue
        meta = dict(lead.legacy_meta) if isinstance(lead.legacy_meta, dict) else {}
        if meta.get("eliminado_en_origen"):
            continue
        if dry_run:
            marked += 1
            continue
        meta["eliminado_en_origen"] = MARK_DATE
        meta["eliminado_legacy_id"] = item["legacy_id"]
        lead.legacy_meta = meta
        flush()
        marked += 1
    return marked


def main() -> int:
    parser = argparse.ArgumentParser(description="Detectar leads borrados en CRM origen")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "legacy")
    parser.add_argument("--apply", action="store_true", help="Marcar eliminado_en_origen en Lead")
    parser.add_argument("--yes", action="store_true", help="Confirmar --apply")
    args = parser.parse_args()

    csv_map = load_csv_ids(args.data_dir)
    init_db()
    deleted = run_detect(args.user_id, set(csv_map))

    print("=== LEADS BORRADOS EN ORIGEN (ref en BD, ausente en CSV) ===\n")
    print(f"Total: {len(deleted)}  (esperado: 2)\n")
    if not deleted:
        print("(ninguno)")
    else:
        print(f"{'legacy_id':36} {'nombre':28} {'fecha':10} {'situacion':16} {'pagos':>5} {'USD':>10}")
        print("-" * 115)
        for d in deleted:
            print(
                f"{d['legacy_id'][:36]:36} {d['nombre'][:28]:28} "
                f"{d['fecha_llamada']:10} {d['situacion'][:16]:16} "
                f"{d['pagos']:5d} {d['pagos_usd']:10.2f}"
            )
            print(f"  → lead_id={d['lead_id']} rol={d['rol']} presento={d['presento']!r}")

    with_payments = [d for d in deleted if d["pagos"] > 0]
    if with_payments:
        print(f"\n⚠️  {len(with_payments)} borrado(s) tienen pagos asociados — revisar antes de marcar.")

    if args.apply:
        if with_payments and not args.yes:
            print("\nERROR: hay pagos asociados. Usá --yes para marcar igual.", file=sys.stderr)
            return 1
        if not args.yes:
            print("\nERROR: --apply requiere --yes", file=sys.stderr)
            return 1
        marked = apply_mark(args.user_id, deleted, dry_run=False)
        print(f"\nMarcados eliminado_en_origen={MARK_DATE}: {marked}")
    elif deleted:
        print(f"\nDry-run mark: usar --apply --yes para marcar {len(deleted)} lead(s)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
