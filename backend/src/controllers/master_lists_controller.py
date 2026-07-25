import json
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import db_session

from src.models import MasterList
from src.schemas import MasterListAddItemRequest, MasterListsResponse

router = APIRouter(prefix="/api/master-lists", tags=["master-lists"], redirect_slashes=False)
VALID_CATEGORIES = frozenset({"dolores", "angulos", "ctas"})


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


def _as_utc_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _items_as_list(raw: object) -> list[str]:
    """Normaliza `items` desde Pony/Postgres (list, tuple o JSON string)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            return []
        raw = parsed
    if isinstance(raw, tuple):
        raw = list(raw)
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def _rows_for_user(uid: int) -> list[MasterList]:
    """Filtrar en Python: con Python 3.13, `select(lambda m: m.user_id == uid)` genera SQL incorrecto (0 filas)."""
    return [m for m in list(MasterList.select()) if m.user_id == uid]


def _rows_for_category(uid: int, category: str) -> list[MasterList]:
    return [m for m in _rows_for_user(uid) if m.category == category]


def _merge_items_from_rows(rows: list[MasterList]) -> list[str]:
    """Une ítems de todas las filas (p. ej. duplicados legacy por user_id+category), orden estable por id."""
    ordered = sorted(rows, key=lambda r: r.id)
    seen: set[str] = set()
    out: list[str] = []
    for row in ordered:
        for item in _items_as_list(row.items):
            key = item.lower()
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def _replace_category_rows(uid: int, category: str, items: list[str]) -> None:
    """Una sola fila por (user_id, category); borra duplicados y persiste `items`."""
    now = datetime.now(timezone.utc)
    rows = _rows_for_category(uid, category)
    created_stamps = [_as_utc_aware(r.created_at) for r in rows if r.created_at is not None]
    created = min(created_stamps, default=now)
    for r in rows:
        r.delete()
    MasterList(
        user_id=uid,
        category=category,
        items=list(items),
        created_at=created,
        updated_at=now,
    )


def _ensure_categories(uid: int) -> None:
    """Crea filas vacías solo si falta la categoría (requiere UNIQUE (user_id, category) en BD)."""
    now = datetime.now(timezone.utc)
    have = {m.category for m in _rows_for_user(uid)}
    for cat in VALID_CATEGORIES:
        if cat not in have:
            MasterList(user_id=uid, category=cat, items=[], created_at=now, updated_at=now)


def _read_lists(uid: int) -> MasterListsResponse:
    with db_session:
        _ensure_categories(uid)
        data: dict[str, list[str]] = {}
        for cat in VALID_CATEGORIES:
            rows = _rows_for_category(uid, cat)
            merged = _merge_items_from_rows(rows)
            if len(rows) > 1:
                _replace_category_rows(uid, cat, merged)
            data[cat] = merged
    return MasterListsResponse(**data)


@router.get("", response_model=MasterListsResponse)
def list_master_lists(user_id: Annotated[str, Depends(require_user_id)]) -> MasterListsResponse:
    uid = _parse_uid(user_id)
    try:
        return _read_lists(uid)
    except Exception:
        raise HTTPException(status_code=500, detail="Error al leer listas maestras.") from None


@router.post("/{category}", response_model=MasterListsResponse)
def add_master_list_item(
    category: str,
    body: MasterListAddItemRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> MasterListsResponse:
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Categoría inválida. Usá: dolores, angulos o ctas.",
        )
    uid = _parse_uid(user_id)
    item = (body.item or "").strip()
    if not item:
        raise HTTPException(status_code=400, detail="El item no puede estar vacío.")
    try:
        with db_session:
            _ensure_categories(uid)
            rows = _rows_for_category(uid, category)
            if not rows:
                raise HTTPException(status_code=404, detail="Lista no encontrada.")
            current = _merge_items_from_rows(rows)
            lower = item.lower()
            if any(x.lower() == lower for x in current):
                new_items = current
            else:
                new_items = current + [item]
            _replace_category_rows(uid, category, new_items)
        return _read_lists(uid)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al agregar item.") from None


@router.delete("/{category}/{item:path}", response_model=MasterListsResponse)
def delete_master_list_item(
    category: str,
    item: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> MasterListsResponse:
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Categoría inválida. Usá: dolores, angulos o ctas.",
        )
    uid = _parse_uid(user_id)
    target = unquote(item).strip()
    if not target:
        raise HTTPException(status_code=400, detail="Item inválido.")
    try:
        with db_session:
            _ensure_categories(uid)
            rows = _rows_for_category(uid, category)
            if not rows:
                raise HTTPException(status_code=404, detail="Lista no encontrada.")
            current = _merge_items_from_rows(rows)
            new_items = [x for x in current if x != target]
            _replace_category_rows(uid, category, new_items)
        return _read_lists(uid)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al eliminar item.") from None

