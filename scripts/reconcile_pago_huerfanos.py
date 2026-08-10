#!/usr/bin/env python3
"""Reconciliar leads huérfanos de import de pagos (go-reconciliacion-huerfanos.md).

Uso:
  cd backend
  python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --dry-run
  python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes
  python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6968,6982
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from pony.orm import db_session, flush, rollback

from src.models import Lead, LeadPayment, LegacyLeadRef  # noqa: E402
from src.services.legacy_juano_import import (  # noqa: E402
    LEGACY_SOURCE,
    IdentityIndex,
    PaymentLeadMatch,
    ensure_db_mapping,
    extract_email,
    is_pago_huerfano_lead,
    lead_ids_with_legacy_ref,
    map_situacion,
    merge_meta,
    mismo_nombre,
    normalize_producto_norm,
    recalc_lead_financials,
    resolve_lead_for_payment,
    rows_leads_for_user,
    rows_payments_for_user,
    snapshot_lead_if_atv,
    sum_payments_usd,
    tel_digits,
)

PRE_APPROVED: dict[int, int] = {
    6969: 1307,  # Jhoan y Anthuan → Jhoan Galvis
    6972: 1313,  # David Esteban Arevalo Fajardo → David Arevalo
    6977: 1838,  # Edgar René Inamagua alvacora → Edgar René Inamagua (pasada 2)
}

MANUAL_ONLY: frozenset[int] = frozenset({6965})

# Huérfanos que quedan propios al cierre (sin reconciliar)
FINAL_HUERFANO_IDS: frozenset[int] = frozenset({
    6970, 6962, 6964, 6973, 6965, 6980, 6971, 6978, 6975,
})

BACKUP_LEADS: frozenset[int] = frozenset({1307, 1313})


@dataclass
class ReconcilePlan:
    orphan_id: int
    orphan_nombre: str
    target_id: int | None
    target_nombre: str
    tier: str  # auto | review | manual | sin_match
    method: str
    pagos: int = 0
    usd: float = 0.0
    detail: str = ""
    payments_info: list[str] = field(default_factory=list)
    duplicate_warning: bool = False


def orphan_leads(uid: int, ref_ids: set[int]) -> list[Lead]:
    return [
        lead
        for lead in rows_leads_for_user(uid)
        if is_pago_huerfano_lead(lead, ref_ids)
    ]


def target_leads(uid: int, ref_ids: set[int], orphans: set[int]) -> list[Lead]:
    return [
        lead
        for lead in rows_leads_for_user(uid)
        if int(lead.id) not in orphans
    ]


def payments_for_lead(lead_id: int, all_payments: list[LeadPayment]) -> list[LeadPayment]:
    return [p for p in all_payments if int(p.lead_id) == int(lead_id)]


def payment_summary(p: LeadPayment) -> str:
    return (
        f"id={p.id} legacy={p.legacy_id or ''} "
        f"${float(p.monto or 0):.2f} {p.fecha} {p.concepto or ''}"
    )


def has_duplicate_on_target(
    target_id: int,
    orphan_payments: list[LeadPayment],
    all_payments: list[LeadPayment],
) -> tuple[bool, str]:
    existing = payments_for_lead(target_id, all_payments)
    notes: list[str] = []
    for op in orphan_payments:
        for ep in existing:
            if (op.legacy_id or "").strip() and (op.legacy_id or "").strip() == (ep.legacy_id or "").strip():
                notes.append(f"legacy_id duplicado {op.legacy_id}")
            elif op.fecha == ep.fecha and abs(float(op.monto or 0) - float(ep.monto or 0)) < 0.01:
                notes.append(
                    f"fecha/monto igual orphan {payment_summary(op)} vs target {payment_summary(ep)}"
                )
    if notes:
        return True, "; ".join(notes)
    return False, ""


def pick_match_for_orphan(
    orphan: Lead,
    orphan_payments: list[LeadPayment],
    index: IdentityIndex,
    targets: list[Lead],
    all_payments: list[LeadPayment],
    ref_ids: set[int],
    force_targets: dict[int, int] | None = None,
) -> ReconcilePlan:
    oid = int(orphan.id)
    usd = sum(float(p.monto or 0) for p in orphan_payments)
    pay_infos = [payment_summary(p) for p in orphan_payments]

    base = ReconcilePlan(
        orphan_id=oid,
        orphan_nombre=str(orphan.nombre or ""),
        target_id=None,
        target_nombre="",
        tier="sin_match",
        method="none",
        pagos=len(orphan_payments),
        usd=usd,
        payments_info=pay_infos,
    )

    if oid in MANUAL_ONLY:
        base.tier = "manual"
        base.method = "revision_manual"
        base.detail = "dos nombres / monto alto — no auto"
        return base

    force = (force_targets or {}).get(oid)
    if force is None:
        force = PRE_APPROVED.get(oid)
    if force is not None:
        tid = int(force)
        target = Lead.get(id=tid)
        if target is None:
            base.detail = f"force/pre-aprobado lead {tid} no existe"
            return base
        dup, dup_note = has_duplicate_on_target(tid, orphan_payments, all_payments)
        base.target_id = tid
        base.target_nombre = str(target.nombre or "")
        base.tier = "auto"
        base.method = "force" if oid in (force_targets or {}) else "pre_aprobado"
        base.duplicate_warning = dup
        base.detail = dup_note or f"destino fijo {tid}"
        return base

    meta = orphan.legacy_meta if isinstance(orphan.legacy_meta, dict) else {}
    if meta.get("merged_into"):
        base.tier = "sin_match"
        base.method = "ya_merged"
        base.detail = f"merged_into={meta.get('merged_into')}"
        return base

    # Usar datos del huérfano + primer pago para matcheo
    email = (orphan.email or "").strip().casefold()
    tel = orphan.telefono or ""
    fecha_pago: date | None = orphan_payments[0].fecha if orphan_payments else None
    if not email and orphan_payments:
        for p in orphan_payments:
            meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
            email = extract_email(p.nota, meta.get("cliente"))
            if email:
                break

    match: PaymentLeadMatch = resolve_lead_for_payment(
        index,
        targets,
        tel_norm=tel,
        email=email,
        nombre=str(orphan.nombre or ""),
        fecha_pago=fecha_pago,
        allow_name_date_match=False,
    )

    if match.lead is None:
        if match.candidate_ids:
            base.tier = "review"
            base.method = match.method
            base.detail = match.note or f"candidatos={match.candidate_ids}"
        else:
            base.tier = "sin_match"
            base.method = "none"
            base.detail = "marcar lead_huerfano"
        return base

    target = match.lead
    if int(target.id) in ref_ids or (target.source or "") == LEGACY_SOURCE:
        if is_pago_huerfano_lead(target, ref_ids):
            base.tier = "review"
            base.method = match.method
            base.detail = f"destino {target.id} también es huérfano"
            return base

    if match.tier == "review" and not mismo_nombre(orphan.nombre, target.nombre):
        base.tier = "review"
        base.method = match.method
        base.target_id = int(target.id)
        base.target_nombre = str(target.nombre or "")
        base.detail = "tokens incompatibles — no auto"
        return base

    dup, dup_note = has_duplicate_on_target(int(target.id), orphan_payments, all_payments)
    base.target_id = int(target.id)
    base.target_nombre = str(target.nombre or "")
    base.method = match.method
    base.duplicate_warning = dup

    if match.tier == "auto":
        existing_on_target = payments_for_lead(int(target.id), all_payments)
        if dup:
            base.tier = "review"
            base.detail = dup_note
        elif existing_on_target and oid not in PRE_APPROVED:
            base.tier = "review"
            base.detail = f"destino ya tiene {len(existing_on_target)} pago(s) — verificar"
        else:
            base.tier = "auto"
            tel_d = tel_digits(tel)
            base.detail = f"[tel {tel_d[-10:] if tel_d else '-'}]" if match.method.startswith("tel") else match.method
    else:
        base.tier = "review"
        extra = dup_note or match.note
        base.detail = extra or match.method

    return base


def apply_backup_state(lead: Lead, user_id: int) -> None:
    refs = [
        r
        for r in list(LegacyLeadRef.select())
        if int(r.user_id) == user_id and int(r.lead_id) == int(lead.id)
    ]
    payload: dict[str, Any] = {}
    for ref in refs:
        p = ref.payload if isinstance(ref.payload, dict) else {}
        origen = str(p.get("origen") or "")
        if "recuperado backup" in origen.lower() and str(p.get("cierre") or "").strip() == "Sí":
            payload = p
            break
    if not payload:
        return
    snapshot_lead_if_atv(lead)
    status, situacion_orig = map_situacion(payload.get("situacion"))
    lead.status = status
    lead.estado = status
    producto = normalize_producto_norm(payload.get("producto") or "")
    if producto and int(lead.id) != 1307:
        lead.programa_ofrecido = producto
    meta = merge_meta(getattr(lead, "legacy_meta", None), {
        "cierre": (payload.get("cierre") or "").strip(),
        "presento": (payload.get("presento") or "").strip(),
        "situacion_orig": situacion_orig,
        "backup_reconciliado": True,
    })
    lead.legacy_meta = meta


def apply_product_from_payment(lead: Lead, payments: list[LeadPayment]) -> None:
    for p in payments:
        prod = normalize_producto_norm(p.producto)
        if prod and prod not in ("Sin especificar", "Otro", ""):
            lead.programa_ofrecido = prod
            break


def mark_orphan_merged(orphan: Lead, target_id: int) -> None:
    meta = merge_meta(getattr(orphan, "legacy_meta", None), {
        "merged_into": int(target_id),
        "lead_huerfano": True,
    })
    orphan.legacy_meta = meta
    orphan.status = "merged"
    orphan.estado = "merged"


def mark_final_huerfanos(user_id: int) -> int:
    marked = 0
    for lid in FINAL_HUERFANO_IDS:
        lead = Lead.get(id=lid, user_id=user_id)
        if lead is None:
            continue
        meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
        if not meta.get("lead_huerfano"):
            lead.legacy_meta = merge_meta(meta, {"lead_huerfano": True})
            marked += 1
    return marked


def parse_force_map(raw: str) -> dict[int, int]:
    out: dict[int, int] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        a, b = part.split(":", 1)
        out[int(a.strip())] = int(b.strip())
    return out


def run_reconcile(
    user_id: int,
    *,
    dry_run: bool,
    include_review: set[int],
    force_targets: dict[int, int] | None = None,
    finalize: bool = False,
) -> int:
    ensure_db_mapping()
    plans: list[ReconcilePlan] = []

    with db_session:
        usd_before = sum_payments_usd(user_id)
        ref_ids = lead_ids_with_legacy_ref(user_id)
        orphans = orphan_leads(user_id, ref_ids)
        orphan_ids = {int(o.id) for o in orphans}
        targets = target_leads(user_id, ref_ids, orphan_ids)
        index = IdentityIndex.build_from_leads(targets)
        all_payments = rows_payments_for_user(user_id)

        for orphan in sorted(orphans, key=lambda x: -sum(float(p.monto or 0) for p in payments_for_lead(int(x.id), all_payments))):
            ops = payments_for_lead(int(orphan.id), all_payments)
            plans.append(
                pick_match_for_orphan(
                    orphan, ops, index, targets, all_payments, ref_ids, force_targets
                )
            )

        auto = [p for p in plans if p.tier == "auto"]
        review = [p for p in plans if p.tier == "review"]
        manual = [p for p in plans if p.tier == "manual"]
        sin_match = [p for p in plans if p.tier == "sin_match"]

        to_apply = [p for p in auto if payments_for_lead(p.orphan_id, all_payments)]
        for p in review:
            if p.orphan_id in include_review and p.target_id is not None:
                if payments_for_lead(p.orphan_id, all_payments):
                    to_apply.append(p)
        # force explícito (override destino aunque sea ambiguo)
        ft = force_targets or {}
        for orphan_id, target_id in ft.items():
            if orphan_id in {p.orphan_id for p in to_apply}:
                continue
            orphan = Lead.get(id=orphan_id, user_id=user_id)
            if orphan is None:
                continue
            ops = payments_for_lead(orphan_id, all_payments)
            if not ops:
                continue
            target = Lead.get(id=target_id, user_id=user_id)
            if target is None:
                continue
            to_apply.append(
                ReconcilePlan(
                    orphan_id=orphan_id,
                    orphan_nombre=str(orphan.nombre or ""),
                    target_id=target_id,
                    target_nombre=str(target.nombre or ""),
                    tier="auto",
                    method="force",
                    pagos=len(ops),
                    usd=sum(float(p.monto or 0) for p in ops),
                    detail=f"force → {target_id}",
                    payments_info=[payment_summary(p) for p in ops],
                )
            )

        print("RECONCILIACIÓN — DRY RUN" if dry_run else "RECONCILIACIÓN — APPLY")
        print()
        print(f"AUTO (teléfono/email/pre-aprobado) : {len(auto)} casos")
        for p in auto:
            dup = " ⚠️ VERIFICAR DUPLICADO" if p.duplicate_warning else ""
            print(
                f"  {p.orphan_id} {p.orphan_nombre} → {p.target_id} {p.target_nombre}  "
                f"{p.detail}  {p.pagos} pago(s)  ${p.usd:.2f}{dup}"
            )
            for info in p.payments_info:
                print(f"    · {info}")
            if p.target_id:
                existing = payments_for_lead(p.target_id, all_payments)
                if existing:
                    print(f"    destino ya tiene {len(existing)} pago(s):")
                    for ep in existing:
                        print(f"      · {payment_summary(ep)}")

        print()
        print(f"REVISIÓN (nombre+fecha/tokens/duplicado) : {len(review)} casos")
        for p in review:
            dest = f"→ {p.target_id} {p.target_nombre}" if p.target_id else "→ (sin destino único)"
            print(
                f"  {p.orphan_id} {p.orphan_nombre} {dest}  "
                f"[{p.method}] {p.detail}  {p.pagos} pago(s)  ${p.usd:.2f}"
            )
            for info in p.payments_info:
                print(f"    · {info}")
            if p.target_id and p.duplicate_warning:
                existing = payments_for_lead(p.target_id, all_payments)
                print("    pagos actuales en destino:")
                for ep in existing:
                    print(f"      · {payment_summary(ep)}")

        if manual:
            print()
            print(f"REVISIÓN MANUAL (bloqueados) : {len(manual)} casos")
            for p in manual:
                print(
                    f"  {p.orphan_id} {p.orphan_nombre}  {p.detail}  "
                    f"{p.pagos} pago(s)  ${p.usd:.2f}"
                )

        print()
        print(f"SIN MATCH (quedan como lead) : {len(sin_match)} casos")
        for p in sin_match:
            print(
                f"  {p.orphan_id} {p.orphan_nombre}  {p.detail}  "
                f"{p.pagos} pago(s)  ${p.usd:.2f}"
            )

        pagos_movidos = sum(p.pagos for p in to_apply)
        huerfanos_vaciados = len(to_apply)

        if dry_run:
            print()
            print("CONTROL")
            print(f"  USD antes  : {usd_before}")
            print(f"  USD después: {usd_before}   ← debe ser idéntico")
            print(f"  Pagos movidos (si --yes AUTO): {pagos_movidos}")
            print(f"  Huérfanos vaciados: {huerfanos_vaciados}")
            if include_review:
                print(f"  + incluye review ids: {sorted(include_review)}")
            return 0

        if not to_apply:
            print("\nNada que aplicar.")
            return 0

        for plan in to_apply:
            if plan.target_id is None:
                continue
            orphan = Lead.get(id=plan.orphan_id, user_id=user_id)
            target = Lead.get(id=plan.target_id, user_id=user_id)
            if orphan is None or target is None:
                print(f"ERROR: orphan={plan.orphan_id} target={plan.target_id} no encontrado", file=sys.stderr)
                return 1
            for p in payments_for_lead(plan.orphan_id, all_payments):
                p.lead_id = int(target.id)
            mark_orphan_merged(orphan, int(target.id))
            if int(target.id) in BACKUP_LEADS:
                apply_backup_state(target, user_id)
                moved = payments_for_lead(int(target.id), all_payments)
                apply_product_from_payment(target, moved)
            flush()

        all_payments = rows_payments_for_user(user_id)
        touched_targets = {p.target_id for p in to_apply if p.target_id}
        for tid in touched_targets:
            lead = Lead.get(id=tid)
            if lead:
                recalc_lead_financials(user_id, lead, all_payments)

        usd_after = sum_payments_usd(user_id)
        flush()

        print()
        print("CONTROL")
        print(f"  USD antes  : {usd_before}")
        print(f"  USD después: {usd_after}")
        print(f"  Pagos movidos: {pagos_movidos}")
        print(f"  Huérfanos vaciados: {huerfanos_vaciados}")

        if abs(usd_after - usd_before) > 0.001:
            print("ERROR: suma USD cambió — abortando rollback", file=sys.stderr)
            rollback()
            return 1

        if finalize:
            n = mark_final_huerfanos(user_id)
            flush()
            print(f"  lead_huerfano marcados (cierre): {n}")

        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconciliar huérfanos de pagos legacy")
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument(
        "--include-review",
        default="",
        help="IDs huérfano separados por coma para aplicar tier review",
    )
    parser.add_argument(
        "--force",
        default="",
        help="Pares orphan_id:target_id separados por coma (ej. 6977:1838)",
    )
    parser.add_argument(
        "--finalize",
        action="store_true",
        help="Marcar lead_huerfano en los 9 restantes al cierre",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.yes:
        print("ERROR: usá --dry-run o --yes", file=sys.stderr)
        return 1

    include: set[int] = set()
    if args.include_review.strip():
        include = {int(x.strip()) for x in args.include_review.split(",") if x.strip()}
    force_map = parse_force_map(args.force)

    try:
        return run_reconcile(
            args.user_id,
            dry_run=args.dry_run,
            include_review=include,
            force_targets=force_map,
            finalize=args.finalize,
        )
    except Exception as e:
        rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
