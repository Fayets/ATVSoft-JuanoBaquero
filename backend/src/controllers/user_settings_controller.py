"""Settings de usuario (timezone, etc.)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.models import AuthUser
from src.schemas import UserSettingsOut, UserTimezonePut

router = APIRouter(prefix="/api/settings", tags=["settings"], redirect_slashes=False)

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


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> int:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    try:
        return int(x_user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e


def _normalize_timezone(raw: str | None) -> str:
    tz = (raw or "").strip()
    if not tz:
        return DEFAULT_TIMEZONE
    if tz not in ALLOWED_TIMEZONES:
        raise HTTPException(
            status_code=400,
            detail=f"Timezone no permitida. Usá una de: {', '.join(sorted(ALLOWED_TIMEZONES))}",
        )
    return tz


@router.get("", response_model=UserSettingsOut)
def get_user_settings(user_id: Annotated[int, Depends(require_user_id)]) -> UserSettingsOut:
    with db_session:
        user = AuthUser.get(id=user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        tz = (getattr(user, "timezone", None) or "").strip() or DEFAULT_TIMEZONE
        if tz not in ALLOWED_TIMEZONES:
            tz = DEFAULT_TIMEZONE
        return UserSettingsOut(timezone=tz)


@router.put("/timezone", response_model=UserSettingsOut)
def put_user_timezone(
    body: UserTimezonePut,
    user_id: Annotated[int, Depends(require_user_id)],
) -> UserSettingsOut:
    tz = _normalize_timezone(body.timezone)
    with db_session:
        user = AuthUser.get(id=user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        user.timezone = tz
        user.updated_at = datetime.utcnow()
        return UserSettingsOut(timezone=tz)
