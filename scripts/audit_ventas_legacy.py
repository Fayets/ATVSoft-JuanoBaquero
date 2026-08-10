#!/usr/bin/env python3
"""Auditoría ventas legacy no reflejadas en ATV (decision-1307-auditoria-ventas.md)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from decouple import Config, RepositoryEnv

config = Config(RepositoryEnv(ROOT / "backend" / ".env"))
import psycopg2
from psycopg2.extras import RealDictCursor

Q1 = """
SELECT
  r.lead_id,
  l.nombre                        AS nombre_atv,
  COALESCE(l.status, l.estado, '') AS status_atv,
  l.programa_ofrecido             AS producto_atv,
  l.legacy_meta->>'cierre'        AS cierre_meta_atv,
  r.payload->>'nombre'            AS nombre_legacy,
  r.payload->>'situacion'         AS situacion_legacy,
  r.payload->>'cierre'            AS cierre_legacy,
  r.payload->>'producto'          AS producto_legacy,
  r.payload->>'origen'            AS origen_legacy,
  r.rol,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = r.lead_id) AS pagos_en_atv
FROM legacy_lead_ref r
JOIN lead l ON l.id = r.lead_id
WHERE r.user_id = 1
  AND r.payload->>'cierre' = 'Sí'
  AND COALESCE(l.status, l.estado, '') NOT IN ('Cerrado', 'Seguimiento')
ORDER BY r.payload->>'origen' NULLS LAST, r.lead_id;
"""

Q2 = """
SELECT
  COALESCE(payload->>'origen', '(sin origen)') AS origen,
  COUNT(*)                                      AS total,
  COUNT(*) FILTER (WHERE payload->>'cierre' = 'Sí') AS con_cierre_si
FROM legacy_lead_ref
WHERE user_id = 1
GROUP BY 1
ORDER BY total DESC;
"""

Q3 = """
SELECT id, lead_id, monto, fecha, concepto, producto, nota, legacy_meta
FROM lead_payment
WHERE user_id = 1
  AND (
    lower(COALESCE(nota, '')) LIKE '%jhoan%'
    OR lower(COALESCE(nota, '')) LIKE '%galvis%'
    OR lower(COALESCE(nota, '')) LIKE '%anthuan%'
    OR lower(COALESCE(legacy_meta::text, '')) LIKE '%jhoan%'
    OR lower(COALESCE(legacy_meta::text, '')) LIKE '%galvis%'
    OR lower(COALESCE(legacy_meta::text, '')) LIKE '%anthuan%'
  )
ORDER BY fecha;
"""

Q4_VERIFY_1855 = """
SELECT lp.id, lp.lead_id, l.nombre, lp.monto, lp.fecha, lp.concepto, lp.legacy_id
FROM lead_payment lp
JOIN lead l ON l.id = lp.lead_id
WHERE lp.id = 509 OR lp.lead_id IN (1855, 6989)
ORDER BY lp.id;
"""

Q6_BACKUP_GAP = """
SELECT DISTINCT ON (r.lead_id)
  r.lead_id,
  l.nombre AS nombre_atv,
  COALESCE(l.status, l.estado, '') AS status_atv,
  r.rol,
  r.payload->>'nombre' AS nombre_legacy,
  r.payload->>'situacion' AS situacion_legacy,
  r.payload->>'cierre' AS cierre_legacy,
  r.payload->>'producto' AS producto_legacy,
  r.payload->>'origen' AS origen_legacy,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = r.lead_id) AS pagos_en_atv
FROM legacy_lead_ref r
JOIN lead l ON l.id = r.lead_id
WHERE r.user_id = 1
  AND COALESCE(r.payload->>'origen', '') ILIKE '%backup%'
  AND r.payload->>'cierre' = 'Sí'
