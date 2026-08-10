#!/usr/bin/env python3
"""Auditoría post-import: pares ganadora/absorbida en colisiones legacy_lead_ref."""
from __future__ import annotations

import argparse
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from decouple import Config, RepositoryEnv  # noqa: E402

config = Config(RepositoryEnv(BACKEND / ".env"))


def norm_name(s: str | None) -> str:
    if not s:
        return ""
    t = unicodedata.normalize("NFKC", str(s).strip())
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def name_similarity(a: str | None, b: str | None) -> float:
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def classify(sim: float, mismo_tel: bool, mismo_mail: bool) -> str:
    flags = []
    if not mismo_mail and mismo_tel:
        flags.append("tel_compartido")
    if sim > 0.75:
        base = "OK_misma_persona"
    elif sim >= 0.45:
        base = "DUDOSO"
    else:
        base = "REVISAR_personas_distintas"
    if flags:
        return f"{base} ({','.join(flags)})"
    return base


def fetch_pairs(user_id: int) -> list[dict]:
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  w.lead_id,
                  l.nombre AS nombre_atv,
                  w.payload->>'nombre' AS ganadora,
                  a.payload->>'nombre' AS absorbida,
                  w.payload->>'tel_norm' AS tel_ganadora,
                  a.payload->>'tel_norm' AS tel_absorbida,
                  w.payload->>'correo' AS mail_ganadora,
                  a.payload->>'correo' AS mail_absorbida,
                  w.payload->>'fecha_llamada' AS fecha_ganadora,
                  a.payload->>'fecha_llamada' AS fecha_absorbida,
                  w.legacy_id AS winner_legacy_id,
                  a.legacy_id AS absorbed_legacy_id
                FROM legacy_lead_ref w
                JOIN legacy_lead_ref a
                  ON a.lead_id = w.lead_id AND a.rol = 'merge_absorbed'
                JOIN lead l ON l.id = w.lead_id
                WHERE w.user_id = %s AND w.rol = 'merge_winner'
                ORDER BY w.lead_id
                """,
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditar colisiones merge_winner vs merge_absorbed")
    parser.add_argument("--user-id", type=int, default=1)
    args = parser.parse_args()

    rows = fetch_pairs(args.user_id)
    if not rows:
        print("No hay pares de colisión en legacy_lead_ref.")
        return 0

    audited: list[dict] = []
    for r in rows:
        tel_g = (r.get("tel_ganadora") or "").strip()
        tel_a = (r.get("tel_absorbida") or "").strip()
        mail_g = (r.get("mail_ganadora") or "").strip().casefold()
        mail_a = (r.get("mail_absorbida") or "").strip().casefold()
        mismo_tel = bool(tel_g and tel_a and tel_g == tel_a)
        mismo_mail = bool(mail_g and mail_a and mail_g == mail_a)
        misma_fecha = (r.get("fecha_ganadora") or "") == (r.get("fecha_absorbida") or "") and bool(
            r.get("fecha_ganadora")
        )
        sim = name_similarity(r.get("ganadora"), r.get("absorbida"))
        sim_atv_g = name_similarity(r.get("nombre_atv"), r.get("ganadora"))
        sim_atv_a = name_similarity(r.get("nombre_atv"), r.get("absorbida"))
        audited.append(
            {
                **r,
                "sim": round(sim, 3),
                "sim_atv_ganadora": round(sim_atv_g, 3),
                "sim_atv_absorbida": round(sim_atv_a, 3),
                "mismo_tel": mismo_tel,
                "mismo_mail": mismo_mail,
                "misma_fecha": misma_fecha,
                "clasificacion": classify(sim, mismo_tel, mismo_mail),
            }
        )

    audited.sort(key=lambda x: x["sim"])

    print(f"=== AUDITORÍA COLISIONES user_id={args.user_id} ({len(audited)} pares) ===\n")
    print(f"{'lead_id':>7} {'sim':>5} {'cls':<28} {'nombre_atv':<32} ganadora / absorbida")
    print("-" * 120)
    for r in audited:
        flag = ""
        if not r["mismo_mail"] and r["mismo_tel"]:
            flag = " [tel≠mail]"
        print(
            f"{r['lead_id']:>7} {r['sim']:>5.3f} {r['clasificacion']:<28} "
            f"{(r['nombre_atv'] or '')[:32]:<32} "
            f"{r['ganadora']!r} / {r['absorbida']!r}{flag}"
        )

    buckets = {"OK": 0, "DUDOSO": 0, "REVISAR": 0, "tel_compartido": 0}
    for r in audited:
        c = r["clasificacion"]
        if c.startswith("OK"):
            buckets["OK"] += 1
        elif c.startswith("DUDOSO"):
            buckets["DUDOSO"] += 1
        else:
            buckets["REVISAR"] += 1
        if not r["mismo_mail"] and r["mismo_tel"]:
            buckets["tel_compartido"] += 1

    print("\n--- Resumen ---")
    print(f"  OK (sim > 0.75):              {buckets['OK']}")
    print(f"  DUDOSO (0.45–0.75):           {buckets['DUDOSO']}")
    print(f"  REVISAR (sim < 0.45):         {buckets['REVISAR']}")
    print(f"  Con tel compartido, mail dist: {buckets['tel_compartido']}")

    print("\n--- Casos REVISAR (sim < 0.45) ---")
    for r in audited:
        if r["sim"] < 0.45:
            print(
                f"  lead_id={r['lead_id']} sim={r['sim']} atv={r['nombre_atv']!r} "
                f"ganadora={r['ganadora']!r} absorbida={r['absorbida']!r} "
                f"tel={r['mismo_tel']} mail={r['mismo_mail']} "
                f"sim_atv→ganadora={r['sim_atv_ganadora']} sim_atv→absorbida={r['sim_atv_absorbida']}"
            )

    print("\n--- Casos DUDOSO con tel compartido ---")
    for r in audited:
        if 0.45 <= r["sim"] <= 0.75 and not r["mismo_mail"] and r["mismo_tel"]:
            print(
                f"  lead_id={r['lead_id']} sim={r['sim']} atv={r['nombre_atv']!r} "
                f"ganadora={r['ganadora']!r} absorbida={r['absorbida']!r}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
