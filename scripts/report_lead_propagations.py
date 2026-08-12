#!/usr/bin/env python3
"""Desglose de propagaciones leads (dry-run) con ejemplos BD → CSV."""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

import src.services.legacy_juano_import as limp  # noqa: E402
from src.services.legacy_juano_import import LegacyJuanoImporter  # noqa: E402

ALLOWED = {
    "presento",
    "cierre",
    "fecha_llamada",
    "calificado",
    "programa_ofrecido",
    "setter",
    "situacion_orig",
    "link_llamada",
}

examples: dict[str, list[tuple[str, str, int | None]]] = defaultdict(list)
violations: list[str] = []
_orig_record = limp._record_lead_field_update


def _patched_record(stats, lead, campo, antes, despues, *, dry_run):
    _orig_record(stats, lead, campo, antes, despues, dry_run=dry_run)
    if len(examples[campo]) < 5:
        lid = getattr(lead, "id", None)
        examples[campo].append((str(antes or ""), str(despues or ""), lid))
    if campo not in ALLOWED:
        violations.append(f"campo no permitido: {campo} (lead_id={getattr(lead, 'id', '?')})")
    if campo == "situacion_orig" and not limp.is_initial_lead_status(lead):
        st = (lead.status or lead.estado or "").strip()
        violations.append(
            f"situacion sobre estado terminal: lead_id={lead.id} status={st!r} "
            f"({antes!r} → {despues!r})"
        )
    if campo == "programa_ofrecido" and str(antes or "").strip():
        violations.append(
            f"programa_ofrecido sobrescribe valor existente: lead_id={lead.id} "
            f"({antes!r} → {despues!r})"
        )
    if campo == "setter" and str(antes or "").strip():
        violations.append(
            f"setter sobrescribe valor existente: lead_id={lead.id} ({antes!r} → {despues!r})"
        )
    if not str(despues or "").strip() and str(antes or "").strip():
        violations.append(
            f"vacío CSV sobrescribe ATV: {campo} lead_id={lead.id} ({antes!r} → {despues!r})"
        )


def main() -> int:
    uid = 1
    data_dir = ROOT / "data" / "legacy"
    limp._record_lead_field_update = _patched_record
    try:
        importer = LegacyJuanoImporter(uid, data_dir, dry_run=True)
        stats = importer.run(only="leads")
    finally:
        limp._record_lead_field_update = _orig_record

    total = sum(stats.lead_updates_by_field.values())
    out_path = data_dir / "lead_propagations_report.txt"
    lines = [
        f"LEADS — CAMPOS PROPAGADOS ({total} total, {stats.leads_propagated} leads afectados)",
        "",
    ]
    label_map = {
        "presento": "presento",
        "cierre": "cierre",
        "fecha_llamada": "fecha_llamada",
        "calificado": "calificado",
        "programa_ofrecido": "producto → programa_ofrecido",
        "setter": "setter",
        "situacion_orig": "situacion → situacion_orig",
        "link_llamada": "link_llamada",
    }
    for campo in sorted(stats.lead_updates_by_field, key=lambda k: -stats.lead_updates_by_field[k]):
        cnt = stats.lead_updates_by_field[campo]
        label = label_map.get(campo, campo)
        ex = examples.get(campo, [])
        ex_str = " | ".join(f'"{a}" → "{d}" (lead {lid})' for a, d, lid in ex[:3])
        if not ex_str:
            ex_str = "(sin ejemplos capturados)"
        lines.append(f"{label:<35} {cnt:>4}     {ex_str}")

    lines.extend(["", "—" * 60, ""])
    propagated = stats.lead_updates_by_field.get("link_llamada", 0)
    skipped = stats.link_llamada_skipped_non_url
    lines.append(f"link_llamada: {propagated} URLs propagadas | {skipped} descartadas (texto libre)")
    if stats.link_llamada_skipped_non_url_items:
        lines.append("")
        lines.append("Descartados (no URL):")
        for item in stats.link_llamada_skipped_non_url_items:
            lid = item.get("lead_id")
            lines.append(f"  lead {lid}: {item.get('valor')!r}")

    lines.extend(["", "—" * 60, ""])
    if violations:
        lines.append(f"⚠ VIOLACIONES ({len(violations)}):")
        for v in violations:
            lines.append(f"  - {v}")
    else:
        lines.append("✅ Sin violaciones de lista blanca.")

    text = "\n".join(lines)
    out_path.write_text(text, encoding="utf-8")
    print(text)
    print(f"\nGuardado: {out_path}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
