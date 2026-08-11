#!/usr/bin/env python3
"""Backfill lead.link_llamada desde links_fathom.csv (legacy Supabase)."""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pony.orm import db_session, flush  # noqa: E402

from src.db import init_db  # noqa: E402
from src.models import Lead, LegacyLeadRef  # noqa: E402

ORIGIN = "backfill_links_fathom"
URL_RE = re.compile(r"https?://[^\s\"']+", re.IGNORECASE)


def extract_urls(raw: str) -> list[str]:
    text = (raw or "").replace("\r", "\n")
    found: list[str] = []
    for line in text.split("\n"):
        s = line.strip()
        if s.lower().startswith(("http://", "https://")):
            found.append(s)
    if not found:
        for m in URL_RE.finditer(text):
            found.append(m.group(0).strip())
    seen: set[str] = set()
    out: list[str] = []
    for u in found:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def norm_link(val: str) -> str:
    return (val or "").strip()


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
    csv_rows: int = 0
    urls_valid: int = 0
    text_discarded: list[tuple[str, str]] = field(default_factory=list)
    multi_url_rows: list[tuple[str, list[str]]] = field(default_factory=list)
    secondary_stored: list[tuple[int, str, str]] = field(default_factory=list)  # lead_id, legacy_id, url
    no_match: list[tuple[str, str]] = field(default_factory=list)
    written_leads: list[tuple[int, str, str]] = field(default_factory=list)  # lead_id, legacy_id, url
    same_link_leads: list[tuple[int, str, str]] = field(default_factory=list)
    shared_lead_legacy: list[tuple[str, int, str]] = field(default_factory=list)  # legacy_id, lead_id, winner_lid
    conflict_existing: list[tuple[int, str, str, str]] = field(default_factory=list)
    absorbed_stored: list[tuple[int, str, str]] = field(default_factory=list)
    duplicate_urls: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    applied: int = 0


def load_csv(path: Path) -> tuple[dict[str, str], dict[str, str], Stats]:
    """legacy_id -> URL primaria; legacy_id -> URL secundaria (celda con 2+ URLs)."""
    stats = Stats()
    primary: dict[str, str] = {}
    secondary: dict[str, str] = {}
    url_to_legacy: dict[str, list[str]] = defaultdict(list)

    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            stats.csv_rows += 1
            legacy_id = (row.get("legacy_id") or "").strip()
            raw = row.get("link_llamada") or ""
            urls = extract_urls(raw)
            if not urls:
                stats.text_discarded.append((legacy_id, raw.strip()[:80]))
                continue
            stats.urls_valid += 1
            if len(urls) > 1:
                stats.multi_url_rows.append((legacy_id, urls))
                secondary[legacy_id] = urls[1]
            primary[legacy_id] = urls[0]
            url_to_legacy[urls[0]].append(legacy_id)

    for url, lids in url_to_legacy.items():
        if len(lids) > 1:
            stats.duplicate_urls[url] = lids

    return primary, secondary, stats


def pick_winner_ref(refs: list[LegacyLeadRef], csv_legacy_ids: set[str]) -> LegacyLeadRef:
    candidates = [r for r in refs if (r.legacy_id or "").strip() in csv_legacy_ids]
    if not candidates:
        candidates = refs
    by_role: dict[str, list[LegacyLeadRef]] = defaultdict(list)
    for r in candidates:
        by_role[(r.rol or "").strip()].append(r)
    for rol in ("merge_winner", "new"):
        if by_role.get(rol):
            return by_role[rol][0]
    return candidates[0]


def apply_secondary(
    lead: Lead,
    meta: dict,
    legacy_id: str,
    secondary_urls: dict[str, str],
    stats: Stats,
    *,
    dry_run: bool,
) -> dict:
    sec = secondary_urls.get(legacy_id)
    if not sec:
        return meta
    before = meta.get("link_llamada_secundario")
    stats.secondary_stored.append((int(lead.id), legacy_id, sec))
    if dry_run:
        return meta
    meta = dict(meta)
    meta["link_llamada_secundario"] = sec
    append_audit(meta, "link_llamada_secundario", before, sec)
    lead.legacy_meta = meta
    return meta


