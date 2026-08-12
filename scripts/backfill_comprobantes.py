#!/usr/bin/env python3
"""Backfill lead_payment.comprobante_url desde pagos.csv / comprobante.csv."""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import LeadPayment  # noqa: E402
from src.services.legacy_juano_import import LEGACY_SOURCE, merge_meta  # noqa: E402

_URL_RE = re.compile(r"https?://[^\s,|]+", re.I)


def parse_comprobante_url(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s or s.lower() in ("null", "none", "-"):
        return ""
    m = _URL_RE.search(s)
    if not m:
        return ""
    return m.group(0).rstrip(".,)")


def _load_csv_urls(data_dir: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    pagos_path = data_dir / "pagos.csv"
    if pagos_path.is_file():
        with pagos_path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                lid = (row.get("id") or "").strip()
                url = parse_comprobante_url(row.get("comprobante"))
                if lid and url:
                    out.setdefault(lid, url)
    backup = data_dir / "comprobante.csv"
    if backup.is_file():
        with backup.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                lid = (row.get("legacy_id") or row.get("id") or "").strip()
                url = parse_comprobante_url(row.get("comprobante"))
                if lid and url and lid not in out:
                    out[lid] = url
    return out


def _append_audit(meta: dict, antes: str, despues: str) -> dict:
    base = merge_meta(meta, {})
    actualizaciones = base.get("actualizaciones")
    if not isinstance(actualizaciones, list):
        actualizaciones = []
    actualizaciones.append(
        {
            "fecha": date.today().isoformat(),
            "campo": "comprobante_url",
            "antes": antes,
            "despues": despues,
            "origen": "backfill_comprobantes",
        }
    )
    base["actualizaciones"] = actualizaciones
    return base


@db_session
def run(user_id: int, csv_urls: dict[str, str], *, dry_run: bool) -> dict:
    url_to_ids: dict[str, list[int]] = defaultdict(list)
    stats = {
        "csv_con_url": len(csv_urls),
        "escritos": 0,
        "sin_cambio": 0,
        "ya_tienen": 0,
        "conflictos": 0,
        "sin_pago": 0,
    }
    conflictos: list[dict] = []
    detalle: list[dict] = []

    payments_by_legacy: dict[str, LeadPayment] = {}
    for p in list(LeadPayment.select()):
        if int(p.user_id) != user_id or (p.source or "") != LEGACY_SOURCE:
            continue
        lid = (p.legacy_id or "").strip()
        if lid:
            payments_by_legacy[lid] = p

    for legacy_id, url in csv_urls.items():
        payment = payments_by_legacy.get(legacy_id)
        if payment is None:
            stats["sin_pago"] += 1
            continue
        current = (payment.comprobante_url or "").strip()
        if current == url:
            stats["sin_cambio"] += 1
            continue
        if current and current != url:
            stats["conflictos"] += 1
            conflictos.append(
                {
                    "legacy_id": legacy_id,
                    "pago_id": int(payment.id),
                    "actual": current,
                    "csv": url,
                }
            )
            continue
        if current:
            stats["ya_tienen"] += 1
            continue

        stats["escritos"] += 1
        url_to_ids[url].append(int(payment.id))
        detalle.append({"legacy_id": legacy_id, "pago_id": int(payment.id), "url": url})
        if not dry_run:
            meta = _append_audit(
                payment.legacy_meta if isinstance(payment.legacy_meta, dict) else {},
                current,
                url,
            )
            payment.comprobante_url = url
            payment.legacy_meta = meta

    if not dry_run and stats["escritos"]:
        flush()

    dup_urls = {u: ids for u, ids in url_to_ids.items() if len(ids) > 1}
    stats["urls_duplicadas"] = len(dup_urls)
    return {
        **stats,
        "detalle": detalle[:20],
        "conflictos": conflictos,
        "urls_duplicadas_detalle": {u: ids for u, ids in list(dup_urls.items())[:10]},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "legacy")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.yes:
        print("Usá --dry-run o --yes")
        return 1

    init_db()
    csv_urls = _load_csv_urls(args.data_dir)
    print(f"CSV con URL: {len(csv_urls)}")
    result = run(args.user_id, csv_urls, dry_run=args.dry_run or not args.yes)
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
