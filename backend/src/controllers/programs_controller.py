from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.schemas import (
    OfferedProgramCreateRequest,
    OfferedProgramOut,
    OfferedProgramPatchRequest,
    OfferedProgramsListResponse,
)
from src.services.programs_services import ProgramsServices

router = APIRouter(prefix="/api/programs", tags=["programs"], redirect_slashes=False)

_service = ProgramsServices()


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


@router.get("", response_model=OfferedProgramsListResponse)
def list_programs(user_id: Annotated[str, Depends(require_user_id)]) -> OfferedProgramsListResponse:
    return _service.list_for_user(_parse_uid(user_id))


@router.post("", response_model=OfferedProgramOut)
def create_program(
    body: OfferedProgramCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> OfferedProgramOut:
    return _service.create(_parse_uid(user_id), body)


@router.patch("/{program_id}", response_model=OfferedProgramOut)
def patch_program(
    program_id: int,
    body: OfferedProgramPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> OfferedProgramOut:
    return _service.update(_parse_uid(user_id), program_id, body)


@router.delete("/{program_id}", response_model=OfferedProgramsListResponse)
def delete_program(
    program_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> OfferedProgramsListResponse:
    return _service.delete(_parse_uid(user_id), program_id)
