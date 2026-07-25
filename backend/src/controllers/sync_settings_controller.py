from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from src.schemas import SyncSettingsOut, SyncSettingsPatch
from src.services.stories_service import StoriesService
from src.services.sync_scheduler_service import (
    CALENDLY_JOB_ID,
    REELS_JOB_ID,
    STORIES_JOB_ID,
    apply_sync_schedules,
    next_job_run_time,
)
from src.services.sync_settings_service import (
    MAX_CALENDLY_INTERVAL_MINUTES,
    MAX_SYNC_INTERVAL_MINUTES,
    MIN_CALENDLY_INTERVAL_MINUTES,
    MIN_SYNC_INTERVAL_MINUTES,
    get_sync_settings_dict,
    update_sync_settings,
)

router = APIRouter(prefix="/api/settings/sync", tags=["settings"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _iso_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _build_out() -> SyncSettingsOut:
    data = get_sync_settings_dict()
    return SyncSettingsOut(
        stories_interval_minutes=data["stories_interval_minutes"],
        reels_interval_minutes=data["reels_interval_minutes"],
        calendly_interval_minutes=data["calendly_interval_minutes"],
        stories_next_sync=_iso_dt(next_job_run_time(STORIES_JOB_ID)),
        reels_next_sync=_iso_dt(next_job_run_time(REELS_JOB_ID)),
        calendly_next_sync=_iso_dt(next_job_run_time(CALENDLY_JOB_ID)),
        min_interval_minutes=MIN_SYNC_INTERVAL_MINUTES,
        max_interval_minutes=MAX_SYNC_INTERVAL_MINUTES,
        min_calendly_interval_minutes=MIN_CALENDLY_INTERVAL_MINUTES,
        max_calendly_interval_minutes=MAX_CALENDLY_INTERVAL_MINUTES,
    )


async def _sync_stories_for_user(user_id: str) -> None:
    try:
        result = await StoriesService().sync_instagram(user_id)
        print(f"[settings] Sync historias tras guardar OK user {user_id}: {result}")
    except Exception as e:
        print(f"[settings] Sync historias tras guardar FAILED user {user_id}: {e}")


@router.get("", response_model=SyncSettingsOut)
def get_sync_settings(_user_id: Annotated[str, Depends(require_user_id)]) -> SyncSettingsOut:
    return _build_out()


@router.patch("", response_model=SyncSettingsOut)
async def patch_sync_settings(
    body: SyncSettingsPatch,
    background_tasks: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> SyncSettingsOut:
    if (
        body.stories_interval_minutes is None
        and body.reels_interval_minutes is None
        and body.calendly_interval_minutes is None
    ):
        raise HTTPException(status_code=400, detail="Indicá al menos un intervalo para actualizar.")

    before = get_sync_settings_dict()
    update_sync_settings(
        stories_interval_minutes=body.stories_interval_minutes,
        reels_interval_minutes=body.reels_interval_minutes,
        calendly_interval_minutes=body.calendly_interval_minutes,
    )

    stories_changed = (
        body.stories_interval_minutes is not None
        and int(body.stories_interval_minutes) != before["stories_interval_minutes"]
    )
    if stories_changed:
        apply_sync_schedules(stories_run_immediately=True)
        background_tasks.add_task(_sync_stories_for_user, user_id)
    else:
        apply_sync_schedules()

    return _build_out()
