"""Verificación de API key Anthropic (auth, saldo)."""

from __future__ import annotations

import time
from typing import Literal

import httpx
from pony.orm import db_session

from src.models import ApiConnection

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
# Modelos válidos para la sonda (Haiku es la más barata; Sonnet como respaldo).
PROBE_MODELS = (
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
)

ClaudeStatusKind = Literal[
    "not_configured",
    "ok",
    "no_balance",
    "invalid_key",
    "permission_denied",
    "rate_limited",
    "unavailable",
]

BILLING_MESSAGE_ES = (
    "No tenés saldo disponible en tu cuenta de Anthropic. "
    "Recargá créditos en console.anthropic.com → Plans & Billing."
)

INVALID_KEY_MESSAGE_ES = (
    "La API key de Anthropic no es válida. Revisala en Conexiones API."
)

_STATUS_CACHE: dict[int, tuple[float, dict]] = {}
_STATUS_CACHE_TTL_SEC = 60.0


def mask_api_key(api_key: str) -> str:
    key = (api_key or "").strip()
    if len(key) <= 12:
        return "••••"
    return f"{key[:7]}...{key[-4:]}"


def get_user_claude_api_key(user_id: int) -> str:
    with db_session:
        conn = ApiConnection.get(user_id=user_id, platform="claude")
        if conn and isinstance(conn.credentials, dict):
            return str(conn.credentials.get("api_key") or "").strip()
    return ""


def normalize_claude_runtime_error(raw: str) -> str:
    """Traduce errores de Claude CLI / API a mensajes claros en español."""
    text = (raw or "").strip()
    lower = text.lower()
    if (
        "billing_error" in lower
        or "credit balance" in lower
        or "too low to access the anthropic api" in lower
        or "plans & billing" in lower
    ):
        return BILLING_MESSAGE_ES
    if (
        "authentication_error" in lower
        or "invalid x-api-key" in lower
        or "invalid api key" in lower
    ):
        return INVALID_KEY_MESSAGE_ES
    if "permission_error" in lower:
        return "Tu API key de Anthropic no tiene permisos para usar este recurso."
    if "rate_limit_error" in lower or "rate limit" in lower:
        return "Se alcanzó el límite de uso de Anthropic. Probá de nuevo en unos minutos."
    return text[:2000]


def _status_from_response(status_code: int, data: dict, masked: str) -> dict:
    error_obj = data.get("error") if isinstance(data, dict) else {}
    error_type = ""
    error_message = ""
    if isinstance(error_obj, dict):
        error_type = str(error_obj.get("type") or "")
        error_message = str(error_obj.get("message") or "")

    lower_msg = error_message.lower()
    if (
        status_code == 402
        or error_type == "billing_error"
        or "credit balance" in lower_msg
        or "too low to access the anthropic api" in lower_msg
    ):
        return {
            "status": "no_balance",
            "message": BILLING_MESSAGE_ES,
            "api_key_masked": masked,
        }
    if status_code == 401 or error_type == "authentication_error":
        return {
            "status": "invalid_key",
            "message": INVALID_KEY_MESSAGE_ES,
            "api_key_masked": masked,
        }
    if status_code == 403 or error_type == "permission_error":
        return {
            "status": "permission_denied",
            "message": "Tu API key de Anthropic no tiene permisos para usar este recurso.",
            "api_key_masked": masked,
        }
    if status_code == 429 or error_type == "rate_limit_error":
        return {
            "status": "rate_limited",
            "message": "Se alcanzó el límite de uso de Anthropic. Probá de nuevo en unos minutos.",
            "api_key_masked": masked,
        }
    if status_code == 404 and "model" in lower_msg:
        return {
            "status": "unavailable",
            "message": "No se pudo verificar la API key: el modelo de prueba no está disponible.",
            "api_key_masked": masked,
        }

    detail = error_message or f"HTTP {status_code}"
    return {
        "status": "unavailable",
        "message": f"No se pudo verificar la API key de Claude: {detail}",
        "api_key_masked": masked,
    }


def check_claude_api_status(api_key: str) -> dict:
    key = (api_key or "").strip()
    if not key:
        return {
            "status": "not_configured",
            "message": "Configurá tu API key de Claude en Conexiones API.",
            "api_key_masked": None,
        }

    masked = mask_api_key(key)
    last_result: dict | None = None
    try:
        with httpx.Client(timeout=20.0) as client:
            for model in PROBE_MODELS:
                resp = client.post(
                    ANTHROPIC_API_URL,
                    headers={
                        "x-api-key": key,
                        "anthropic-version": ANTHROPIC_VERSION,
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ok"}],
                    },
                )
                if resp.status_code == 200:
                    return {
                        "status": "ok",
                        "message": "API key activa y con saldo disponible.",
                        "api_key_masked": masked,
                    }

                try:
                    data = resp.json()
                except ValueError:
                    data = {}
                if not isinstance(data, dict):
                    data = {}
                last_result = _status_from_response(resp.status_code, data, masked)

                error_obj = data.get("error") if isinstance(data, dict) else {}
                error_type = ""
                error_message = ""
                if isinstance(error_obj, dict):
                    error_type = str(error_obj.get("type") or "")
                    error_message = str(error_obj.get("message") or "")
                # Si el modelo no existe, probar el siguiente; otros errores cortan.
                if resp.status_code == 404 and "model" in error_message.lower():
                    continue
                if error_type not in ("", "invalid_request_error") or resp.status_code != 404:
                    return last_result
    except httpx.RequestError as exc:
        return {
            "status": "unavailable",
            "message": f"No se pudo verificar la API key de Claude: {exc}",
            "api_key_masked": masked,
        }

    if last_result:
        return last_result

    return {
        "status": "unavailable",
        "message": "No se pudo verificar la API key de Claude.",
        "api_key_masked": masked,
    }


def get_claude_status_for_user(user_id: int, *, use_cache: bool = True) -> dict:
    now = time.time()
    if use_cache:
        cached = _STATUS_CACHE.get(user_id)
        if cached and now - cached[0] < _STATUS_CACHE_TTL_SEC:
            return cached[1]

    api_key = get_user_claude_api_key(user_id)
    result = check_claude_api_status(api_key)
    if use_cache:
        _STATUS_CACHE[user_id] = (now, result)
    return result


def invalidate_claude_status_cache(user_id: int) -> None:
    _STATUS_CACHE.pop(user_id, None)
