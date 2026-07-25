"""Acceso al panel admin de corrección (token firmado + contraseña)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from datetime import date, datetime, time as dt_time

from decouple import config

SECRET = (config("SECRET", default="atvmkt") or "atvmkt").encode()
ADMIN_PANEL_PASSWORD = (config("ADMIN_PANEL_PASSWORD", default="francoatv500k") or "").strip()
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 días


def verify_admin_password(password: str) -> bool:
    if not ADMIN_PANEL_PASSWORD:
        return False
    candidate = (password or "").strip()
    return hmac.compare_digest(candidate, ADMIN_PANEL_PASSWORD)


def _sign(body: str) -> str:
    return hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()


def create_admin_panel_token(user_id: int) -> str:
    exp = int(time.time()) + TOKEN_TTL_SECONDS
    body = f"{int(user_id)}:{exp}"
    raw = f"{body}:{_sign(body)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def verify_admin_panel_token(token: str, user_id: int) -> bool:
    if not token or not token.strip():
        return False
    try:
        decoded = base64.urlsafe_b64decode(token.strip().encode()).decode()
        body, sig = decoded.rsplit(":", 1)
        uid_str, exp_str = body.split(":", 1)
        if int(uid_str) != int(user_id):
            return False
        if int(exp_str) < int(time.time()):
            return False
        return hmac.compare_digest(sig, _sign(body))
    except Exception:
        return False


def parse_call_hora_for_date(hora: str, fecha: date) -> datetime:
    raw = (hora or "").strip()
    parts = raw.split(":")
    if len(parts) != 2:
        raise ValueError("Hora inválida (usar HH:MM).")
    hour = int(parts[0])
    minute = int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Hora inválida (usar HH:MM).")
    return datetime.combine(fecha, dt_time(hour=hour, minute=minute))