@db_session
def run_backfill(
    user_id: int,
    csv_urls: dict[str, str],
    secondary_urls: dict[str, str],
    stats: Stats,
    *,
    dry_run: bool,
) -> Stats:
    refs_by_legacy: dict[str, LegacyLeadRef] = {}
    refs_by_lead: dict[int, list[LegacyLeadRef]] = defaultdict(list)

    for ref in LegacyLeadRef.select():
        if int(ref.user_id) != user_id:
            continue
        lid = (ref.legacy_id or "").strip()
        refs_by_legacy[lid] = ref
        if ref.lead_id:
            refs_by_lead[int(ref.lead_id)].append(ref)

    for legacy_id, csv_url in csv_urls.items():
        ref = refs_by_legacy.get(legacy_id)
        if ref is None or not ref.lead_id:
            stats.no_match.append((legacy_id, csv_url))

    leads_before = sum(
        1
        for lead in Lead.select()
        if int(lead.user_id) == user_id and norm_link(lead.link_llamada or "")
    )

    for lead_id, refs in refs_by_lead.items():
        group_ids = {(r.legacy_id or "").strip() for r in refs} & set(csv_urls)
        if not group_ids:
            continue

        lead = Lead.get(id=lead_id, user_id=user_id)
        if lead is None:
            continue

        winner = pick_winner_ref(refs, group_ids)
        winner_lid = (winner.legacy_id or "").strip()
        winner_url = csv_urls[winner_lid]
        current = norm_link(lead.link_llamada or "")
        meta = dict(lead.legacy_meta) if isinstance(lead.legacy_meta, dict) else {}

        for lid in group_ids:
            if lid != winner_lid:
                stats.shared_lead_legacy.append((lid, lead_id, winner_lid))

        if not current:
            stats.written_leads.append((lead_id, winner_lid, winner_url))
            if not dry_run:
                meta = dict(meta)
                append_audit(meta, "link_llamada", None, winner_url)
                lead.link_llamada = winner_url
                lead.legacy_meta = meta
                stats.applied += 1
                meta = dict(lead.legacy_meta) if isinstance(lead.legacy_meta, dict) else meta
        elif current == winner_url:
            stats.same_link_leads.append((lead_id, winner_lid, winner_url))
        else:
            stats.conflict_existing.append((lead_id, winner_lid, current, winner_url))
            if not dry_run:
                meta = dict(meta)
                legacy_map = dict(meta.get("link_llamada_legacy") or {})
                legacy_map[winner_lid] = winner_url
                meta["link_llamada_legacy"] = legacy_map
                append_audit(meta, "link_llamada_legacy", current, winner_url)
                lead.legacy_meta = meta
                meta = dict(lead.legacy_meta)

        meta = apply_secondary(lead, meta, winner_lid, secondary_urls, stats, dry_run=dry_run)

        absorbed_extras: list[tuple[str, str]] = []
        for r in refs:
            lid = (r.legacy_id or "").strip()
            if lid == winner_lid or lid not in csv_urls:
                continue
            u = csv_urls[lid]
            if u != winner_url:
                absorbed_extras.append((lid, u))

        if absorbed_extras:
            if not dry_run:
                meta = dict(lead.legacy_meta) if isinstance(lead.legacy_meta, dict) else {}
            absorbed_map = dict(meta.get("link_llamada_absorbido") or {})
            for abs_lid, abs_url in absorbed_extras:
                stats.absorbed_stored.append((lead_id, abs_lid, abs_url))
                absorbed_map[abs_lid] = abs_url
                meta = apply_secondary(lead, meta, abs_lid, secondary_urls, stats, dry_run=dry_run)
            if not dry_run and absorbed_extras:
                meta = dict(meta)
                meta["link_llamada_absorbido"] = absorbed_map
                lead.legacy_meta = meta

    if not dry_run:
        flush()

    stats.leads_with_link_before = leads_before  # type: ignore[attr-defined]
    if dry_run:
        stats.leads_with_link_after = leads_before + len(stats.written_leads)  # type: ignore[attr-defined]
    else:
        stats.leads_with_link_after = sum(  # type: ignore[attr-defined]
            1
            for lead in Lead.select()
            if int(lead.user_id) == user_id and norm_link(lead.link_llamada or "")
        )
    return stats


