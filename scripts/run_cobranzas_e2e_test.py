#!/usr/bin/env python3
"""Prueba funcional cobranzas — sección 2 de prueba-y-deploy-cobranzas.md.

Uso (branch Neon):
  set BRANCH_DATABASE_URL=postgresql://...
  cd backend && python ../scripts/run_cobranzas_e2e_test.py

O override host:
  set DB_HOST=ep-xxx-pooler.sa-east-1.aws.neon.tech
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import psycopg2  # noqa: E402
from decouple import config  # noqa: E402

USER_ID = 1
PAGO_CONCEPTOS = frozenset({"PIF", "1ra Cuota", "Otro"})
CUOTAS_CONCEPTOS = frozenset({"2da Cuota", "3ra Cuota"})


def cash_bucket(concepto: str) -> str:
    c = (concepto or "").strip()
    if c == "Fee":
        return "seguimiento"
    if c in CUOTAS_CONCEPTOS:
        return "cuotas"
    if c in PAGO_CONCEPTOS:
        return "pago"
    return "pago"


def compute_cash_composition(month_payload: dict) -> dict[str, float]:
    pago = cuotas = seguimiento = 0.0
    for e in month_payload.get("entries") or []:
        monto = float(e.get("monto") or 0)
        if monto <= 0:
            continue
        bucket = cash_bucket(str(e.get("concepto") or ""))
        if bucket == "pago":
            pago += monto
        elif bucket == "cuotas":
            cuotas += monto
        else:
            seguimiento += monto
    return {"pago": pago, "cuotas": cuotas, "seguimiento": seguimiento}


API = "http://127.0.0.1:8000"
TEST_MONTO = 47.50
TEST_CONCEPTO = "2da Cuota"
TEST_FECHA = date.today().isoformat()
TEST_MONTH = date.today().strftime("%Y-%m")


def pg_connect():
    branch_url = os.environ.get("BRANCH_DATABASE_URL", "").strip()
    if branch_url:
        return psycopg2.connect(branch_url)
    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default="5432"),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def verify_branch(cur) -> dict[str, Any]:
    cur.execute(
        "SELECT COUNT(*) FROM lead WHERE user_id=1 AND COALESCE(link_llamada,'') <> ''"
    )
    links = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM lead WHERE user_id=1 AND debe IS NULL")
    debe_null = int(cur.fetchone()[0])
    cur.execute(
        "SELECT COUNT(*), ROUND(COALESCE(SUM(monto),0)::numeric,2) "
        "FROM lead_payment WHERE user_id=1 AND source='legacy_juano'"
    )
    legacy = cur.fetchone()
    cur.execute("SELECT COUNT(*) FROM lead_payment WHERE user_id=1 AND source='atv'")
    atv = int(cur.fetchone()[0])
    host = os.environ.get("BRANCH_DATABASE_URL") or config("DB_HOST")
    if isinstance(host, str) and host.startswith("postgresql"):
        host = urlparse(host).hostname or host
    return {
        "db_host": host,
        "links_con_link": links,
        "debe_null": debe_null,
        "legacy_pagos": int(legacy[0]),
        "legacy_usd": float(legacy[1]),
        "atv_pagos": atv,
        "looks_like_pre_backfill": links <= 20,
        "looks_like_production": links >= 300,
    }


def pick_leads(cur) -> tuple[int, float, int, float]:
    """Lead A: debe NULL para pago test. Lead B: otro debe NULL para precio contrato."""
    cur.execute(
        """
        SELECT l.id, COALESCE(l.pago,0)::float
        FROM lead l
        WHERE l.user_id = %s AND l.debe IS NULL
          AND (l.status ILIKE 'cerrado' OR COALESCE(l.pago,0) > 0)
        ORDER BY l.id
        LIMIT 5
        """,
        (USER_ID,),
    )
    rows = cur.fetchall()
    if len(rows) < 2:
        raise RuntimeError("No hay suficientes leads con debe NULL para la prueba.")
    lead_a, pago_a = int(rows[0][0]), float(rows[0][1])
    lead_b, pago_b = int(rows[1][0]), float(rows[1][1])
    return lead_a, pago_a, lead_b, pago_b


def api(method: str, path: str, body: dict | None = None) -> tuple[int, Any]:
    headers = {"X-User-Id": str(USER_ID), "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"detail": raw or e.reason}
        return e.code, payload


def read_lead_pago(cur, lead_id: int) -> float:
    cur.execute("SELECT COALESCE(pago,0)::float FROM lead WHERE id=%s AND user_id=%s", (lead_id, USER_ID))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"Lead {lead_id} no encontrado")
    return float(row[0])


def read_lead_debe(cur, lead_id: int) -> float | None:
    cur.execute("SELECT debe FROM lead WHERE id=%s AND user_id=%s", (lead_id, USER_ID))
    row = cur.fetchone()
    return None if row is None or row[0] is None else float(row[0])


def suggest_concepto_from_pagos(pagos: list[dict]) -> str:
    concepts = {(p.get("concepto") or "").strip() for p in pagos}
    if "1ra Cuota" in concepts:
        return "2da Cuota"
    if "2da Cuota" in concepts:
        return "3ra Cuota"
    if "PIF" in concepts:
        return "PIF"
    return "1ra Cuota"


def main() -> int:
    results: dict[str, Any] = {"steps": {}, "extra": {}}

    conn = pg_connect()
    cur = conn.cursor()
    branch_info = verify_branch(cur)
    results["branch_check"] = branch_info

    if branch_info["looks_like_production"] and not branch_info["looks_like_pre_backfill"]:
        print("ERROR: La BD parece PRODUCTION (links=%s). Se requiere branch pre-backfill-links-2026-08-11." % branch_info["links_con_link"])
        print("Exportá BRANCH_DATABASE_URL desde Neon → Branches → pre-backfill-links-2026-08-11 → Connect")
        return 2

    lead_a, pago_inicial, lead_b, _ = pick_leads(cur)
    results["lead_pago_test"] = {"lead_id": lead_a, "pago_inicial": pago_inicial}
    results["lead_contrato_test"] = {"lead_id": lead_b}

    # Paso 1 — perfil + flags UI
    code, perfil = api("GET", f"/api/cobranzas/{lead_a}")
    lead = perfil.get("lead", {}) if code == 200 else {}
    pagos = perfil.get("pagos", []) if code == 200 else []
    sugerencia = suggest_concepto_from_pagos(pagos)
    step1_ok = (
        code == 200
        and lead.get("debe_desconocido") is True
        and lead.get("debe") is None
    )
    results["steps"]["1"] = {
        "ok": step1_ok,
        "http": code,
        "debe_desconocido": lead.get("debe_desconocido"),
        "debe": lead.get("debe"),
        "nota_ui": "debe_desconocido=true → aviso amarillo + Agregar cuota habilitado en UI",
        "sugerencia_concepto": sugerencia,
    }

    # Baseline dashboard ventas
    code_m0, month0 = api("GET", f"/api/cobranzas/pagos/month?month={TEST_MONTH}")
    comp0 = compute_cash_composition(month0) if code_m0 == 200 else {}

    # Paso 2 — crear pago
    code2, pago_out = api(
        "POST",
        f"/api/cobranzas/{lead_a}/pagos",
        {
            "monto": TEST_MONTO,
            "fecha": TEST_FECHA,
            "concepto": TEST_CONCEPTO,
            "nota": "E2E test cobranzas",
        },
    )
    pago_id = pago_out.get("id") if code2 == 200 else None
    step2_ok = code2 == 200 and (pago_out.get("concepto") or "").strip() == TEST_CONCEPTO
    results["steps"]["2"] = {"ok": step2_ok, "http": code2, "pago_id": pago_id, "concepto": pago_out.get("concepto")}

    # Paso 3 — dashboard ventas bucket Cuotas
    code_m1, month1 = api("GET", f"/api/cobranzas/pagos/month?month={TEST_MONTH}")
    comp1 = compute_cash_composition(month1) if code_m1 == 200 else {}
    delta_cuotas = round(float(comp1.get("cuotas", 0)) - float(comp0.get("cuotas", 0)), 2)
    delta_pago = round(float(comp1.get("pago", 0)) - float(comp0.get("pago", 0)), 2)
    step3_ok = abs(delta_cuotas - TEST_MONTO) < 0.01 and abs(delta_pago) < 0.01
    results["steps"]["3"] = {
        "ok": step3_ok,
        "mes": TEST_MONTH,
        "delta_cuotas": delta_cuotas,
        "delta_pago": delta_pago,
        "cuotas_antes": comp0.get("cuotas"),
        "cuotas_despues": comp1.get("cuotas"),
    }

    # Paso 4 — lead.pago subió
    pago_despues = read_lead_pago(cur, lead_a)
    conn.commit()
    step4_ok = abs(pago_despues - (pago_inicial + TEST_MONTO)) < 0.01
    results["steps"]["4"] = {
        "ok": step4_ok,
        "pago_inicial": pago_inicial,
        "pago_despues": pago_despues,
        "delta_esperado": TEST_MONTO,
        "delta_real": round(pago_despues - pago_inicial, 2),
    }

    # Paso 5 — dashboard clientes (cliente visible + sale_status coherente con cobro)
    code5, client = api("GET", f"/api/clients/{lead_a}")
    code5t, tracking = api("GET", "/api/clients/tracking")
    in_tracking = False
    if code5t == 200:
        for g in tracking.get("groups") or []:
            for c in g.get("clients") or []:
                if str(c.get("lead_id")) == str(lead_a):
                    in_tracking = True
                    break
    step5_ok = (
        code5 == 200
        and in_tracking
        and (client.get("sale_status") or "").lower() in ("cerrado", "closed")
        and float(client.get("progress_percent") or 0) >= 0
    )
    results["steps"]["5"] = {
        "ok": step5_ok,
        "http_client": code5,
        "http_tracking": code5t,
        "in_tracking": in_tracking,
        "sale_status": client.get("sale_status") if code5 == 200 else None,
        "progress_percent": client.get("progress_percent") if code5 == 200 else None,
        "nota": "progress_percent es avance temporal del programa; validamos presencia en tracking + sale_status cerrado tras cobro",
    }

    # Paso 6 — eliminar pago (crítico)
    code6, del_out = api("DELETE", f"/api/cobranzas/pagos/{pago_id}") if pago_id else (0, {})
    pago_final = read_lead_pago(cur, lead_a)
    conn.commit()
    step6_ok = code6 == 200 and abs(pago_final - pago_inicial) < 0.01
    results["steps"]["6"] = {
        "ok": step6_ok,
        "http": code6,
        "pago_final": pago_final,
        "pago_inicial": pago_inicial,
        "residuo": round(pago_final - pago_inicial, 4),
    }

    # Paso 7 — precio contrato en otro lead
    debe_b_antes = read_lead_debe(cur, lead_b)
    precio_test = 1200.0
    code7, patch_out = api(
        "PATCH",
        f"/api/cobranzas/{lead_b}",
        {"precio_contrato": precio_test},
    )
    debe_b_despues = read_lead_debe(cur, lead_b)
    conn.commit()
    pago_b = read_lead_pago(cur, lead_b)
    debe_esperado = max(0.0, precio_test - pago_b)
    step7_ok = (
        code7 == 200
        and debe_b_antes is None
        and debe_b_despues is not None
        and abs(debe_b_despues - debe_esperado) < 0.01
    )
    results["steps"]["7"] = {
        "ok": step7_ok,
        "http": code7,
        "lead_id": lead_b,
        "debe_antes": debe_b_antes,
        "debe_despues": debe_b_despues,
        "precio_contrato": precio_test,
        "pago_lead": pago_b,
        "debe_esperado": round(debe_esperado, 2),
    }

    # Cleanup paso 7 — revertir precio contrato (opcional, dejar debe recalculado sin precio)
    # Restaurar lead B: quitar precio_contrato del meta vía SQL para no ensuciar branch
    cur.execute(
        """
        UPDATE lead SET legacy_meta = legacy_meta - 'precio_contrato'
        WHERE id=%s AND user_id=%s
        """,
        (lead_b, USER_ID),
    )
    conn.commit()

    # Extra: sugerencia concepto
    results["extra"]["desplegable_sugerencia"] = {
        "ok": sugerencia in ("2da Cuota", "3ra Cuota", "1ra Cuota", "PIF"),
        "pagos_existentes": [p.get("concepto") for p in pagos[:5]],
        "sugerencia": sugerencia,
    }

    cur.close()
    conn.close()

    results["all_ok"] = all(
        results["steps"][str(i)]["ok"] for i in range(1, 8)
    )
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if results["all_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
