"""Panel admin: corrección de reportes closer por fecha (contraseña + token)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session
from pydantic import BaseModel, Field

from src.controllers.leads_controller import _to_lead_out
from src.models import Lead as LeadEntity
from src.schemas import LeadOut, LlamadasHoyOut
from src.services.admin_panel_service import (
    create_admin_panel_token,
    parse_call_hora_for_date,
    verify_admin_password,
    verify_admin_panel_token,
)
from src.services.agent_closer_service import AR_TZ, list_llamadas_dia
from src.services.programs_services import build_program_norm_price_map

router = APIRouter(prefix="/api/admin/panel", tags=["admin-panel"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if not x_user_id or not str(x_user_id).strip().isdigit():
        raise HTTPException(status_code=401, detail="Sesión requerida.")
    return str(x_user_id).strip()


def require_admin_panel(
    user_id: Annotated[str, Depends(require_user_id)],
    x_admin_panel_token: Annotated[str | None, Header(alias="X-Admin-Panel-Token")] = None,
) -> int:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e
    if not verify_admin_panel_token(x_admin_panel_token or "", uid):
        raise HTTPException(status_code=403, detail="Acceso admin no autorizado.")
    return uid


class AdminUnlockBody(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class AdminUnlockOut(BaseModel):
    token: str


class AdminManualCallBody(BaseModel):
    client_name: str = Field(min_length=1, max_length=500)
    closer: str = Field(min_length=1, max_length=200)
    hora: str = Field(min_length=4, max_length=5)
    fecha: date
    ig_handle: str | None = None


@router.post("/unlock", response_model=AdminUnlockOut)
def unlock_admin_panel(
    body: AdminUnlockBody,
    user_id: Annotated[str, Depends(require_user_id)],
) -> AdminUnlockOut:
    if not verify_admin_password(body.password):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e
    return AdminUnlockOut(token=create_admin_panel_token(uid))


@router.get("/llamadas", response_model=LlamadasHoyOut)
def admin_panel_llamadas(
    fecha: date = Query(..., description="YYYY-MM-DD"),
    uid: int = Depends(require_admin_panel),
) -> LlamadasHoyOut:
    payload = list_llamadas_dia(uid, fecha)
    return LlamadasHoyOut(**payload)


@router.post("/manual-call", response_model=LeadOut)
def admin_panel_manual_call(
    body: AdminManualCallBody,
    uid: int = Depends(require_admin_panel),
) -> LeadOut:
    try:
        call_at = parse_call_hora_for_date(body.hora, body.fecha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    now_ar = datetime.now(AR_TZ).replace(tzinfo=None)
    anchor = datetime(body.fecha.year, body.fecha.month, 15, 15, 0, 0)

    with db_session:
        row = LeadEntity(
            user_id=uid,
            nombre=(body.client_name or "").strip(),
            ig=(body.ig_handle or "").strip(),
            origen="Manual",
            status="Pendiente",
            estado="Pendiente",
            closer=(body.closer or "").strip(),
            fecha_bot=anchor,
            agendo=now_ar,
            agendo_en="Panel corrección",
            call=call_at,
            formulario={},
        )
        norm_prices = build_program_norm_price_map(uid)
        return _to_lead_out(row, norm_prices)
