from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.models import Lead as LeadEntity
from src.schemas import (
    CrmClientOut,
    CrmClientPatchRequest,
    CrmClientTrackingResponse,
    CrmClientsListResponse,
    CrmClientUpsertRequest,
)
from src.services.clients_service import (
    ClientContext,
    get_client_for_lead,
    lead_is_client,
    list_clients_for_user,
    client_to_out,
    normalize_wins,
    parse_date_in,
    tracking_dashboard_for_user,
    upsert_overlay,
)

router = APIRouter(prefix="/api/clients", tags=["clients"], redirect_slashes=False)


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
        return int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e


def _parse_lead_id(lead_id: str) -> int:
    try:
        return int(lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id inválido") from e


def _ensure_lead(uid: int, lead_id: int) -> LeadEntity:
    lead = LeadEntity.get(id=lead_id, user_id=uid)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado.")
    if not lead_is_client(lead):
        raise HTTPException(
            status_code=400,
            detail="El lead debe estar Cerrado, Seña o con pago registrado para ser cliente.",
        )
    return lead


@router.get("", response_model=CrmClientsListResponse)
def list_clients(user_id: Annotated[str, Depends(require_user_id)]) -> CrmClientsListResponse:
    uid = _parse_uid(user_id)
    with db_session:
        out = [CrmClientOut(**c) for c in list_clients_for_user(uid)]
    return CrmClientsListResponse(clients=out)


@router.get("/tracking", response_model=CrmClientTrackingResponse)
def clients_tracking(user_id: Annotated[str, Depends(require_user_id)]) -> CrmClientTrackingResponse:
    uid = _parse_uid(user_id)
    with db_session:
        data = tracking_dashboard_for_user(uid)
    return CrmClientTrackingResponse(**data)


@router.post("", response_model=CrmClientOut)
def upsert_client_crm(
    body: CrmClientUpsertRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CrmClientOut:
    uid = _parse_uid(user_id)
    start = parse_date_in(body.start_date) if body.start_date else None
    if body.start_date and start is None:
        raise HTTPException(status_code=400, detail="start_date inválida (usar YYYY-MM-DD).")

    with db_session:
        _ensure_lead(uid, body.lead_id)
        try:
            lead, overlay = upsert_overlay(
                uid,
                body.lead_id,
                full_name=body.full_name,
                program_name=body.program_name,
                program_duration_months=body.program_duration_months,
                start_date=start,
                sale_status=body.sale_status,
                wins=body.wins,
                notes=body.notes,
            )
        except ValueError as e:
            code = str(e)
            if code == "lead_not_found":
                raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
            raise HTTPException(status_code=400, detail="Lead no califica como cliente.") from e
        return CrmClientOut(**client_to_out(lead, overlay, ClientContext(uid)))


@router.patch("/{lead_id}", response_model=CrmClientOut)
def patch_client_crm(
    lead_id: str,
    body: CrmClientPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CrmClientOut:
    uid = _parse_uid(user_id)
    lid = _parse_lead_id(lead_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")

    start = None
    unset_start = False
    if "start_date" in data:
        if data["start_date"] is None or not str(data["start_date"]).strip():
            unset_start = True
        else:
            start = parse_date_in(data["start_date"])
            if start is None:
                raise HTTPException(status_code=400, detail="start_date inválida (usar YYYY-MM-DD).")

    with db_session:
        lead = _ensure_lead(uid, lid)
        try:
            lead, overlay = upsert_overlay(
                uid,
                lid,
                full_name=data.get("full_name"),
                program_name=data.get("program_name"),
                program_duration_months=data.get("program_duration_months"),
                start_date=start,
                unset_start=unset_start,
                sale_status=data.get("sale_status"),
                wins=normalize_wins(data["wins"]) if "wins" in data else None,
                notes=data.get("notes"),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Lead no califica como cliente.") from e
        return CrmClientOut(**client_to_out(lead, overlay, ClientContext(uid)))


@router.get("/{lead_id}", response_model=CrmClientOut)
def get_client(
    lead_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CrmClientOut:
    uid = _parse_uid(user_id)
    lid = _parse_lead_id(lead_id)
    with db_session:
        item = get_client_for_lead(uid, lid)
        if item is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado en leads.")
        return CrmClientOut(**item)
