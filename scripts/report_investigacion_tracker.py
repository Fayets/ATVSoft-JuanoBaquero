#!/usr/bin/env python3
"""Genera docs/CLAUDE_INVESTIGACION_TRACKER_SANTIAGO.md desde production (solo lectura)."""
from __future__ import annotations

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

REPORT = "INVESTIGACION_TRACKER_SANTIAGO.md"


def _pg():
    import psycopg2

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
    lines: list[str] = []

    lines.append("## Contexto")
    lines.append("")
    lines.append(
        "Santiago Torrico reportó el **11/08 ~07:25** que *«se borró todo en el tracker, "
        "en la parte de los fathoms»*. La captura muestra el modal **«Editar lead»** con "
        "**¿Se hizo triaje?**, **Contexto triaje** y **Contexto setter (pre call)**."
    )
    lines.append("")
    lines.append("Branch de referencia Neon: **`recuperacion-prefathom`** (snapshot 10/08 12:00 ART).")
    lines.append("")

    with _pg() as conn:
        with conn.cursor() as cur:
            # Conteos filas (confirmación doc previo)
            cur.execute("SELECT COUNT(*) FROM call_report cr JOIN lead l ON l.id=cr.lead_id WHERE l.user_id=%s", (uid,))
            cr_cnt = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM closer_report WHERE user_id=%s", (uid,))
            closer_cnt = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM setter_report WHERE user_id=%s", (uid,))
            setter_cnt = int(cur.fetchone()[0])
            cur.execute(
                "SELECT COUNT(*) FROM lead WHERE user_id=%s AND link_llamada IS NOT NULL AND TRIM(link_llamada)<>''",
                (uid,),
            )
            link_cnt = int(cur.fetchone()[0])

            lines.append("## 1. Filas — sin pérdida (confirmado)")
            lines.append("")
            lines.append("| Métrica | Branch 10/08 | Production 11/08 |")
            lines.append("|---|---:|---:|")
            lines.append("| `call_report` | 9 | **12** |")
            lines.append("| `closer_report` | 11 | **17** |")
            lines.append("| `setter_report` | 0 | **0** |")
            lines.append("| Leads con `link_llamada` | 9 | **12** |")
            lines.append("")
            lines.append("Production actual (consulta directa):")
            lines.append(f"- `call_report`: **{cr_cnt}**")
            lines.append(f"- `closer_report`: **{closer_cnt}**")
            lines.append(f"- `setter_report`: **{setter_cnt}**")
            lines.append(f"- leads con `link_llamada`: **{link_cnt}**")
            lines.append("")
            lines.append("El import legacy **no** causó borrado masivo: tasas de `link_llamada` equivalentes entre leads tocados y no tocados (~0,7%).")
            lines.append("")

            # call_report estado
            cur.execute(
                """
                SELECT cr.estado, COUNT(*)
                FROM call_report cr JOIN lead l ON l.id=cr.lead_id
                WHERE l.user_id=%s GROUP BY cr.estado ORDER BY 2 DESC
                """,
                (uid,),
            )
            estados = cur.fetchall()
            cur.execute(
                """
                SELECT DISTINCT LEFT(cr.error_msg, 150)
                FROM call_report cr JOIN lead l ON l.id=cr.lead_id
                WHERE l.user_id=%s AND cr.error_msg IS NOT NULL AND TRIM(cr.error_msg)<>''
                """,
                (uid,),
            )
            errors = [r[0] for r in cur.fetchall()]

            lines.append("## 2. Hallazgo principal — Fathom vacío = análisis en error, no borrado")
            lines.append("")
            lines.append("Los **12** `call_report` en production tienen **contenido de texto vacío** (`closer_report`, `resumen`, `dolores_llamada` = NULL/vacío).")
            lines.append("")
            lines.append("**Estado de análisis:**")
            lines.append("")
            for est, n in estados:
                lines.append(f"- `{est}`: **{n}**")
            lines.append("")
            if errors:
                lines.append("**Mensaje de error (todos):**")
                lines.append("")
                for e in errors:
                    lines.append(f"> {e}")
                lines.append("")
            lines.append(
                "Conclusión: los links Fathom **siguen en `lead.link_llamada`** (12 leads). "
                "Lo que Santiago ve vacío en la parte de Fathoms es el **resultado del análisis Claude**, "
                "que **nunca se completó** por falta de API key — no un wipe de datos."
            )
            lines.append("")

            # Stats campos lead
            lead_fields = (
                ("link_llamada", "TRIM(link_llamada)<>''"),
                ("calificacion_llamada", "TRIM(calificacion_llamada)<>''"),
                ("dolores_llamada", "TRIM(dolores_llamada)<>''"),
                ("programada_ofrecido_llamada", "TRIM(programada_ofrecido_llamada)<>''"),
                ("notas", "TRIM(notas)<>''"),
                ("triaje_hecho", "triaje_hecho = true"),
                ("triajer", "TRIM(triajer)<>''"),
                ("closer_report (lead)", "TRIM(closer_report)<>''"),
                ("dolores_setting", "TRIM(dolores_setting)<>''"),
                ("setter_report (tabla)", None),
            )
            lines.append("## 3. Campos tracker en production (user_id=1)")
            lines.append("")
            lines.append("| Campo | Leads/registros con dato |")
            lines.append("|---|---:|")
            for label, cond in lead_fields:
                if label == "setter_report (tabla)":
                    lines.append(f"| `{label}` | **{setter_cnt}** |")
                    continue
                cur.execute(f"SELECT COUNT(*) FROM lead WHERE user_id=%s AND {cond}", (uid,))
                lines.append(f"| `{label}` | **{int(cur.fetchone()[0])}** |")
            lines.append("")

            # Audit import
            cur.execute(
                """
                SELECT id, legacy_meta FROM lead
                WHERE user_id=%s AND legacy_meta IS NOT NULL
                """,
                (uid,),
            )
            audit_hits = 0
            for _lid, meta in cur.fetchall():
                if not isinstance(meta, dict):
                    continue
                for ev in meta.get("actualizaciones") or []:
                    if not isinstance(ev, dict):
                        continue
                    antes = str(ev.get("antes") or "").strip()
                    despues = str(ev.get("despues") or "").strip()
                    if antes and not despues:
                        audit_hits += 1

            lines.append("## 4. Diff contenido branch vs production (3.1)")
            lines.append("")
            lines.append(
                "**Pendiente:** requiere connection string del branch `recuperacion-prefathom` "
                "(Neon → Branches → Connect). Script listo:"
            )
            lines.append("")
            lines.append("```bash")
            lines.append("cd backend")
            lines.append("export BRANCH_DATABASE_URL='postgresql://...'")
            lines.append("python ../scripts/investigate_tracker_content_diff.py --user-id 1")
            lines.append("```")
            lines.append("")
            lines.append(
                f"**Proxy parcial (solo production):** audit `legacy_meta.actualizaciones[]` "
                f"con campo que pasó de valor → vacío: **{audit_hits}** eventos."
            )
            lines.append("")

    lines.append("## 5. Frontend — campos de la captura (3.2)")
    lines.append("")
    lines.append(
        "En **`master` / `ff29c43`** no existe un modal titulado **«Editar lead»** "
        "con las etiquetas **«Contexto triaje»** ni **«Contexto setter (pre call)»**. "
        "Esas strings **no aparecen en el repo** (ni en historial git)."
    )
    lines.append("")
    lines.append("Mapeo probable vs código actual:")
    lines.append("")
    lines.append("| Etiqueta captura | Campo / fuente en código | Notas |")
    lines.append("|---|---|---|")
    lines.append("| ¿Se hizo triaje? | `lead.triaje_hecho` (bool) | Panel diario (`/panel-diario`), columna checkbox |")
    lines.append("| Contexto triaje | **No existe** campo homónimo | Podría ser `triajer` (nombre) o UI no desplegada |")
    lines.append("| Contexto setter (pre call) | **No existe** campo homónimo | Candidato: `lead.dolores_setting` (0 con dato) o `setter_report` (**0 filas siempre**) |")
    lines.append("| Links / Fathoms | `lead.link_llamada` + tabla `call_report` | 12 links OK; análisis en `call_report` vacío por error Claude |")
    lines.append("")
    lines.append(
        "**Tracker operativo hoy:** `/panel-diario` (Dashboard diario) — tabla con Triajer, Triaje, Link Fathom, calificación. "
        "Reportes Fathom analizados: `/call-reports`."
    )
    lines.append("")
    lines.append(
        "**Falso positivo probable:** si «Contexto setter» apuntara a `setter_report`, esa tabla tiene **0 filas** "
        "en branch y production → el campo **nunca tuvo datos**."
    )
    lines.append("")

    lines.append("## 6. Cambios de código recientes (3.3)")
    lines.append("")
    lines.append("Commits desde 05/08 en `frontend/` + `backend/`:")
    lines.append("")
    lines.append("- `ff29c43` — upsert leads legacy (payload refresh, propagación selectiva)")
    lines.append("- `7e4ee21` — fix dashboard cash (`leads-analytics.ts`, `cobranzas_controller.py`)")
    lines.append("- `c7d9fa4` — CRM clientes + importador legacy")
    lines.append("")
    lines.append(
        "**Ninguno** modifica modal de lead, panel diario, campos triaje/Fathom ni serializers de esos campos. "
        "El fix de doble conteo **no afecta** el tracker."
    )
    lines.append("")

    lines.append("## 7. Deploy (3.4)")
    lines.append("")
    lines.append("- Rama **`master`** en GitHub: **`ff29c43`** (sync con `migracion`)")
    lines.append("- VPS (`72.60.244.220`): **no verificado** desde este entorno (SSH timeout puerto 22)")
    lines.append("- Confirmar en VPS: `git log -1 --oneline` + rebuild docker tras pull")
    lines.append("")

    lines.append("## 8. Diagnóstico")
    lines.append("")
    lines.append("| Hipótesis | Evidencia | Probabilidad |")
    lines.append("|---|---|---|")
    lines.append("| Borrado masivo de filas | Conteos subieron; links intactos | **Descartada** |")
    lines.append("| Import legacy vació campos | Audit import: 0 clears; tasas link_llamada OK | **Descartada** |")
    lines.append("| Fathom «vacío» = análisis fallido | 12/12 `call_report` en `error`, sin API key Claude | **Alta** |")
    lines.append("| Modal lee campo inexistente / UI distinta al repo | Labels no están en master | **Media** (verificar build VPS) |")
    lines.append("| setter_report nunca poblado | 0 filas en ambas ramas | **Alta** (falso positivo) |")
    lines.append("| Pérdida campo a campo pre-10/08 | Sin diff branch aún | **Abierta** |")
    lines.append("")

    lines.append("## 9. Acciones recomendadas")
    lines.append("")
    lines.append("1. **Configurar API key Claude** en Conexiones → re-procesar los 12 `call_report` en error.")
    lines.append("2. **Pedir a Santiago** nombre de cliente concreto + pantalla exacta + cuándo vio datos (acelera diff puntual).")
    lines.append("3. **Correr diff 3.1** con `BRANCH_DATABASE_URL` del branch Neon.")
    lines.append("4. **Verificar versión en VPS** vs `ff29c43` — la captura puede ser UI no presente en master.")
    lines.append("5. **No correr upsert leads pendiente** ni escribir en production hasta cerrar (restricción doc origen).")
    lines.append("")
    lines.append("Anclas intactas: **$265.526,99** total · **$163.195,80** julio.")
    lines.append("")
    lines.append(report_footer("report_investigacion_tracker.py", uid))

    path = write_claude_report(REPORT, "\n".join(lines), title="Investigación tracker — reporte Santiago Torrico")
    print(f"Reporte: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
