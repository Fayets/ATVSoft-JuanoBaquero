#!/usr/bin/env python3
"""Detalle candidatos ambiguos + filtro ±7d nombres genéricos."""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from decouple import Config, RepositoryEnv

config = Config(RepositoryEnv(ROOT / "backend" / ".env"))
import psycopg2
from psycopg2.extras import RealDictCursor

from src.services.legacy_juano_import import (  # noqa: E402
    IdentityIndex,
    ensure_db_mapping,
    lead_ids_with_legacy_ref,
    is_pago_huerfano_lead,
    resolve_lead_for_payment,
    rows_leads_for_user,
    rows_payments_for_user,
    merge_meta,
)
from src.models import Lead  # noqa: E402
from pony.orm import db_session  # noqa: E402


def orphan_leads(uid: int, ref_ids: set[int]) -> list[Lead]:
    return [
        lead
        for lead in rows_leads_for_user(uid)
        if is_pago_huerfano_lead(lead, ref_ids)
    ]


def payments_for_lead(lead_id: int, all_payments) -> list:
    return [p for p in all_payments if int(p.lead_id) == int(lead_id)]

GENERIC_CHECK = [
    (6976, 1539, "Catalina Andrea Kroll López", "Catalina"),
    (6970, 6342, "Ryan", "Ryan butler"),
    (6962, 6344, "Santiago Rodriguez", "Santiago"),
]

AMBIGUOUS = [6977, 6964, 6973]

SIN_MATCH = [6980, 6971, 6978, 6975]


def days_diff(a: date | None, b: date | None) -> int | None:
    if a is None or b is None:
        return None
    return abs((a - b).days)


def lead_detail(cur, lead_id: int) -> dict:
    cur.execute(
        """
        SELECT id, nombre, email, telefono, status, agendo, call, source,
               legacy_meta->>'lead_huerfano' AS lead_huerfano,
               (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos,
               (SELECT COALESCE(SUM(p.monto),0) FROM lead_payment p WHERE p.lead_id = l.id) AS usd
        FROM lead l WHERE id = %s
        """,
        (lead_id,),
    )
    row = cur.fetchone()
    return dict(row) if row else {}


def main() -> int:
    ensure_db_mapping()

    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )
    cur = conn.cursor(cursor_factory=RealDictCursor)

    with db_session:
        uid = 1
        ref_ids = lead_ids_with_legacy_ref(uid)
        orphans = {int(o.id) for o in orphan_leads(uid, ref_ids)}
        targets = [l for l in rows_leads_for_user(uid) if int(l.id) not in orphans]
        index = IdentityIndex.build_from_leads(targets)
        all_payments = rows_payments_for_user(uid)

        print("=" * 70)
        print("FILTRO ±7 DÍAS — nombres genéricos (6976, 6970, 6962)")
        print("=" * 70)
        for orphan_id, target_id, orphan_name, target_name in GENERIC_CHECK:
            cur.execute(
                "SELECT id, monto, fecha, concepto FROM lead_payment WHERE lead_id = %s ORDER BY fecha",
                (orphan_id,),
            )
            pays = cur.fetchall()
            tgt = lead_detail(cur, target_id)
            agendo = tgt.get("agendo")
            call = tgt.get("call")
            print(f"\nHuérfano {orphan_id} ({orphan_name}) → {target_id} ({target_name})")
            for p in pays:
                pf = p["fecha"]
                d_ag = days_diff(pf, agendo.date() if agendo else None)
                d_call = days_diff(pf, call.date() if call else None)
                ok_ag = d_ag is not None and d_ag <= 7
                ok_call = d_call is not None and d_call <= 7
                verdict = "✅ PASA ±7d" if (ok_ag or ok_call) else "❌ NO PASA ±7d"
                print(
                    f"  pago id={p['id']} ${p['monto']} {pf} | "
                    f"Δagendo={d_ag}d Δcall={d_call}d → {verdict}"
                )
            print(f"  destino agendo={agendo} call={call} pagos={tgt.get('pagos')} usd={tgt.get('usd')}")

        print("\n" + "=" * 70)
        print("CANDIDATOS AMBIGUOS (6977, 6964, 6973)")
        print("=" * 70)
        for oid in AMBIGUOUS:
            orphan = Lead.get(id=oid)
            if orphan is None:
                continue
            ops = payments_for_lead(oid, all_payments)
            fecha_pago = ops[0].fecha if ops else None
            match = resolve_lead_for_payment(
                index,
                targets,
                tel_norm=orphan.telefono or "",
                email=(orphan.email or "").strip().casefold(),
                nombre=str(orphan.nombre or ""),
                fecha_pago=fecha_pago,
                allow_name_date_match=False,
            )
            cids = list(match.candidate_ids)
            if match.lead is not None and int(match.lead.id) not in cids:
                cids.insert(0, int(match.lead.id))
            print(f"\nHuérfano {oid} {orphan.nombre!r} — método={match.method} note={match.note}")
            for p in ops:
                print(f"  pago: id={p.id} ${p.monto} {p.fecha} {p.concepto}")
            if not cids:
                print("  (sin candidatos)")
                continue
            for cid in cids:
                d = lead_detail(cur, cid)
                ag = d.get("agendo")
                cl = d.get("call")
                d_ag = days_diff(fecha_pago, ag.date() if ag else None) if fecha_pago else None
                d_cl = days_diff(fecha_pago, cl.date() if cl else None) if fecha_pago else None
                print(json.dumps({
                    "lead_id": cid,
                    "nombre": d.get("nombre"),
                    "telefono": d.get("telefono"),
                    "email": d.get("email"),
                    "agendo": str(ag) if ag else None,
                    "call": str(cl) if cl else None,
                    "delta_agendo_d": d_ag,
                    "delta_call_d": d_cl,
                    "pagos": d.get("pagos"),
                    "usd": float(d.get("usd") or 0),
                    "criterio": match.method,
                }, ensure_ascii=False))

        print("\n" + "=" * 70)
        print("SIN MATCH — lead_huerfano flag")
        print("=" * 70)
        for lid in SIN_MATCH:
            lead = Lead.get(id=lid)
            if lead:
                meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
                if not meta.get("lead_huerfano"):
                    lead.legacy_meta = merge_meta(meta, {"lead_huerfano": True})
            d = lead_detail(cur, lid)
            print(json.dumps({
                "lead_id": lid,
                "nombre": d.get("nombre"),
                "lead_huerfano": d.get("lead_huerfano") or True,
                "pagos": d.get("pagos"),
                "usd": float(d.get("usd") or 0),
            }, ensure_ascii=False))

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
