"""Prueba funcional columna Setter — panel diario."""
from __future__ import annotations

import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import psycopg2
from decouple import config

sys.path.insert(0, "c:/Users/Win10/Desktop/ATVSoft-JuanoBaquero/backend".replace("/", "\\"))

from src.db import init_db  # noqa: E402
from src.services.agent_closer_service import list_llamadas_dia  # noqa: E402

BASE_LEADS = "http://127.0.0.1:8000/api/leads"
BASE_TEAM = "http://127.0.0.1:8000/api/team"
USER_ID = "1"
TEST_SETTER = "__Test Setter QA__"
RESULTS: dict = {"ok": True, "steps": [], "errors": []}


def log(step: str, detail: object) -> None:
    RESULTS["steps"].append({"step": step, "detail": detail})
    print(f"[{step}] {detail}")


def api(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {"X-User-Id": USER_ID, "Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> {e.code}: {err_body}") from e


def sql_snapshot() -> dict:
    conn = psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COALESCE(NULLIF(setter,''),'(sin setter)') AS setter, COUNT(*)
        FROM lead WHERE user_id=1 AND call IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5
        """
    )
    top_setters = cur.fetchall()
    cur.execute(
        "SELECT id, nombre, rol FROM teammember WHERE user_id=1 AND rol='setter'"
    )
    team_setters = cur.fetchall()
    cur.execute(
        """
        SELECT COUNT(*), ROUND(SUM(monto)::numeric, 2)
        FROM lead_payment WHERE user_id=1 AND source='legacy_juano'
        """
    )
    pagos = cur.fetchone()
    conn.close()
    return {"top_setters": top_setters, "team_setters": team_setters, "pagos": pagos}


def find_lead_with_setter_ia(fecha: str) -> int | None:
    init_db()
    payload = list_llamadas_dia(1, __import__("datetime").date.fromisoformat(fecha))
    for row in payload.get("llamadas") or []:
        if (row.get("setter") or "").strip() == "Setter IA":
            return int(row["id"])
    return None


def main() -> int:
    test_member_id: int | None = None
    lead_id = 6991
    fecha = "2026-08-12"
    orig_setter = ""

    try:
        log("sql_inicial", sql_snapshot())

        # GET incluye setter
        llamadas = api("GET", f"{BASE_LEADS}/llamadas-hoy?fecha={fecha}")
        items = llamadas.get("llamadas") or []
        row = next((x for x in items if int(x["id"]) == lead_id), items[0] if items else None)
        if not row:
            raise RuntimeError("No hay llamadas para probar")
        lead_id = int(row["id"])
        if "setter" not in row:
            raise RuntimeError("GET llamadas-hoy no devuelve setter")
        orig_setter = (row.get("setter") or "").strip()
        log("get_llamadas_hoy", {"lead_id": lead_id, "setter": orig_setter})

        # Crear setter de prueba en TeamMember
        created = api("POST", f"{BASE_TEAM}/members", {"nombre": TEST_SETTER, "rol": "setter"})
        test_member_id = int(created["id"])
        log("create_team_setter", created)

        members = api("GET", f"{BASE_TEAM}/members")
        setter_names = [s["nombre"] for s in members.get("setters") or []]
        if TEST_SETTER not in setter_names:
            raise RuntimeError("Nuevo setter no aparece en GET /team/members")
        log("team_members_setters", setter_names)

        # Asignar setter
        patched = api("PATCH", f"{BASE_LEADS}/{lead_id}", {"setter": TEST_SETTER})
        if (patched.get("setter") or "").strip() != TEST_SETTER:
            raise RuntimeError("PATCH setter no persistió")
        log("patch_setter", {"lead_id": lead_id, "setter": patched["setter"]})

        # Releer
        llamadas2 = api("GET", f"{BASE_LEADS}/llamadas-hoy?fecha={fecha}")
        row2 = next(x for x in llamadas2["llamadas"] if int(x["id"]) == lead_id)
        if (row2.get("setter") or "").strip() != TEST_SETTER:
            raise RuntimeError("GET tras PATCH no refleja setter")
        log("get_tras_asignar", {"setter": row2["setter"]})

        # Desasignar
        patched2 = api("PATCH", f"{BASE_LEADS}/{lead_id}", {"setter": ""})
        if (patched2.get("setter") or "").strip():
            raise RuntimeError("PATCH setter vacío no desasignó")
        log("patch_sin_especificar", {"setter": patched2.get("setter")})

        # Lead con Setter IA (huérfano de TeamMember)
        ia_id = find_lead_with_setter_ia(fecha)
        if ia_id:
            ia_row = next(x for x in llamadas2["llamadas"] if int(x["id"]) == ia_id)
            log("setter_ia_huérfano", {"lead_id": ia_id, "setter": ia_row.get("setter")})
        else:
            log("setter_ia_huérfano", "No hay lead con Setter IA en el día de prueba")

        # Restaurar
        api("PATCH", f"{BASE_LEADS}/{lead_id}", {"setter": orig_setter})
        log("estado_restaurado", {"lead_id": lead_id, "setter": orig_setter})

        log("sql_final", sql_snapshot())
        log("resultado", "TODAS LAS PRUEBAS OK")

    except Exception as e:
        RESULTS["ok"] = False
        RESULTS["errors"].append(str(e))
        log("ERROR", str(e))
        try:
            if lead_id:
                api("PATCH", f"{BASE_LEADS}/{lead_id}", {"setter": orig_setter})
        except Exception:
            pass
        return 1
    finally:
        if test_member_id:
            try:
                api("DELETE", f"{BASE_TEAM}/members/{test_member_id}")
                log("cleanup_test_setter", test_member_id)
            except Exception as e:
                RESULTS["errors"].append(f"cleanup: {e}")

    out = "c:/Users/Win10/Desktop/ATVSoft-JuanoBaquero/data/legacy/test_setter_column_result.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nJSON guardado en {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
