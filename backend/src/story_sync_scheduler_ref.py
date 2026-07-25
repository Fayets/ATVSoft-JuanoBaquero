"""Compat: próxima corrida del job de historias (usa sync_scheduler_service)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.services.sync_scheduler_service import STORIES_JOB_ID, bind_sync_scheduler, next_job_run_time


def bind_stories_scheduler(scheduler: Any) -> None:
    bind_sync_scheduler(scheduler)


def next_auto_sync_stories_run_time() -> datetime | None:
    return next_job_run_time(STORIES_JOB_ID)
