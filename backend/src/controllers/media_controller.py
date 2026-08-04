"""Upload de comprobantes de pago → /media/comprobantes/{user_id}/..."""

from __future__ import annotations

import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from src.schemas import MediaUploadOut

router = APIRouter(prefix="/api/media", tags=["media"], redirect_slashes=False)

_ALLOWED_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
_MAX_BYTES = 8 * 1024 * 1024


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _backend_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@router.post("/comprobantes", response_model=MediaUploadOut)
async def upload_comprobante(
    user_id: Annotated[str, Depends(require_user_id)],
    file: UploadFile = File(...),
) -> MediaUploadOut:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = _ALLOWED_EXT.get(content_type)
    if not ext:
        # Fallback por nombre de archivo
        name = (file.filename or "").lower()
        if name.endswith(".jpg") or name.endswith(".jpeg"):
            ext = ".jpg"
        elif name.endswith(".png"):
            ext = ".png"
        elif name.endswith(".webp"):
            ext = ".webp"
        elif name.endswith(".pdf"):
            ext = ".pdf"
        else:
            raise HTTPException(
                status_code=400,
                detail="Formato no permitido. Usá JPG, PNG, WEBP o PDF.",
            )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacío.")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="El archivo supera 8 MB.")

    folder = os.path.join(_backend_root(), "media", "comprobantes", str(uid))
    os.makedirs(folder, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(folder, filename)
    with open(filepath, "wb") as f:
        f.write(data)

    return MediaUploadOut(url=f"/media/comprobantes/{uid}/{filename}")
