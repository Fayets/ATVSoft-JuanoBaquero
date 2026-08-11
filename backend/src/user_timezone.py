"""Timezone del tenant (AuthUser.timezone) — alineado con frontend/shared/lib/timezone.ts."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "America/Bogota"

ALLOWED_TIMEZONES = frozenset(
    {
        "America/Bogota",
        "America/Argentina/Buenos_Aires",
        "America/Mexico_City",
        "Europe/Madrid",
        "America/Caracas",
        "America/Lima",
        "America/Santiago",
        "America/New_York",
    }
)


def normalize_timezone_name(raw: str | None) -> str:
    tz = (raw or "").strip()
    if tz in ALLOWED_TIMEZONES:
        return tz
    return DEFAULT_TIMEZONE


def zoneinfo_from_name(raw: str | None) -> ZoneInfo:
    return ZoneInfo(normalize_timezone_name(raw))


def today_in_zone(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()
