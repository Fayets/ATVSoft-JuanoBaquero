"""APScheduler: intervalos dinámicos para auto_sync_stories, auto_refresh_reels_metrics y Calendly."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.triggers.interval import IntervalTrigger

from src.services.sync_settings_service import (
    get_calendly_interval_minutes,
    get_reels_interval_minutes,
    get_stories_interval_minutes,
)

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
STORIES_JOB_ID = "auto_sync_stories"
REELS_JOB_ID = "auto_refresh_reels_metrics"
CALENDLY_JOB_ID = "auto_sync_calendly"

_scheduler: Any | None = None


def bind_sync_scheduler(scheduler: Any) -> None:
    global _scheduler
    _scheduler = scheduler


def next_job_run_time(job_id: str) -> datetime | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job(job_id)
    if job is None:
        return None
    return job.next_run_time


def apply_sync_schedules(*, stories_run_immediately: bool = False) -> None:
    """Relee intervalos de BD y reprograma los jobs ya registrados en el scheduler."""
    if _scheduler is None:
        return
    stories_m = get_stories_interval_minutes()
    reels_m = get_reels_interval_minutes()
    calendly_m = get_calendly_interval_minutes()

    stories_job = _scheduler.get_job(STORIES_JOB_ID)
    if stories_job is not None:
        kwargs: dict[str, Any] = {"trigger": IntervalTrigger(minutes=stories_m)}
        if stories_run_immediately:
            kwargs["next_run_time"] = datetime.now(AR_TZ)
        _scheduler.reschedule_job(STORIES_JOB_ID, **kwargs)

    reels_job = _scheduler.get_job(REELS_JOB_ID)
    if reels_job is not None:
        _scheduler.reschedule_job(REELS_JOB_ID, trigger=IntervalTrigger(minutes=reels_m))

    calendly_job = _scheduler.get_job(CALENDLY_JOB_ID)
    if calendly_job is not None:
        _scheduler.reschedule_job(
            CALENDLY_JOB_ID,
            trigger=IntervalTrigger(minutes=calendly_m),
        )
