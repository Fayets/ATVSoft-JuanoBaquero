"""Intervalos de sync automático (historias / reels / calendly), persistidos en BD.

`0` = desactivado (el job no corre en el scheduler).
"""

from __future__ import annotations

from datetime import datetime

from pony.orm import db_session

from src.models import AppSyncSettings

DEFAULT_STORIES_INTERVAL_MINUTES = 5
DEFAULT_REELS_INTERVAL_MINUTES = 1440  # ~24 h
DEFAULT_CALENDLY_INTERVAL_MINUTES = 360  # 6 h
# 0 = desactivado; si está activo, el mínimo es 1 (Calendly activo: 60)
DISABLED_INTERVAL_MINUTES = 0
MIN_SYNC_INTERVAL_MINUTES = 1
MAX_SYNC_INTERVAL_MINUTES = 10080  # 7 días
MIN_CALENDLY_INTERVAL_MINUTES = 60
MAX_CALENDLY_INTERVAL_MINUTES = 10080


def _clamp_interval(minutes: int) -> int:
    m = int(minutes)
    if m <= DISABLED_INTERVAL_MINUTES:
        return DISABLED_INTERVAL_MINUTES
    return max(MIN_SYNC_INTERVAL_MINUTES, min(MAX_SYNC_INTERVAL_MINUTES, m))


def _clamp_calendly_interval(minutes: int) -> int:
    m = int(minutes)
    if m <= DISABLED_INTERVAL_MINUTES:
        return DISABLED_INTERVAL_MINUTES
    return max(MIN_CALENDLY_INTERVAL_MINUTES, min(MAX_CALENDLY_INTERVAL_MINUTES, m))


def is_sync_disabled(minutes: int) -> bool:
    return int(minutes) <= DISABLED_INTERVAL_MINUTES


def _ensure_row() -> AppSyncSettings:
    row = AppSyncSettings.get(id=1)
    if row is None:
        row = AppSyncSettings(
            id=1,
            stories_interval_minutes=DEFAULT_STORIES_INTERVAL_MINUTES,
            reels_interval_minutes=DEFAULT_REELS_INTERVAL_MINUTES,
            calendly_interval_minutes=DEFAULT_CALENDLY_INTERVAL_MINUTES,
            updated_at=datetime.utcnow(),
        )
    return row


@db_session
def get_stories_interval_minutes() -> int:
    return _clamp_interval(_ensure_row().stories_interval_minutes)


@db_session
def get_reels_interval_minutes() -> int:
    return _clamp_interval(_ensure_row().reels_interval_minutes)


@db_session
def get_calendly_interval_minutes() -> int:
    row = _ensure_row()
    raw = getattr(row, "calendly_interval_minutes", None)
    if raw is None:
        return DEFAULT_CALENDLY_INTERVAL_MINUTES
    return _clamp_calendly_interval(int(raw))


@db_session
def get_sync_settings_dict() -> dict[str, int]:
    row = _ensure_row()
    raw_cal = getattr(row, "calendly_interval_minutes", None)
    calendly = (
        DEFAULT_CALENDLY_INTERVAL_MINUTES
        if raw_cal is None
        else _clamp_calendly_interval(int(raw_cal))
    )
    return {
        "stories_interval_minutes": _clamp_interval(row.stories_interval_minutes),
        "reels_interval_minutes": _clamp_interval(row.reels_interval_minutes),
        "calendly_interval_minutes": calendly,
    }


@db_session
def update_sync_settings(
    *,
    stories_interval_minutes: int | None = None,
    reels_interval_minutes: int | None = None,
    calendly_interval_minutes: int | None = None,
) -> dict[str, int]:
    row = _ensure_row()
    if stories_interval_minutes is not None:
        row.stories_interval_minutes = _clamp_interval(stories_interval_minutes)
    if reels_interval_minutes is not None:
        row.reels_interval_minutes = _clamp_interval(reels_interval_minutes)
    if calendly_interval_minutes is not None:
        row.calendly_interval_minutes = _clamp_calendly_interval(calendly_interval_minutes)
    row.updated_at = datetime.utcnow()
    raw_cal = getattr(row, "calendly_interval_minutes", None)
    calendly = (
        DEFAULT_CALENDLY_INTERVAL_MINUTES
        if raw_cal is None
        else _clamp_calendly_interval(int(raw_cal))
    )
    return {
        "stories_interval_minutes": _clamp_interval(row.stories_interval_minutes),
        "reels_interval_minutes": _clamp_interval(row.reels_interval_minutes),
        "calendly_interval_minutes": calendly,
    }
