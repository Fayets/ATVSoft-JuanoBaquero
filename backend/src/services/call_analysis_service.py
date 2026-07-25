"""Análisis de transcripciones vía Anthropic Messages API (sin Claude CLI)."""

from __future__ import annotations

import json
import re

import httpx

from src.services.anthropic_service import (
    ANTHROPIC_API_URL,
    ANTHROPIC_VERSION,
    normalize_claude_runtime_error,
)

# Haiku: extracción estructurada a ~1/3 del costo de Sonnet.
ANALYSIS_MODEL = "claude-haiku-4-5-20251001"
MAX_TRANSCRIPT_CHARS = 30_000
# Respuestas verbosas truncaban el JSON a 2500; 8192 deja margen.
MAX_OUTPUT_TOKENS = 8192

ANALYSIS_RESULT_KEYS = (
    "nivel_dolor",
    "capacidad_decision",
    "capacidad_economica",
    "fit_real",
    "objecion_diagnostico",
    "cambio_energia",
    "objecion_no_manejada",
    "razon_real_no_cerrar",
    "compromisos_prometidos",
    "patrones_y_mejoras",
)

ANALYSIS_SYSTEM = """Sos un coach de closers de ventas de alto ticket. Analizás transcripciones de llamadas
(formato "Hablante: texto") para calificar al lead y mejorar al closer.

Reglas OBLIGATORIAS:
- Respondé ÚNICAMENTE un objeto JSON válido. Prohibido markdown (##, **, fences ```), títulos fuera del JSON o prosa alrededor.
- Sé completo y útil: desarrollá cada campo con la evidencia necesaria (citas, momentos, matices).
- No te vayas de tema: nada de relleno, digresiones ni teoría genérica de ventas. Solo lo que se ve en ESTA llamada.
- LEGIBILIDAD: cada valor debe ser texto ESTRUCTURADO y fácil de escanear. Usá saltos de línea reales (\\n) y viñetas con "- ".
  Patrón preferido por campo:
  1) primera línea = veredicto corto (ej. "Alto", "Decide solo", "Buen fit")
  2) luego hasta 4 bullets "- ..." de UNA línea (~120 caracteres máx.), sin citas literales largas
  3) NO uses líneas "Cita: \\"...\\"" con transcripción verbatim; resumí la evidencia en pocas palabras
  4) si hay contraste (superficie vs real), usá sub-rótulos en una línea, ej. "Superficie:" / "Real:"
- No inventes: si no hay evidencia, usá "No se evidencia en la llamada".
- Si la llamada cerró, en razon_real_no_cerrar: primera línea "Cerró" + bullets con por qué sí.
- Priorizá señales de los primeros ~10 minutos para capacidad_decision.
- Escapá comillas internas con \\" dentro de los strings JSON.
"""

ANALYSIS_USER_TEMPLATE = """Analizá la transcripción. Devolvé UN solo JSON con estas 10 claves (strings estructurados con \\n y "- ").

BLOQUE 1 — Calificación:
1. nivel_dolor: urgencia real (bajo/medio/alto) + dolor profundo (no superficial), con evidencia.
2. capacidad_decision: ¿decide solo/a o consulta pareja/socio? Detectalo temprano (ideal: primeros 10 min).
3. capacidad_economica: señales de pago (inversiones, compras, tools). ¿Precio = objeción real o de percepción de valor?
4. fit_real: ¿el programa puede ayudarlo? Si está fuera del ICP, decilo (mejor no cerrar).
5. objecion_diagnostico: superficie vs real (el precio casi nunca es el problema; suele ser confianza / "¿funcionará para mí?").

BLOQUE 2 — Coaching:
6. cambio_energia: cuándo cambió la energía del lead (momento/cita + qué pasó).
7. objecion_no_manejada: qué objeción no se manejó bien (o se esquivó).
8. razon_real_no_cerrar: razón diagnosticada (no la que dio el lead). Si cerró: "Cerró" + por qué.

Extra:
9. compromisos_prometidos: promesas, entregables, fechas, condiciones, follow-ups (lista).
10. patrones_y_mejoras: patrones + puntos de mejora para el closer (listas separadas).

Ejemplo de estilo (un campo):
"Alto\\n\\n- Dolor profundo: falta de sistema de adquisición\\n- Urgencia: agendó ayer\\n- Lead reconoce 500 DMs sin responder"

Formato (sin nada alrededor):
{{"nivel_dolor":"...","capacidad_decision":"...","capacidad_economica":"...","fit_real":"...","objecion_diagnostico":"...","cambio_energia":"...","objecion_no_manejada":"...","razon_real_no_cerrar":"...","compromisos_prometidos":"...","patrones_y_mejoras":"..."}}

--- TRANSCRIPCIÓN ---

{transcript}
"""


