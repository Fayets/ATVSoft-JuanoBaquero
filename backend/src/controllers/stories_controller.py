from datetime import datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
import traceback

from src.schemas import StoriesMetricsOut, StorySequenceIn, StorySequenceOut, StorySequencePatchRequest
from src.services.stories_service import StoriesService

router = APIRouter(prefix="/api/stories", tags=["stories"], redirect_slashes=False)
service = StoriesService()
AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def get_current_user(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("/sequences", response_model=list[StorySequenceOut])
def get_sequences(
    user_id: Annotated[str, Depends(get_current_user)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
    all_months: bool = Query(
        default=False,
        description="Si es true, devuelve todas las secuencias del usuario (ignora month).",
    ),
) -> list[StorySequenceOut]:
    try:
        if all_months:
            return service.get_all_sequences(user_id)
        effective_month = month or datetime.now(AR_TZ).strftime("%Y-%m")
        return service.get_sequences(user_id, effective_month)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al cargar secuencias de historias.")


@router.post("/sequences", response_model=StorySequenceOut)
def create_sequence(
    body: StorySequenceIn,
    user_id: Annotated[str, Depends(get_current_user)],
) -> StorySequenceOut:
    try:
        return service.create_sequence(user_id, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al crear secuencia de historias.")


@router.put("/sequences/{sequence_id}", response_model=StorySequenceOut)
def update_sequence(
    sequence_id: int,
    body: StorySequenceIn,
    user_id: Annotated[str, Depends(get_current_user)],
) -> StorySequenceOut:
    try:
        payload: dict[str, Any] = (
            body.model_dump(exclude_unset=True)
            if hasattr(body, "model_dump")
            else body.dict(exclude_unset=True)
        )
        return service.update_sequence(sequence_id, user_id, payload)
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"[stories] update_sequence error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar secuencia de historias.")


@router.patch("/sequences/{sequence_id}", response_model=StorySequenceOut)
def patch_sequence(
    sequence_id: int,
    body: StorySequencePatchRequest,
    user_id: Annotated[str, Depends(get_current_user)],
) -> StorySequenceOut:
    try:
        payload: dict[str, Any] = (
            body.model_dump(exclude_unset=True)
            if hasattr(body, "model_dump")
            else body.dict(exclude_unset=True)
        )
        if not payload:
            raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
        return service.patch_sequence(sequence_id, user_id, payload)
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"[stories] patch_sequence error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar secuencia de historias.")


@router.delete("/sequences/{sequence_id}")
def delete_sequence(
    sequence_id: int,
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, bool]:
    try:
        return {"ok": service.delete_sequence(sequence_id, user_id)}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al eliminar secuencia de historias.")


@router.delete("/slides/{slide_id}")
def delete_slide(
    slide_id: int,
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, bool]:
    try:
        return {"ok": service.delete_slide(slide_id, user_id)}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al eliminar la historia.")


@router.get("/metrics", response_model=StoriesMetricsOut)
def get_metrics(
    user_id: Annotated[str, Depends(get_current_user)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
) -> StoriesMetricsOut:
    try:
        effective_month = month or datetime.now(AR_TZ).strftime("%Y-%m")
        return service.get_metrics(user_id, effective_month)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener métricas de historias.")


@router.get("/connection-test")
def test_instagram_connection(
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    try:
        return service.test_instagram_connection(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al probar la conexión de Instagram.")


@router.post("/sync")
async def sync_stories(
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    try:
        return await service.sync_instagram(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al sincronizar historias.")


@router.get("/sync-status")
def get_sync_status(
    user_id: Annotated[str, Depends(get_current_user)],
) -> dict[str, str | None]:
    try:
        return service.get_sync_status(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener estado de sync.")
