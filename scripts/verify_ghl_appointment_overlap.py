#!/usr/bin/env python3
"""Verificación C: solapamiento ghlId (legacy) vs ghl_appointment_id (Neon ATV).

Uso (después de obtener ghlId desde Supabase query B):

  cd backend
  python ../scripts/verify_ghl_appointment_overlap.py id1 id2 id3 ...
  python ../scripts/verify_ghl_appointment_overlap.py --file ../data/legacy/ghl_ids_sample.txt

Cada línea del archivo puede ser solo el id o CSV con columna ghl_id / ghl_appointment_id.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# backend en PYTHONPATH
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / "backend" / ".env")

import psycopg2


def _parse_ids_from_line(line: str) -> list[str]:
    line = line.strip()
    if not line or line.startswith("#"):
        return []
    # Primera columna si parece CSV
    if "," in line and not line.startswith("ghl"):
        parts = line.split(",")
        for p in parts:
            p = p.strip().strip('"')
            if re.fullmatch(r"[A-Za-z0-9]{15,30}", p):
                return [p]
        return []
    token = line.split(",")[0].strip().strip('"')
    if re.fullmatch(r"[A-Za-z0-9]{15,30}", token):
        return [token]
    return []


def load_ids(args: argparse.Namespace) -> list[str]:
    ids: list[str] = []
    for raw in args.ids:
        raw = raw.strip()
        if raw:
            ids.append(raw)
    if args.file:
        text = Path(args.file).read_text(encoding="utf-8")
        for line in text.splitlines():
            ids.extend(_parse_ids_from_line(line))
    # dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Verificar overlap ghlId legacy vs Neon ATV")
    parser.add_argument("ids", nargs="*", help="ghlId / ghl_appointment_id a probar")
    parser.add_argument("--file", "-f", help="Archivo con ids (uno por línea o CSV)")
    parser.add_argument("--user-id", type=int, default=1)
    args = parser.parse_args()

    ids = load_ids(args)
    if not ids:
        print("ERROR: no se recibieron ids. Pegá los ghlId de la query B de Supabase.", file=sys.stderr)
        return 1

    conn = psycopg2.connect(
        host=os.environ["DB_HOST"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASS"],
        sslmode=os.environ.get("DB_SSLMODE", "require"),
    )
    cur = conn.cursor()
    placeholders = ",".join(["%s"] * len(ids))
    cur.execute(
        f"""
        SELECT ghl_appointment_id, nombre, call::date, agendo::date
        FROM lead
        WHERE user_id = %s AND ghl_appointment_id IN ({placeholders})
        ORDER BY ghl_appointment_id
        """,
        [args.user_id, *ids],
    )
    rows = cur.fetchall()
    matched_ids = {r[0] for r in rows}

    print(f"IDs probados: {len(ids)}")
    print(f"Coinciden en Neon (user_id={args.user_id}): {len(matched_ids)}")
    print(f"Tasa: {len(matched_ids)}/{len(ids)} ({100 * len(matched_ids) / len(ids):.1f}%)")
    print()
    if rows:
        print("Matches encontrados:")
        for appt, nom, call_d, agendo_d in rows[:50]:
            print(f"  {appt} | {nom!r} | call={call_d} agendo={agendo_d}")
        if len(rows) > 50:
            print(f"  ... +{len(rows) - 50} más")
    else:
        print("Sin matches — ghlId probablemente NO es ghl_appointment_id, o son leads fuera de ATV.")

    missing = [i for i in ids if i not in matched_ids]
    if missing and len(missing) <= 10:
        print()
        print("IDs sin match:")
        for m in missing:
            print(f"  {m}")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
