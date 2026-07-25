"""APScheduler: intervalos dinámicos para auto_sync_stories, auto_refresh_reels_metrics y Calendly.

Intervalo `0` = job pausado (desactivado).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.triggers.interval import IntervalTrigger

from src.services.sync_settings_service import (
    get_calendly_interval_minutes,
    get_reels_interval_minutes,
    get_stories_interval_minutes,
    is_sync_disabled,
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
    # Pausado / desactivado → sin próxima corrida
    if getattr(job, "next_run_time", None) is None:
        return None
    return job.next_run_time


def _set_job_interval(job_id: str, minutes: int, *, run_immediately: bool = False) -> None:
    if _scheduler is None:
        return
    job = _scheduler.get_job(job_id)
    if job is None:
        return
    if is_sync_disabled(minutes):
        try:
            _scheduler.pause_job(job_id)
        except Exception:
            pass
        return
    kwargs: dict[str, Any] = {"trigger": IntervalTrigger(minutes=int(minutes))}
    if run_immediately:
        kwargs["next_run_time"] = datetime.now(AR_TZ)
    _scheduler.reschedule_job(job_id, **kwargs)
    try:
        _scheduler.resume_job(job_id)
    except Exception:
        pass


def apply_sync_schedules(*, stories_run_immediately: bool = False) -> None:
    """Relee intervalos de BD y reprograma (o pausa) los jobs ya registrados."""
    if _scheduler is None:
        return
    stories_m = get_stories_interval_minutes()
    reels_m = get_reels_interval_minutes()
    calendly_m = get_calendly_interval_minutes()

    _set_job_interval(STORIES_JOB_ID, stories_m, run_immediately=stories_run_immediately)
    _set_job_interval(REELS_JOB_ID, reels_m)
    _set_job_interval(CALENDLY_JOB_ID, calendly_m)
