from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.schemas import (
    AvatarTypeCreateRequest,
    AvatarTypeOut,
    AvatarTypePatchRequest,
    AvatarTypesListResponse,
)
from src.services.avatars_services import AvatarsServices

router = APIRouter(prefix="/api/avatars", tags=["avatars"], redirect_slashes=False)

_service = AvatarsServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


@router.get("", response_model=AvatarTypesListResponse)
def list_avatars(user_id: Annotated[str, Depends(require_user_id)]) -> AvatarTypesListResponse:
    return _service.list_for_user(_parse_uid(user_id))


@router.post("", response_model=AvatarTypeOut)
def create_avatar(
    body: AvatarTypeCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> AvatarTypeOut:
    return _service.create(_parse_uid(user_id), body)


@router.patch("/{avatar_id}", response_model=AvatarTypeOut)
def patch_avatar(
    avatar_id: int,
    body: AvatarTypePatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> AvatarTypeOut:
    return _service.update(_parse_uid(user_id), avatar_id, body)


@router.delete("/{avatar_id}", response_model=AvatarTypesListResponse)
def delete_avatar(
    avatar_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> AvatarTypesListResponse:
    return _service.delete(_parse_uid(user_id), avatar_id)