ORDER BY r.lead_id, r.rol;
"""

Q7_PAGO_JHOAN_CSV = """
SELECT id, lead_id, legacy_id, monto, fecha, concepto, producto
FROM lead_payment
WHERE user_id = 1 AND legacy_id = 'ff612157-913b-4f5f-ad1a-1fe30ad828ee';
"""

Q8_LEAD_6969 = """
SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.source, l.legacy_id,
       (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos
FROM lead l WHERE l.id = 6969;
"""

Q9_PAGO_425 = """
SELECT lp.id, lp.lead_id, l.nombre, lp.monto, lp.fecha, lp.concepto, lp.producto, lp.legacy_meta
FROM lead_payment lp JOIN lead l ON l.id = lp.lead_id WHERE lp.id = 425;
"""

Q10_AREVALO = """
SELECT lp.id, lp.lead_id, l.nombre, lp.monto
FROM lead_payment lp JOIN lead l ON l.id = lp.lead_id
WHERE lp.legacy_id = '50ac6c00-e3e6-4f34-b946-a7fd69b23b97';
"""

Q5_REFS_1855 = """
SELECT rol, legacy_id, lead_id, motivo
FROM legacy_lead_ref
WHERE user_id = 1 AND legacy_id IN (
  '130c030b-79f6-40b2-b860-1f5832d9ac37',
  '1429fc42-783b-423e-a591-3ed76e014630'
)
ORDER BY rol;
"""


def main() -> int:
    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )
    cur = conn.cursor(cursor_factory=RealDictCursor)

    print("=" * 70)
    print("Q1 — Legacy cierre=Sí pero ATV sin Venta/Fee")
    print("=" * 70)
    cur.execute(Q1)
    rows1 = cur.fetchall()
    print(f"Total filas: {len(rows1)}\n")
    for r in rows1:
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    print("\n" + "=" * 70)
    print("Q2 — Conteo por origen")
    print("=" * 70)
    cur.execute(Q2)
    rows2 = cur.fetchall()
    for r in rows2:
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    backup_rows = [
        r
        for r in rows2
        if "backup" in str(r.get("origen", "")).lower()
        or "recuperado" in str(r.get("origen", "")).lower()
    ]
    if backup_rows:
        print("\n--- Subgrupo backup/recuperado ---")
        for r in backup_rows:
            print(json.dumps(dict(r), ensure_ascii=False, default=str))

    print("\n" + "=" * 70)
    print("Q3 — Pagos Jhoan/Galvis/Anthuan (lead_payment no tiene columna cliente)")
    print("=" * 70)
    cur.execute(Q3)
    rows3 = cur.fetchall()
    print(f"Total: {len(rows3)}\n")
    for r in rows3:
        d = dict(r)
        meta = d.pop("legacy_meta", {}) or {}
        cliente = meta.get("cliente") if isinstance(meta, dict) else None
        print(json.dumps({**d, "cliente_meta": cliente}, ensure_ascii=False, default=str))

    print("\n" + "=" * 70)
    print("Q6 — Solo origen backup + cierre=Sí")
    print("=" * 70)
    cur.execute(Q6_BACKUP_GAP)
    rows6 = cur.fetchall()
    print(f"Leads distintos: {len(rows6)}\n")
    sin_pagos = 0
    for r in rows6:
        d = dict(r)
        if int(d.get("pagos_en_atv") or 0) == 0:
            sin_pagos += 1
        print(json.dumps(d, ensure_ascii=False, default=str))
    print(f"\nCon 0 pagos en ATV: {sin_pagos}")

    print("\n" + "=" * 70)
    print("Q7 — Pago pagos.csv Jhoan y Anthuan (ff612157…)")
    print("=" * 70)
    cur.execute(Q7_PAGO_JHOAN_CSV)
    rows7 = cur.fetchall()
    print(f"En lead_payment: {len(rows7)}")
    for r in rows7:
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    print("\n" + "=" * 70)
    print("Q8 — Lead donde cayó el pago Jhoan y Anthuan (6969)")
    print("=" * 70)
    cur.execute(Q8_LEAD_6969)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))
    cur.execute(Q9_PAGO_425)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))
    cur.execute(Q10_AREVALO)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    print("\n" + "=" * 70)
    print("Verificación post-reversión 1855")
    print("=" * 70)
    cur.execute(Q4_VERIFY_1855)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))
    cur.execute(Q5_REFS_1855)
    for r in cur.fetchall():
        print(json.dumps(dict(r), ensure_ascii=False, default=str))

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
