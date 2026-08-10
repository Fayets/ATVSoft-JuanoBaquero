#!/usr/bin/env python3
"""Revertir absorción incorrecta en colisión legacy (caso 1855).

Uso:
  cd backend
  python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --dry-run
  python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --yes
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from decouple import Config, RepositoryEnv  # noqa: E402
from pony.orm import db_session, flush, rollback

config = Config(RepositoryEnv(BACKEND / ".env"))

from src.db import db  # noqa: E402
from src.models import Lead, LeadPayment, LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import (  # noqa: E402
    LEGACY_SOURCE,
    ensure_db_mapping,
    map_fuente,
    map_situacion,
    merge_lead_from_csv,
    normalize_closer,
    normalize_producto_norm,
    parse_date,
    parse_dt,
    resolve_agendo,
    validate_phone,
)


def _norm_key(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", str(text).strip())
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def payload_row(payload: dict[str, Any]) -> dict[str, str]:
    return {k: ("" if v is None else str(v)) for k, v in payload.items()}


def build_lead_from_payload(user_id: int, row: dict[str, str], *, legacy_id: str) -> Lead:
    nombre = unicodedata.normalize("NFKC", (row.get("nombre") or "").strip())
    email = (row.get("correo") or "").strip().casefold()
    telefono, _ = validate_phone(row.get("tel_norm") or row.get("telefono"))
    status, situacion_orig = map_situacion(row.get("situacion"))
    keyword, fuente_raw = map_fuente(row.get("fuente"))
    producto = normalize_producto_norm(row.get("producto") or "")
    created_at = parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None)
    fecha_bot = parse_dt(row.get("fecha")) or created_at
    agendo, agendo_inferido = resolve_agendo(row)
    meta: dict[str, Any] = {
        "cierre": (row.get("cierre") or "").strip(),
        "presento": (row.get("presento") or "").strip(),
        "calificado": (row.get("calificado") or "").strip(),
        "ghl_contact_id": (row.get("ghl_contact_id") or "").strip(),
        "situacion_orig": situacion_orig,
        "fuente_orig": fuente_raw,
        "colision_revertida_apellido_distinto": True,
    }
    if agendo_inferido:
        meta["agendo_inferido"] = agendo_inferido
    closer_raw = (row.get("closer") or "").strip()
    kwargs: dict[str, Any] = {
        "user_id": user_id,
        "source": LEGACY_SOURCE,
        "legacy_id": legacy_id,
        "nombre": nombre,
        "email": email,
        "telefono": telefono,
        "setter": (row.get("setter") or "").strip(),
        "closer": closer_raw,
        "closer_norm": normalize_closer(closer_raw),
        "status": status,
        "estado": status,
        "origen": (row.get("origen") or "").strip(),
        "keyword": keyword,
        "programa_ofrecido": producto,
        "agendo": agendo,
        "call": parse_dt(row.get("fecha_llamada")),
        "fecha_bot": fecha_bot,
        "created_at": created_at,
        "legacy_meta": meta,
    }
    ghl = (row.get("ghl_contact_id") or "").strip()
    if ghl:
        kwargs["ghl_contact_id"] = ghl
    return Lead(**kwargs)


def find_payments_to_reassign(lead_id: int, nombre_csv: str) -> list[LeadPayment]:
    nk = _norm_key(nombre_csv)
    out: list[LeadPayment] = []
    for p in list(LeadPayment.select()):
        if int(p.lead_id) != int(lead_id):
            continue
        nota = str(p.nota or "")
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        cliente = _norm_key(meta.get("cliente") or meta.get("closer_raw") or "")
        if nk and nk in _norm_key(nota):
            out.append(p)
            continue
        # pagos.csv cliente en nota o match por legacy import
        if _norm_key(nombre_csv.split()[0]) in _norm_key(nota):
            out.append(p)
    return out


def revert_lead_collision(user_id: int, lead_id: int, dry_run: bool) -> int:
    ensure_db_mapping()
    lines: list[str] = [f"=== REVERT COLISIÓN lead_id={lead_id} user_id={user_id} ==="]
    mode = "DRY-RUN" if dry_run else "APPLY"
    lines.append(f"Modo: {mode}")

    with db_session:
        lead = Lead.get(id=lead_id, user_id=user_id)
        if lead is None:
            print(f"ERROR: lead_id={lead_id} no existe para user_id={user_id}", file=sys.stderr)
            return 1

        refs = [
            r
            for r in list(LegacyLeadRef.select())
            if int(r.user_id) == user_id and int(r.lead_id) == lead_id
        ]
        winner_ref = next((r for r in refs if r.rol == "merge_winner"), None)
        absorbed_ref = next((r for r in refs if r.rol == "merge_absorbed"), None)
        if winner_ref is None or absorbed_ref is None:
            print("ERROR: se necesitan merge_winner y merge_absorbed en legacy_lead_ref", file=sys.stderr)
            return 1

        w_payload = winner_ref.payload if isinstance(winner_ref.payload, dict) else {}
        a_payload = absorbed_ref.payload if isinstance(absorbed_ref.payload, dict) else {}
        w_name = str(w_payload.get("nombre") or winner_ref.payload)
        a_name = str(a_payload.get("nombre") or "")

        lines.extend([
            f"Lead ATV actual: id={lead.id} nombre={lead.nombre!r}",
            f"  merge_winner ref: {winner_ref.legacy_id[:8]}… nombre={w_name!r}",
            f"  merge_absorbed ref: {absorbed_ref.legacy_id[:8]}… nombre={a_name!r}",
            "",
            "Plan:",
            f"  1. {a_name!r} → merge_winner en lead {lead_id} (coincide con ATV)",
            f"  2. {w_name!r} → lead NUEVO + legacy_lead_ref rol=new",
            f"  3. Reasignar pagos de {w_name!r} colgando del lead {lead_id}",
        ])

        payments = [
            p
            for p in list(LeadPayment.select())
            if int(p.lead_id) == int(lead_id) and (p.source or "") == LEGACY_SOURCE
        ]
        reassign: list[LeadPayment] = []
        w_key = _norm_key(w_name)
        for p in payments:
            # Match por pagos.csv: legacy row cliente
            meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
            pay_name = _norm_key(str(meta.get("cliente") or ""))
            if not pay_name:
                # buscar en pagos legacy por legacy_id
                pass
            if w_key and (pay_name == w_key or w_key in pay_name or pay_name in w_key):
                reassign.append(p)
            elif w_name.lower().split()[0] in str(p.nota or "").lower():
                reassign.append(p)

        # Fallback: pagos con legacy_id cuyo cliente en CSV es w_name
        if not reassign and payments:
            import csv

            pay_path = ROOT / "data" / "legacy" / "pagos.csv"
            if pay_path.is_file():
                with pay_path.open(encoding="utf-8-sig", newline="") as f:
                    by_legacy = {row["id"]: row.get("cliente", "") for row in csv.DictReader(f)}
                for p in payments:
                    lid = (p.legacy_id or "").strip()
                    if lid and _norm_key(by_legacy.get(lid, "")) == w_key:
                        reassign.append(p)

        lines.append("")
        lines.append(f"Pagos en lead {lead_id}: {len(payments)}")
        for p in reassign:
            lines.append(
                f"  → reasignar pago id={p.id} monto={p.monto} fecha={p.fecha} "
                f"concepto={p.concepto!r} legacy_id={p.legacy_id}"
            )
        if not reassign:
            lines.append("  (ninguno identificado automáticamente — revisar manual)")

        if dry_run:
            print("\n".join(lines))
            return 0

        # --- APPLY ---
        row_absorbed = payload_row(a_payload)
        row_winner = payload_row(w_payload)

        # Nuevo lead para ex-ganadora (Arango)
        new_lead = build_lead_from_payload(user_id, row_winner, legacy_id=winner_ref.legacy_id)
        flush()

        absorbed_ref.rol = "merge_winner"
        absorbed_ref.motivo = "colision_revertida_apellido_distinto"
        winner_ref.rol = "new"
        winner_ref.lead_id = int(new_lead.id)
        winner_ref.motivo = "colision_revertida_apellido_distinto"

        # Refrescar merge en lead ATV con payload Calderon
        from src.services.legacy_juano_import import LeadMatchResult

        fake_match = LeadMatchResult(lead, "colision_revertida", 1.0)
        meta_patch = {
            "colision_revertida_apellido_distinto": True,
            "match_method": "colision_revertida",
        }
        merge_lead_from_csv(lead, row_absorbed, meta_patch, fake_match)
        if not (lead.legacy_id or "").strip():
            lead.legacy_id = absorbed_ref.legacy_id

        for p in reassign:
            p.lead_id = int(new_lead.id)

        flush()
        lines.append("")
        lines.append(f"APLICADO: nuevo lead id={new_lead.id} nombre={new_lead.nombre!r}")
        lines.append(f"Lead {lead_id} actualizado; {len(reassign)} pago(s) reasignados.")
        print("\n".join(lines))
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Revertir absorción incorrecta en colisión")
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--lead-id", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not args.yes:
        print("ERROR: usá --dry-run o --yes para aplicar.", file=sys.stderr)
        return 1

    try:
        return revert_lead_collision(args.user_id, args.lead_id, dry_run=args.dry_run)
    except Exception as e:
        rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
