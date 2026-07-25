from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.schemas import (
    ReelKeywordPatchRequest,
    ReelPatchRequest,
    ReelResponse,
    ReelsListResponse,
    ReelsMetricsOut,
    ReelsSyncRangeDiscoverRequest,
    ReelsSyncRangeImportRequest,
)
from src.services.reels_services import ReelsServices

router = APIRouter(prefix="/api/reels", tags=["reels"], redirect_slashes=False)
service = ReelsServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("", response_model=ReelsListResponse)
def list_reels(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
    months: str | None = Query(default=None, description="Varios meses YYYY-MM separados por coma (p. ej. comparación)"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    skip_agg: bool = Query(
        default=False,
        description="Si true, no calcula total_cash/total_chats sobre todos los reels (más rápido; solo la página trae métricas finales).",
    ),
) -> ReelsListResponse:
    try:
        return service.list_reels(user_id, month, page, page_size, months_csv=months, skip_agg=skip_agg)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al listar reels.")


@router.get("/sync-status")
def get_sync_status(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, int | str]:
    try:
        return service.get_sync_status(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener estado de sync de reels.")


@router.get("/metrics", response_model=ReelsMetricsOut)
def get_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="Formato YYYY-MM"),
    months: str | None = Query(default=None, description="Varios meses YYYY-MM separados por coma"),
) -> ReelsMetricsOut:
    try:
        return service.get_metrics(user_id, month, months_csv=months)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener métricas de reels.")


@router.get("/{reel_id}", response_model=ReelResponse)
def get_reel(
    reel_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
    refresh: bool = Query(default=False),
) -> ReelResponse:
    try:
        return service.get_reel(user_id, reel_id, refresh=refresh)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener el reel.")


@router.patch("/{reel_id}", response_model=ReelResponse)
def patch_reel(
    reel_id: str,
    body: ReelPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> ReelResponse:
    try:
        return service.patch_reel(user_id, reel_id, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar el reel.")


@router.patch("/{reel_id}/keyword", response_model=ReelResponse)
def patch_reel_keyword(
    reel_id: str,
    body: ReelKeywordPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> ReelResponse:
    try:
        return service.patch_reel_keyword(user_id, reel_id, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar el keyword del reel.")


@router.post("/sync")
async def sync_instagram(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        service.trigger_sync(user_id)
        return {"status": "started"}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al sincronizar reels con Instagram.")


@router.post("/sync-range/discover")
async def reels_sync_range_discover(
    body: ReelsSyncRangeDiscoverRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        service.trigger_discover_range(user_id)
        return {"status": "started"}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al buscar reels en la cuenta.")


@router.post("/sync-range/import")
async def reels_sync_range_import(
    body: ReelsSyncRangeImportRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        service.trigger_import_range(user_id, body.take)
        return {"status": "started"}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al importar reels del rango.")


@router.post("/refresh-metrics")
async def refresh_reels_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        service.trigger_refresh_metrics(user_id)
        return {"status": "started"}
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al actualizar metricas de reels.")
