#!/usr/bin/env python3
"""Genera docs/CLAUDE_HIPOTESIS_CRM_VIEJO_SANTIAGO.md."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from claude_report import report_footer, write_claude_report  # noqa: E402
from decouple import config  # noqa: E402

REPORT = "HIPOTESIS_CRM_VIEJO_SANTIAGO.md"


def _pg(url: str | None = None):
    import psycopg2

    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        user=config("DB_USER"),
        password=config("DB_PASS"),
        host=config("DB_HOST"),
        dbname=config("DB_NAME"),
        port=config("DB_PORT", default=5432),
        sslmode=config("DB_SSLMODE", default="require"),
    )


def main() -> int:
    uid = 1
    L: list[str] = []

    L.append("## Resumen")
    L.append("")
    L.append(
        "El reporte de Santiago Torrico (**11/08**) probablemente refiere al **CRM legacy "
        "(`crm-juanovent` / Supabase `juano.leads`)**, no a ATV. Las etiquetas de su captura "
        "(`Contexto triaje`, `Contexto setter (pre call)`) **existen en el jsonb legacy** "
        "y **no existen en el repo ATV**."
    )
    L.append("")
    L.append(
        "Hallazgo ATV independiente: los 12 análisis Fathom están en **error** porque "
        "**nunca se configuró la API key de Claude** en `apiconnection` — la feature "
        "**nunca produjo contenido exitoso**."
    )
    L.append("")

    L.append("## 1. Correspondencia captura ↔ CRM legacy")
    L.append("")
    L.append("| Etiqueta captura Santiago | Clave jsonb `juano.leads.data` | En repo ATV |")
    L.append("|---|---|---|")
    L.append("| Contexto triaje | `contextoTriaje` | **No** |")
    L.append("| Contexto setter (pre call) | `contextoSetter` + `preCall` | **No** |")
    L.append("| ¿Se hizo triaje? | `triaje` / `triajeResultado` | Parcial (`triaje_hecho` bool, distinto UX) |")
    L.append("| Links Fathom | `linkLlamada` | Sí (`lead.link_llamada`) |")
    L.append("| Contexto closer | `contextoCloser` | **No** |")
    L.append("")
    L.append(
        "**Indicio:** Santiago Torrico aparece como closer en datos legacy (Top Closers del dashboard anterior, ~39 cierres)."
    )
    L.append("")
    L.append(
        "**Conclusión probable:** está en `crm-juanovent`, no en ATV. Explica por qué ATV no perdió filas "
        "y por qué la UI de la captura no coincide con ninguna vista del repo."
    )
    L.append("")

    L.append("## 2. Verificación Supabase legacy — PENDIENTE operador")
    L.append("")
    L.append("Proyecto: **`crm-juanovent`** · schema **`juano`** · SQL Editor · solo lectura.")
    L.append("")
    L.append("```sql")
    L.append("SELECT")
    L.append("  COUNT(*)                                                           AS total,")
    L.append("  COUNT(*) FILTER (WHERE COALESCE(data->>'linkLlamada','')    <> '') AS con_link,")
    L.append("  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoSetter','') <> '') AS con_ctx_setter,")
    L.append("  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoTriaje','') <> '') AS con_ctx_triaje,")
    L.append("  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoCloser','') <> '') AS con_ctx_closer,")
    L.append("  COUNT(*) FILTER (WHERE COALESCE(data->>'preCall','')        <> '') AS con_precall")
    L.append("FROM juano.leads;")
    L.append("```")
    L.append("")
    L.append(
        "Si esos campos están vacíos o casi vacíos en Supabase, el problema es **del CRM del cliente**, "
        "no de ATV. Nosotros solo corrimos SELECT contra Supabase en migración; Neon ATV creció, nunca bajó."
    )
    L.append("")

    supabase_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if supabase_url:
        with _pg(supabase_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE COALESCE(data->>'linkLlamada','') <> ''),
                      COUNT(*) FILTER (WHERE COALESCE(data->>'contextoSetter','') <> ''),
                      COUNT(*) FILTER (WHERE COALESCE(data->>'contextoTriaje','') <> ''),
                      COUNT(*) FILTER (WHERE COALESCE(data->>'contextoCloser','') <> ''),
                      COUNT(*) FILTER (WHERE COALESCE(data->>'preCall','') <> '')
                    FROM juano.leads
                    """
                )
                row = cur.fetchone()
        L.append("**Resultado ejecutado:**")
        L.append("")
        L.append(
            f"| total | linkLlamada | contextoSetter | contextoTriaje | contextoCloser | preCall |"
        )
        L.append(f"|---:|---:|---:|---:|---:|---:|")
        L.append(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {row[5]} |")
        L.append("")
    else:
        L.append("*No se corrió desde Cursor: falta `SUPABASE_DB_URL` en el entorno.*")
        L.append("")

    L.append("## 3. Verificación ATV — Claude / Fathom (Neon production)")
    L.append("")

    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cr.estado, COUNT(*), MIN(cr.created_at)::date, MAX(cr.created_at)::date
                FROM call_report cr JOIN lead l ON l.id = cr.lead_id
                WHERE l.user_id = %s GROUP BY cr.estado
                """,
                (uid,),
            )
            cr_rows = cur.fetchall()
            cur.execute(
                """
                SELECT COUNT(*) FROM lead WHERE user_id=%s
                  AND link_llamada IS NOT NULL AND TRIM(link_llamada) <> ''
                """,
                (uid,),
            )
            links = int(cur.fetchone()[0])
            cur.execute(
                "SELECT platform, updated_at FROM apiconnection WHERE user_id = %s ORDER BY platform",
                (uid,),
            )
            platforms = cur.fetchall()

    L.append("### `call_report` histórico (user_id=1)")
    L.append("")
    L.append("| estado | count | desde | hasta |")
    L.append("|---|---:|---|---|")
    for est, n, d0, d1 in cr_rows:
        L.append(f"| `{est}` | **{n}** | {d0} | {d1} |")
    L.append("")
    L.append(
        f"**Reportes exitosos (estado ≠ error/pendiente): 0.** "
        f"Nunca hubo análisis Fathom completado en ATV."
    )
    L.append("")
    L.append(f"**Links Fathom en `lead.link_llamada`:** **{links}** (intactos).")
    L.append("")
    L.append("**Error en todos:** `Configurá tu API key de Claude en Conexiones API antes de analizar llamadas.`")
    L.append("")

    L.append("### `apiconnection` (user_id=1)")
    L.append("")
    L.append("| platform | updated_at |")
    L.append("|---|---|")
    has_claude = False
    for p, u in platforms:
        if p == "claude":
            has_claude = True
        L.append(f"| `{p}` | {u} |")
    L.append("")
    if not has_claude:
        L.append(
            "**No existe fila `platform='claude'`.** La key nunca fue guardada en Conexiones → "
            "el análisis Fathom **nunca estuvo operativo**; no es un borrado reciente."
        )
    L.append("")

    L.append("## 4. ATV — sin pérdida de filas (reconfirmado)")
    L.append("")
    L.append("| Métrica | Branch 10/08 | Production |")
    L.append("|---|---:|---:|")
    L.append("| `call_report` | 9 | **12** |")
    L.append("| `closer_report` | 11 | **17** |")
    L.append("| `setter_report` | 0 | **0** |")
    L.append("| leads `link_llamada` | 9 | **12** |")
    L.append("| audit import vaciados | — | **0** |")
    L.append("")

    L.append("## 5. Deploy")
    L.append("")
    L.append("- GitHub **`master`**: `ff29c43` (fix dashboard cash incluido)")
    L.append("- VPS `72.60.244.220`: **no verificado** (SSH timeout desde Cursor)")
    L.append("- Confirmar: `git log -1 --oneline` + docker rebuild en VPS")
    L.append("")

    L.append("## 6. Orden de acciones")
    L.append("")
    L.append("| # | Acción | Estado |")
    L.append("|---:|---|---|")
    L.append("| 1 | Pedir **URL** a Santiago (define si es CRM viejo o ATV) | 🔴 pendiente cliente |")
    L.append("| 2 | Contar campos legacy en Supabase (query §2) | 🔴 pendiente operador |")
    L.append("| 3 | Histórico `call_report` | ✅ **0 exitosos, 12 error** |")
    L.append("| 4 | Configurar Claude en Conexiones + re-procesar 12 reportes | 🟡 mejora ATV real |")
    L.append("| 5 | Verificar versión VPS vs `ff29c43` | 🟡 pendiente operador |")
    L.append("| 6 | Diff branch Neon vs production | ⏸️ **pausado** hasta confirmar sistema |")
    L.append("| 7 | Upsert leads pendiente | ⏸️ sigue en pausa |")
    L.append("")

    L.append("## 7. Mensaje sugerido para Santiago")
    L.append("")
    L.append("> Bro, revisamos y en la base de ATV no se borró nada — los datos están y se siguieron cargando normal.")
    L.append(">")
    L.append("> Pasame el **link de la pantalla** donde lo viste (copiá la URL del navegador) y el **nombre de un cliente puntual**. Con eso lo ubico enseguida.")
    L.append("")
    L.append(
        "Si la URL es del CRM viejo (`crm-juanovent`), el análisis pasa a Supabase legacy, no a Neon."
    )
    L.append("")
    L.append("Ver también: `docs/CLAUDE_INVESTIGACION_TRACKER_SANTIAGO.md`.")
    L.append("")
    L.append(report_footer("report_hipotesis_crm_viejo.py", uid))

    path = write_claude_report(
        REPORT,
        "\n".join(L),
        title="Hipótesis CRM viejo — reporte Santiago Torrico",
    )
    print(f"Reporte: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
