"""Fechas del token de Instagram guardadas en ApiConnection.credentials."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.models import ApiConnection

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
TOKEN_LIFETIME_DAYS = 60


def _iso_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return _as_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
        except Exception:
            return None
    return None


def resolve_instagram_token_dates(conn: ApiConnection | None) -> dict[str, str | None]:
    """Lee token_saved_at / token_expires_at desde credenciales (60 días de vigencia)."""
    if conn is None:
        return {"token_saved_at": None, "token_expires_at": None}

    creds = conn.credentials if isinstance(conn.credentials, dict) else {}
    if not str(creds.get("access_token") or "").strip():
        return {"token_saved_at": None, "token_expires_at": None}

    saved = _parse_dt(creds.get("token_saved_at"))
    expires = _parse_dt(creds.get("token_expires_at"))

    if saved is None and conn.updated_at is not None:
        saved = _as_utc(conn.updated_at)

    if expires is None and saved is not None:
        expires = saved + timedelta(days=TOKEN_LIFETIME_DAYS)

    return {
        "token_saved_at": _iso_dt(saved),
        "token_expires_at": _iso_dt(expires),
    }
