from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.controllers.auth_controller import get_current_user_id
from src.env_public import manychat_webhook_token, public_site_url
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.conexiones_services import ConexionesServices

router = APIRouter(prefix="/conexiones", tags=["conexiones"])
service = ConexionesServices()


class ManychatWebhookInfoResponse(BaseModel):
    webhook_url: str
    webhook_token: str


class CalendlyWebhookInfoResponse(BaseModel):
    webhook_url: str


@router.get("/manychat-webhook-info", response_model=ManychatWebhookInfoResponse)
def manychat_webhook_info(
    _user_id: Annotated[int, Depends(get_current_user_id)],
) -> ManychatWebhookInfoResponse:
    """URL y token que ManyChat debe usar (token = MANYCHAT_WEBHOOK_TOKEN de la instancia)."""
    token = manychat_webhook_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="MANYCHAT_WEBHOOK_TOKEN no configurado en el servidor. Agregalo al .env del backend.",
        )
    base = public_site_url()
    return ManychatWebhookInfoResponse(
        webhook_url=f"{base}/api/webhooks/manychat",
        webhook_token=token,
    )


@router.get("/calendly-webhook-info", response_model=CalendlyWebhookInfoResponse)
def calendly_webhook_info(
    _user_id: Annotated[int, Depends(get_current_user_id)],
) -> CalendlyWebhookInfoResponse:
    """URL pública del webhook Calendly."""
    base = public_site_url()
    return CalendlyWebhookInfoResponse(webhook_url=f"{base}/api/webhooks/calendly")


@router.get("", response_model=list[ApiConnectionResponse])
def list_conexiones(user_id: Annotated[int, Depends(get_current_user_id)]) -> list[ApiConnectionResponse]:
    try:
        return service.list_by_user(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al listar las conexiones.",
        )


@router.put("/{platform}", response_model=ApiConnectionResponse)
def upsert_conexion(
    platform: str,
    body: ApiConnectionUpsertRequest,
    user_id: Annotated[int, Depends(get_current_user_id)],
) -> ApiConnectionResponse:
    try:
        return service.upsert(user_id, platform, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al guardar la conexión.",
        )