def print_report(stats: Stats, *, dry_run: bool) -> None:
    title = "BACKFILL LINKS FATHOM — DRY RUN" if dry_run else "BACKFILL LINKS FATHOM — APLICADO"
    print(title)
    print()
    print(f"CSV                             : {stats.csv_rows} filas")
    print(f"  ├─ URLs válidas               : {stats.urls_valid}")
    print(f"  └─ texto libre descartado     : {len(stats.text_discarded):>3}")
    print()
    print("URLs válidas — desglose por legacy_id:")
    print(f"  ├─ escritas (campo vacío)     : {len(stats.written_leads):>3}   (leads distintos)")
    print(f"  ├─ mismo link ya presente     : {len(stats.same_link_leads):>3}   (leads distintos)")
    print(f"  ├─ link distinto (no se pisa) : {len(stats.conflict_existing):>3}")
    print(f"  ├─ comparte lead (merge CSV)  : {len(stats.shared_lead_legacy):>3}   (legacy_id sin acción propia)")
    print(f"  └─ sin match legacy_lead_ref  : {len(stats.no_match):>3}")
    print()
    print(f"Secundarias guardadas (2 URLs)  : {len(stats.secondary_stored)}")
    print(f"URLs duplicadas entre leads     : {len(stats.duplicate_urls)}")
    print(f"Absorbidas con link distinto    : {len(stats.absorbed_stored)}")
    if not dry_run:
        print(f"Escrituras aplicadas            : {stats.applied}")
    print()
    before = getattr(stats, "leads_with_link_before", "?")
    after = getattr(stats, "leads_with_link_after", "?")
    print("Leads con link_llamada:" if not dry_run else "Estado final proyectado:")
    print(f"  {before} → {after}")
    print()

    if stats.conflict_existing:
        print("--- Conflicto (no sobrescrito) ---")
        for lead_id, legacy_id, bd, csv_u in stats.conflict_existing:
            print(f"  lead {lead_id} legacy {legacy_id[:8]}…  BD={bd[:55]!r}")
            print(f"    CSV={csv_u[:55]!r}")
        print()

    if stats.shared_lead_legacy:
        print("--- Comparte lead con otro legacy_id (muestra) ---")
        for lid, lead_id, winner in stats.shared_lead_legacy[:10]:
            print(f"  {lid[:8]}… → lead {lead_id} (ganador {winner[:8]}…)")
        if len(stats.shared_lead_legacy) > 10:
            print(f"  ... +{len(stats.shared_lead_legacy) - 10} más")
        print()

    if stats.secondary_stored:
        print("--- URL secundaria en legacy_meta ---")
        for lead_id, lid, url in stats.secondary_stored:
            print(f"  lead {lead_id} legacy {lid[:8]}…  {url[:60]}")
        print()

    if stats.duplicate_urls:
        print("--- URLs duplicadas (call_report UNIQUE) ---")
        for url, lids in stats.duplicate_urls.items():
            print(f"  {url[:58]}… → {', '.join(x[:8] for x in lids)}")
        print()

    if stats.no_match:
        print("--- Sin match legacy_lead_ref ---")
        for lid, url in stats.no_match:
            print(f"  {lid}  {url[:60]}")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill link_llamada desde links_fathom.csv")
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument(
        "--csv",
        type=Path,
        default=ROOT / "data" / "legacy" / "links_fathom.csv",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    if not args.csv.is_file():
        print(f"ERROR: falta {args.csv}", file=sys.stderr)
        return 1

    init_db()
    csv_urls, secondary_urls, stats = load_csv(args.csv)
    dry_run = args.dry_run or not args.yes
    if not dry_run:
        print("IMPORT REAL — escribiendo link_llamada en Neon")

    stats = run_backfill(args.user_id, csv_urls, secondary_urls, stats, dry_run=dry_run)
    print_report(stats, dry_run=dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