def _truncate_transcript(text: str, max_chars: int = MAX_TRANSCRIPT_CHARS) -> str:
    raw = (text or "").strip()
    if len(raw) <= max_chars:
        return raw
    head = max_chars * 2 // 3
    tail = max_chars - head - 80
    return (
        raw[:head]
        + "\n\n[...tramo intermedio omitido por longitud...]\n\n"
        + raw[-tail:]
    )


def _strip_code_fences(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    # A veces el modelo envuelve solo el bloque interior.
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t, flags=re.IGNORECASE)
        if m:
            t = m.group(1).strip()
    return t.strip()


def _unescape_json_string(fragment: str) -> str:
    try:
        return json.loads(f'"{fragment}"')
    except json.JSONDecodeError:
        return (
            fragment.replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _extract_fields_regex(text: str) -> dict[str, str]:
    """Recupera campos aunque el JSON esté truncado o mal cerrado."""
    out: dict[str, str] = {}
    for key in ANALYSIS_RESULT_KEYS:
        m = re.search(
            rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"',
            text,
        )
        if m:
            out[key] = _unescape_json_string(m.group(1)).strip()
            continue
        # Campo abierto sin comilla de cierre (truncado por max_tokens).
        m2 = re.search(rf'"{re.escape(key)}"\s*:\s*"(.*)\Z', text, flags=re.DOTALL)
        if m2:
            raw_val = m2.group(1).rstrip().rstrip('"').rstrip(",")
            out[key] = _unescape_json_string(raw_val).strip()
    return out


def _parse_json_lenient(raw: str) -> dict:
    text = _strip_code_fences(raw)
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        chunk = text[start : end + 1]
        try:
            parsed = json.loads(chunk)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    partial = _extract_fields_regex(text if start < 0 else text[start:])
    if partial:
        return partial
    raise ValueError("Claude no devolvió JSON válido.")


def _empty_result() -> dict[str, str]:
    return {k: "" for k in ANALYSIS_RESULT_KEYS}


def run_call_analysis(transcript_text: str, api_key: str) -> dict[str, str]:
    """Una sola llamada a Messages API: calificación + coaching + trazabilidad."""
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError(
            "Configurá tu API key de Claude en Conexiones API antes de analizar llamadas."
        )

    transcript = _truncate_transcript(transcript_text)
    if not transcript:
        raise RuntimeError("La transcripción de Fathom vino vacía; no hay nada para analizar.")

    user_content = ANALYSIS_USER_TEMPLATE.format(transcript=transcript)
    try:
        with httpx.Client(timeout=180.0) as client:
            resp = client.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key": key,
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": ANALYSIS_MODEL,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "system": ANALYSIS_SYSTEM,
                    "messages": [{"role": "user", "content": user_content}],
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

    try:
        payload = resp.json()
    except ValueError as exc:
        raise RuntimeError("Respuesta inválida de Anthropic.") from exc

    blocks = payload.get("content") if isinstance(payload, dict) else None
    text_parts: list[str] = []
    if isinstance(blocks, list):
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(str(block.get("text") or ""))
    raw_text = "\n".join(text_parts).strip()
    if not raw_text:
        raise RuntimeError("Claude devolvió una respuesta vacía.")

    try:
        parsed = _parse_json_lenient(raw_text)
    except (ValueError, json.JSONDecodeError) as exc:
        stop = ""
        if isinstance(payload, dict):
            stop = str(payload.get("stop_reason") or "")
        hint = " (respuesta truncada por límite de tokens)" if stop == "max_tokens" else ""
        raise RuntimeError(
            f"Claude no devolvió la ficha JSON{hint}: {raw_text[:500]}"
        ) from exc

    out = _empty_result()
    for key_name in ANALYSIS_RESULT_KEYS:
        out[key_name] = str(parsed.get(key_name) or "").strip()
    if not any(out.values()):
        raise RuntimeError(f"Claude no devolvió campos útiles: {raw_text[:500]}")
    return out
