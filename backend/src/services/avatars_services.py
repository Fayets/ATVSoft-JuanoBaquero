import re
import unicodedata
from datetime import datetime

from fastapi import HTTPException
from pony.orm import db_session, flush

from src.models import ApiConnection, AvatarType, Lead
from src.schemas import (
    AvatarTypeCreateRequest,
    AvatarTypeOut,
    AvatarTypePatchRequest,
    AvatarTypesListResponse,
)

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

DEFAULT_AVATARS: list[tuple[str, str]] = [
    ("Experto en info", "#3B82F6"),
    ("Dueño de agencia", "#A855F7"),
    ("Dueño de negocio", "#F59E0B"),
    ("Habilidades de alto valor", "#EC4899"),
    ("Creador de contenido", "#22C55E"),
    ("Creador con infoproducto", "#06B6D4"),
    ("Otro", "#6B7280"),
]

_DEFAULTS_SEEDED_PLATFORM = "_avatar_defaults_seeded"


def normalize_avatar_lookup_key(name: str) -> str:
    """Coincide con la lógica del front (acentos / mayúsculas / espacios)."""
    t = unicodedata.normalize("NFD", (name or "").strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def _valid_hex_color(raw: str | None) -> str:
    s = (raw or "").strip()
    if _HEX_COLOR_RE.match(s):
        return s
    return "#6B7280"


class AvatarsServices:
    def _rows_for_user(self, uid: int) -> list[AvatarType]:
        return [a for a in list(AvatarType.select()) if int(a.user_id) == uid]

    def _leads_for_user(self, uid: int) -> list[Lead]:
        return [l for l in list(Lead.select()) if int(l.user_id) == uid]

    def _nombre_taken(self, uid: int, nombre: str, exclude_id: int | None = None) -> bool:
        key = normalize_avatar_lookup_key(nombre)
        if not key:
            return False
        for row in self._rows_for_user(uid):
            if exclude_id is not None and int(row.id) == exclude_id:
                continue
            if normalize_avatar_lookup_key(row.nombre or "") == key:
                return True
        return False

    def _next_sort_order(self, uid: int) -> int:
        rows = self._rows_for_user(uid)
        if not rows:
            return 0
        return max(int(r.sort_order or 0) for r in rows) + 1

    def _to_out(self, row: AvatarType) -> AvatarTypeOut:
        return AvatarTypeOut(
            id=int(row.id),
            nombre=str(row.nombre or "").strip(),
            color=_valid_hex_color(row.color),
            activo=bool(row.activo),
            sort_order=int(row.sort_order or 0),
        )

    def _lead_count_using_avatar(self, uid: int, nombre: str) -> int:
        key = normalize_avatar_lookup_key(nombre)
        if not key:
            return 0
        count = 0
        for lead in self._leads_for_user(uid):
            av = normalize_avatar_lookup_key(lead.avatar or "")
            if av and av == key:
                count += 1
        return count

    def _defaults_already_seeded(self, user_id: int) -> bool:
        return any(
            c
            for c in list(ApiConnection.select())
            if int(c.user_id) == user_id and str(c.platform or "") == _DEFAULTS_SEEDED_PLATFORM
        )

    def _mark_defaults_seeded(self, user_id: int) -> None:
        if self._defaults_already_seeded(user_id):
            return
        ApiConnection(
            user_id=user_id,
            platform=_DEFAULTS_SEEDED_PLATFORM,
            credentials={"v": 1},
        )

    def _ensure_default_catalog(self, user_id: int) -> None:
        """Persiste avatares legacy faltantes solo la primera vez por usuario."""
        if self._defaults_already_seeded(user_id):
            return
        rows = self._rows_for_user(user_id)
        existing_keys = {normalize_avatar_lookup_key(r.nombre or "") for r in rows}
        missing = [
            (nombre, color)
            for nombre, color in DEFAULT_AVATARS
            if normalize_avatar_lookup_key(nombre) not in existing_keys
        ]
        if not missing:
            self._mark_defaults_seeded(user_id)
            flush()
            return
        now = datetime.utcnow()
        next_order = self._next_sort_order(user_id)
        for i, (nombre, color) in enumerate(missing):
            AvatarType(
                user_id=user_id,
                nombre=nombre,
                color=_valid_hex_color(color),
                activo=True,
                sort_order=next_order + i,
                created_at=now,
            )
        self._mark_defaults_seeded(user_id)
        flush()

    def list_for_user(self, user_id: int) -> AvatarTypesListResponse:
        try:
            with db_session:
                self._ensure_default_catalog(user_id)
                rows = sorted(
                    self._rows_for_user(user_id),
                    key=lambda r: (int(r.sort_order or 0), int(r.id)),
                )
                avatars = [self._to_out(r) for r in rows]
            return AvatarTypesListResponse(avatars=avatars)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al leer avatares.") from None

    def create(self, user_id: int, body: AvatarTypeCreateRequest) -> AvatarTypeOut:
        nombre = (body.nombre or "").strip()
        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
        color = _valid_hex_color(body.color)
        try:
            with db_session:
                if self._nombre_taken(user_id, nombre):
                    raise HTTPException(status_code=400, detail="Ya existe un avatar con ese nombre.")
                row = AvatarType(
                    user_id=user_id,
                    nombre=nombre,
                    color=color,
                    activo=bool(body.activo),
                    sort_order=self._next_sort_order(user_id),
                    created_at=datetime.utcnow(),
                )
                flush()
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al crear avatar.") from None

    def update(
        self,
        user_id: int,
        avatar_id: int,
        body: AvatarTypePatchRequest,
    ) -> AvatarTypeOut:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == avatar_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Avatar no encontrado.")
                row = rows[0]
                if body.nombre is not None:
                    nn = body.nombre.strip()
                    if not nn:
                        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
                    if self._nombre_taken(user_id, nn, exclude_id=avatar_id):
                        raise HTTPException(status_code=400, detail="Ya existe un avatar con ese nombre.")
                    row.nombre = nn
                if body.color is not None:
                    row.color = _valid_hex_color(body.color)
                if body.activo is not None:
                    row.activo = bool(body.activo)
                if body.sort_order is not None:
                    row.sort_order = int(body.sort_order)
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al actualizar avatar.") from None

    def delete(self, user_id: int, avatar_id: int) -> AvatarTypesListResponse:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == avatar_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Avatar no encontrado.")
                row = rows[0]
                in_use = self._lead_count_using_avatar(user_id, row.nombre or "")
                if in_use > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede eliminar: hay {in_use} lead(s) con este avatar.",
                    )
                row.delete()
                if not self._rows_for_user(user_id):
                    self._mark_defaults_seeded(user_id)
            return self.list_for_user(user_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al eliminar avatar.") from None
