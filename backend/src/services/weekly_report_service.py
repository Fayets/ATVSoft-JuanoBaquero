"""Generación de reportes semanales con Claude (Fathom + reportes closer)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

import httpx
from pony.orm import db_session, flush

from src.models import CallReport, CloserReport, Lead, TeamMember, WeeklyReport
from src.services.anthropic_service import (
    ANTHROPIC_API_URL,
    ANTHROPIC_VERSION,
    get_user_claude_api_key,
    normalize_claude_runtime_error,
)
from src.weekly_reports_export import sanitize_weekly_content

WEEKLY_MODEL = "claude-haiku-4-5-20251001"
MAX_OUTPUT_TOKENS = 8192
MAX_CALLS_IN_PROMPT = 25

WEEKLY_SYSTEM = """Sos el director de ventas de un equipo de closers de alto ticket (ATV / marketing).
Generás reportes semanales ejecutivos en español (Argentina), combinando:
1) Análisis Fathom de cada llamada del período
2) Reportes diarios numéricos del closer (llamadas, shows, cierres, calificados, ingreso)

Reglas de FORMATO (obligatorio — el texto se convierte a PDF profesional):
- PROHIBIDO: markdown de cualquier tipo (#, ##, **negrita**, *cursiva*, tablas |, ---, código, emojis).
- NO uses asteriscos para enfatizar; escribí texto plano.
- Cada sección principal: título en MAYÚSCULAS en su propia línea (ej: RESUMEN EJECUTIVO).
- Subsecciones (por llamada): MAYÚSCULAS cortas o "Nombre lead (fecha):" en línea aparte.
- Listas solo con guión y espacio: - item
- Métricas en líneas "Etiqueta: valor" (ej: Close rate: 100% (2/2 shows)).
- Basate SOLO en los datos provistos; no inventes llamadas ni cifras.
- Sé accionable: patrones, qué funcionó, qué mejorar, riesgos.
- Si faltan datos, mencionalo explícitamente.
- Tono profesional, directo, útil para el dueño del negocio, el closer y el equipo de marketing.
"""

WEEKLY_USER_TEMPLATE = """Generá el Reporte Semanal de Ventas para el período {semana_label}.

Datos numéricos del closer (por día):
{closer_block}

Análisis de llamadas Fathom ({llamadas_count} llamadas):
{calls_block}

Estructura obligatoria (títulos en MAYÚSCULAS, sin # ni tablas):

RESUMEN EJECUTIVO
(3-5 bullets)

MÉTRICAS CONSOLIDADAS
(líneas Etiqueta: valor — llamadas, shows, cierres, calificados, close rate, ticket, ingreso)

ANÁLISIS POR LLAMADA
(por cada lead: nombre, fecha, veredicto, insights clave)

PATRONES DETECTADOS
(fortalezas y oportunidades en bullets)

REPORTE CLOSER — CONSISTENCIA
(compará números diarios vs llamadas; gaps de datos)

RECOMENDACIONES
(3-5 acciones concretas)

ALERTAS
(solo si aplica; prioridad crítica/moderada en texto, sin emojis obligatorios)

FEEDBACK MARKETING
(sección obligatoria — pensada para el equipo de marketing; 4-6 bullets accionables)
Incluí: ángulos/hooks que funcionaron en llamadas, objeciones recurrentes útiles para contenido,
perfiles de lead que más convierten, ideas de reels/stories/email, copy sugerido, gaps de nurturing,
y qué piezas de contenido crear la próxima semana basándote SOLO en los datos del período.
"""

MAIN_SECTION_KEYS = frozenset(
    {
        "RESUMEN EJECUTIVO",
        "METRICAS CONSOLIDADAS",
        "ANALISIS POR LLAMADA",
        "PATRONES DETECTADOS",
        "REPORTE CLOSER — CONSISTENCIA",
        "REPORTE CLOSER - CONSISTENCIA",
        "RECOMENDACIONES",
        "ALERTAS",
        "CONCLUSION",
        "FEEDBACK MARKETING",
    }
)


def _normalize_section_key(text: str) -> str:
    import unicodedata

    nfkd = unicodedata.normalize("NFKD", (text or "").strip().upper())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def extract_feedback_marketing(contenido: str) -> str:
    """Extrae el bloque FEEDBACK MARKETING (o CONCLUSIÓN como fallback)."""
    raw = (contenido or "").strip()
    if not raw:
        return ""

    for section_key in ("FEEDBACK MARKETING", "CONCLUSION"):
        lines: list[str] = []
        capture = False
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped:
                if capture and lines:
                    lines.append("")
                continue
            key = _normalize_section_key(stripped)
            if key == section_key:
                capture = True
                continue
            if capture:
                if key in MAIN_SECTION_KEYS:
                    break
                lines.append(stripped)
        text = "\n".join(lines).strip()
        if text:
            return text
    return ""


def week_bounds(fecha: date) -> tuple[date, date]:
    """Semana lun–dom que contiene `fecha`."""
    start = fecha - timedelta(days=fecha.weekday())
    end = start + timedelta(days=6)
    return start, end


def normalize_period(
    fecha_inicio: date,
    fecha_fin: date,
    dias: list[date] | None = None,
) -> tuple[date, date, set[date]]:
    start, end = fecha_inicio, fecha_fin
    if start > end:
        raise ValueError("La fecha desde debe ser anterior o igual a la fecha hasta.")
    span = {start + timedelta(days=i) for i in range((end - start).days + 1)}
    if dias:
        included = {d for d in dias if d in span}
        if not included:
            raise ValueError("Seleccioná al menos un día dentro del rango.")
    else:
        included = span
    return start, end, included


def _fmt_week_label(start: date, end: date) -> str:
    return f"{start.strftime('%d/%m/%Y')} – {end.strftime('%d/%m/%Y')}"


def _lead_call_date(lead: Lead) -> date | None:
    if lead.call is None:
        return None
    return lead.call.date()


def _collect_closer_reports(user_id: int, included: set[date]) -> list[dict[str, Any]]:
    members: dict[int, str] = {}
    for m in list(TeamMember.select()):
        if int(m.user_id) == user_id:
            members[int(m.id)] = (m.nombre or "").strip()

    rows: list[dict[str, Any]] = []
    for report in list(CloserReport.select()):
        if int(report.user_id) != user_id:
            continue
        if report.fecha not in included:
            continue
        rows.append(
            {
                "fecha": report.fecha.isoformat(),
                "closer": members.get(int(report.member_id), "?"),
                "llamadas_agendadas": int(report.llamadas_agendadas),
                "shows": int(report.shows),
                "cierres": int(report.cierres),
                "calificados": int(report.calificados),
                "descalificados": int(report.descalificados),
                "ingreso": float(report.ingreso),
            }
        )
    rows.sort(key=lambda r: r["fecha"])
    return rows


def _collect_call_analyses(user_id: int, included: set[date]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    for report in list(CallReport.select()):
        if int(report.user_id) != user_id or (report.estado or "").strip().lower() != "listo":
            continue
        lead: Lead | None = None
        for row in list(Lead.select()):
            if int(row.id) == int(report.lead_id):
                lead = row
                break
        call_dt = lead.call if lead and lead.call else None
        if call_dt is None:
            call_dt = report.created_at
        if call_dt is None or call_dt.date() not in included:
            continue

        closer = (lead.closer or "").strip() if lead else ""
        status = (lead.status or lead.estado or "").strip() if lead else (report.status_llamada or "")

        items.append(
            {
                "lead": (report.lead_nombre or "").strip() or "Sin nombre",
                "fecha_llamada": call_dt.strftime("%Y-%m-%d %H:%M") if call_dt else "",
                "closer": closer,
                "status": status,
                "nivel_dolor": (report.nivel_dolor or "").strip(),
                "capacidad_decision": (report.capacidad_decision or "").strip(),
                "capacidad_economica": (report.capacidad_economica or "").strip(),
                "fit_real": (report.fit_real or "").strip(),
                "objecion_diagnostico": (report.objecion_diagnostico or "").strip(),
                "razon_real_no_cerrar": (report.razon_real_no_cerrar or "").strip(),
                "patrones_y_mejoras": (report.patrones_y_mejoras or "").strip(),
                "compromisos_prometidos": (report.compromisos_prometidos or "").strip(),
                "resumen": (report.resumen or "").strip(),
            }
        )

    items.sort(key=lambda x: x.get("fecha_llamada") or "")
    return items


def _format_closer_block(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "_(No hay reportes diarios del closer en esta semana.)_"
    lines = []
    for r in rows:
        lines.append(
            f"- {r['fecha']} ({r['closer']}): "
            f"{r['llamadas_agendadas']} llamadas, {r['shows']} shows, {r['cierres']} cierres, "
            f"{r['calificados']} calificados, {r['descalificados']} descalificados, "
            f"ingreso ${r['ingreso']:,.0f}"
        )
    return "\n".join(lines)


def _format_calls_block(items: list[dict[str, Any]]) -> str:
    if not items:
        return "_(No hay análisis Fathom listos para llamadas de esta semana.)_"
    chunks: list[str] = []
    for i, item in enumerate(items[:MAX_CALLS_IN_PROMPT], start=1):
        chunks.append(
            f"Llamada {i}: {item['lead']} ({item['fecha_llamada']})\n"
            f"- Closer: {item['closer'] or '—'}\n"
            f"- Status: {item['status'] or '—'}\n"
            f"- Dolor: {item['nivel_dolor'] or '—'}\n"
            f"- Fit: {item['fit_real'] or '—'}\n"
            f"- Objeción real: {item['objecion_diagnostico'] or '—'}\n"
            f"- Por qué no cerró / cierre: {item['razon_real_no_cerrar'] or '—'}\n"
            f"- Patrones/mejoras: {item['patrones_y_mejoras'] or '—'}\n"
        )
    if len(items) > MAX_CALLS_IN_PROMPT:
        chunks.append(
            f"\n_(+{len(items) - MAX_CALLS_IN_PROMPT} llamadas omitidas por límite; "
            "priorizá las incluidas en el análisis.)_"
        )
    return "\n".join(chunks)


def _call_claude_weekly(api_key: str, user_prompt: str) -> str:
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError(
            "Configurá tu API key de Claude en Conexiones API antes de generar reportes semanales."
        )
    try:
        with httpx.Client(timeout=240.0) as client:
            resp = client.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key": key,
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": WEEKLY_MODEL,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "system": WEEKLY_SYSTEM,
                    "messages": [{"role": "user", "content": user_prompt}],
                },
            )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Error de red al llamar a Anthropic: {exc}") from exc

    if resp.status_code != 200:
        try:
            data = resp.json()
        except ValueError:
            data = {}
        err = data.get("error") if isinstance(data, dict) else None
        msg = ""
        if isinstance(err, dict):
            msg = str(err.get("message") or err.get("type") or "")
        if not msg:
            msg = (resp.text or "")[:800]
        raise RuntimeError(normalize_claude_runtime_error(msg or f"HTTP {resp.status_code}"))

    payload = resp.json()
    blocks = payload.get("content") if isinstance(payload, dict) else None
    parts: list[str] = []
    if isinstance(blocks, list):
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
    text = "\n".join(parts).strip()
    if not text:
        raise RuntimeError("Claude devolvió una respuesta vacía.")
    return text


@db_session
def preview_weekly_data(
    user_id: int,
    fecha_inicio: date,
    fecha_fin: date,
    dias: list[date] | None = None,
) -> dict[str, Any]:
    start, end, included = normalize_period(fecha_inicio, fecha_fin, dias)
    closer_rows = _collect_closer_reports(user_id, included)
    call_items = _collect_call_analyses(user_id, included)
    return {
        "semana_inicio": start,
        "semana_fin": end,
        "llamadas_count": len(call_items),
        "closer_dias_count": len(closer_rows),
        "dias_seleccionados": len(included),
    }


@db_session
def generate_weekly_report(
    user_id: int,
    fecha_inicio: date,
    fecha_fin: date,
    dias: list[date] | None = None,
) -> WeeklyReport:
    start, end, included = normalize_period(fecha_inicio, fecha_fin, dias)
    closer_rows = _collect_closer_reports(user_id, included)
    call_items = _collect_call_analyses(user_id, included)

    if not closer_rows and not call_items:
        raise ValueError(
            "No hay análisis Fathom ni reportes diarios del closer para los días seleccionados."
        )

    existing = [
        r
        for r in list(WeeklyReport.select())
        if int(r.user_id) == user_id and r.semana_inicio == start and r.semana_fin == end
    ]
    if existing:
        row = existing[0]
    else:
        row = WeeklyReport(
            user_id=user_id,
            semana_inicio=start,
            semana_fin=end,
            estado="generando",
            llamadas_count=len(call_items),
            closer_dias_count=len(closer_rows),
        )
        flush()

    row.semana_fin = end
    row.estado = "generando"
    row.error_msg = ""
    row.llamadas_count = len(call_items)
    row.closer_dias_count = len(closer_rows)
    row.updated_at = datetime.utcnow()

    api_key = get_user_claude_api_key(user_id)
    user_prompt = WEEKLY_USER_TEMPLATE.format(
        semana_label=_fmt_week_label(start, end),
        closer_block=_format_closer_block(closer_rows),
        calls_block=_format_calls_block(call_items),
        llamadas_count=len(call_items),
    )

    try:
        contenido = sanitize_weekly_content(_call_claude_weekly(api_key, user_prompt))
        row.contenido = contenido
        row.feedback_marketing = extract_feedback_marketing(contenido)
        row.estado = "listo"
        row.error_msg = ""
    except Exception as exc:
        row.estado = "error"
        row.error_msg = str(exc)[:2000]
        row.contenido = ""
        row.feedback_marketing = ""

    row.updated_at = datetime.utcnow()
    return row
