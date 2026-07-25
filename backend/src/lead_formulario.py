"""Formulario GHL del calendar: 7 preguntas de calificación (contacto vive en columnas del Lead)."""

from __future__ import annotations

from typing import Any

# Keys canónicas persistidas en Lead.formulario (JSON)
FORMULARIO_KEYS: tuple[str, ...] = (
    "forma_agendamiento",
    "conoce_juano",
    "tiempo_siguiendo",
    "experiencia_youtube",
    "urgencia",
    "dinero_disponible",
    "alguien_mas_reunion",
)

FORMULARIO_LABELS: dict[str, str] = {
    "forma_agendamiento": "1) ¿De qué forma te agendaste?",
    "conoce_juano": "2) ¿De dónde conoces a Juano?",
    "tiempo_siguiendo": "3) ¿Hace cuánto tiempo sigues a Juano?",
    "experiencia_youtube": "4) ¿Qué experiencia tienes con YouTube?",
    "urgencia": "5) ¿Qué tan pronto quieres resolver estos obstáculos?",
    "dinero_disponible": "6) ¿Cuánto dinero disponible tienes para iniciar HOY MISMO?",
    "alguien_mas_reunion": "7) ¿Debe estar alguien más presente en la reunión?",
}

# Substrings para matchear keys variables del webhook GHL
_FORMULARIO_NEEDLES: dict[str, tuple[str, ...]] = {
    "forma_agendamiento": (
        "de qué forma te agendaste",
        "de que forma te agendaste",
        "forma te agendaste",
    ),
    "conoce_juano": (
        "de donde conoces a juano",
        "de dónde conoces a juano",
        "de donde conces a juano",
        "conoces a juano",
        "conces a juano",
    ),
    "tiempo_siguiendo": (
        "hace cuanto tiempo sigues",
        "hace cuánto tiempo sigues",
        "tiempo sigues a juano",
    ),
    "experiencia_youtube": (
        "experiencia tienes con youtube",
        "experiencia con youtube",
    ),
    "urgencia": (
        "qué tan pronto quieres resolver",
        "que tan pronto quieres resolver",
        "resolver estos obstáculos",
    ),
    "dinero_disponible": (
        "dinero disponible tienes para iniciar",
        "cuánto dinero disponible",
        "cuanto dinero disponible",
        "iniciar hoy mismo",
    ),
    "alguien_mas_reunion": (
        "alguien más presente",
        "alguien mas presente",
        "aparte de ti",
        "debes consultarle",
    ),
}


def empty_formulario() -> dict[str, str]:
    return {k: "" for k in FORMULARIO_KEYS}


def normalize_formulario(raw: Any) -> dict[str, str]:
    """Normaliza un dict/JSON a las 7 keys (strings). Ignora claves desconocidas."""
    out = empty_formulario()
    if not isinstance(raw, dict):
        return out
    for k in FORMULARIO_KEYS:
        v = raw.get(k)
        if v is None:
            continue
        out[k] = str(v).strip()
    return out


def formulario_answered_count(raw: Any) -> int:
    data = normalize_formulario(raw)
    return sum(1 for k in FORMULARIO_KEYS if data.get(k))


def _pick_by_needles(body: dict[str, Any], needles: tuple[str, ...]) -> str:
    if not body:
        return ""
    # Exact / casefold match on full key
    for needle in needles:
        nlow = needle.casefold()
        for k, v in body.items():
            if str(k).casefold() == nlow and v is not None and str(v).strip():
                return str(v).strip()
    # Substring match
    for needle in needles:
        nlow = needle.casefold()
        for k, v in body.items():
            if nlow in str(k).casefold() and v is not None and str(v).strip():
                return str(v).strip()
    return ""


def extract_formulario_from_ghl_body(body: dict[str, Any]) -> dict[str, str]:
    """Extrae las 7 respuestas desde el payload plano del webhook GHL."""
    out = empty_formulario()
    if not isinstance(body, dict):
        return out
    for key, needles in _FORMULARIO_NEEDLES.items():
        out[key] = _pick_by_needles(body, needles)
    return out


def merge_formulario(existing: Any, incoming: dict[str, str] | None) -> dict[str, str]:
    """Merge: valores no vacíos de incoming pisan existing."""
    base = normalize_formulario(existing)
    if not incoming:
        return base
    for k in FORMULARIO_KEYS:
        v = (incoming.get(k) or "").strip()
        if v:
            base[k] = v
    return base
