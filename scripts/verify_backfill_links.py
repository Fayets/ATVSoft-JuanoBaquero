#!/usr/bin/env python3
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")
from decouple import config
import psycopg2
conn = psycopg2.connect(
    user=config("DB_USER"), password=config("DB_PASS"), host=config("DB_HOST"),
    dbname=config("DB_NAME"), port=config("DB_PORT", default=5432),
    sslmode=config("DB_SSLMODE", default="require"),
)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM lead WHERE user_id=1 AND link_llamada IS NOT NULL AND TRIM(link_llamada) <> ''")
print("leads_con_link:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*), ROUND(SUM(monto)::numeric,2) FROM lead_payment WHERE user_id=1 AND source='legacy_juano'")
print("pagos_usd:", cur.fetchone())
cur.execute("SELECT COUNT(*) FROM lead WHERE user_id=1 AND legacy_meta::text LIKE '%backfill_links_fathom%'")
print("audit_backfill:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*) FROM lead WHERE user_id=1 AND legacy_meta::text LIKE '%link_llamada_secundario%'")
print("secundario:", cur.fetchone()[0])
conn.close()
