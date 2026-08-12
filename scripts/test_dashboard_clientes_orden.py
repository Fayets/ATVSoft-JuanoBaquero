"""Verificación dashboard clientes — orden y avance por días (API)."""
from __future__ import annotations

import json
import sys
from datetime import date
from urllib.request import Request, urlopen

import psycopg2
from decouple import config

sys.path.insert(0, "c:/Users/Win10/Desktop/ATVSoft-JuanoBaquero/backend".replace("/", "\\"))
from src.services.clients_service import compute_progress  # noqa: E402


def api_clients() -> list[dict]:
    req = Request("http://127.0.0.1:8000/api/clients", headers={"X-User-Id": "1"})
    with urlopen(req, timeout=120) as resp:
        return json.loads(resp.read()).get("clients") or []


def main() -> int:
    ok = True
    pct, days, _ = compute_progress(date(2026, 6, 12), 6, date(2026, 8, 12))
    print(f"formula: 61d -> {pct}% (days={days})")
    over_pct, _, _ = compute_progress(date(2024, 1, 1), 6, date(2026, 8, 12))
    if over_pct != 100.0:
        ok = False

    clients = api_clients()
    complete = [c for c in clients if c.get("progress_percent") is not None]
    incomplete = [c for c in clients if c.get("progress_percent") is None]
    print(f"total={len(clients)} complete={len(complete)} incomplete={len(incomplete)}")

    if "days_elapsed" not in (complete[0] if complete else {}):
        print("FAIL: falta days_elapsed")
        ok = False

    if complete:
        progresses = [float(c["progress_percent"]) for c in complete]
        if progresses != sorted(progresses, reverse=True):
            print("FAIL: orden no descendente")
            ok = False
        print("top3:", [(c["full_name"], c["progress_percent"], c.get("days_elapsed")) for c in complete[:3]])

    if incomplete and complete:
        last_c = max(i for i, c in enumerate(clients) if c.get("progress_percent") is not None)
        first_i = next(i for i, c in enumerate(clients) if c.get("progress_percent") is None)
        if first_i < last_c:
            print("FAIL: incompletos no al final")
            ok = False

    for needle in ("Albeiro", "Alejandro Hern", "ALEJANDRA"):
        hit = next((c for c in clients if needle.lower() in (c.get("full_name") or "").lower()), None)
        if hit:
            print(f"  {hit['full_name']}: {hit.get('progress_percent')}% | {hit.get('days_elapsed')} días")

    conn = psycopg2.connect(user=config("DB_USER"), password=config("DB_PASS"), host=config("DB_HOST"), dbname=config("DB_NAME"))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*), ROUND(SUM(monto)::numeric,2) FROM lead_payment WHERE user_id=1 AND source='legacy_juano'")
    print("ancla:", cur.fetchone())
    conn.close()

    print("RESULTADO:", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
