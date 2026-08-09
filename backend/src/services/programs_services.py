import unicodedata
from datetime import datetime, timezone

from fastapi import HTTPException
from pony.orm import db_session, flush

from src.models import OfferedProgram
from src.schemas import (
    OfferedProgramCreateRequest,
    OfferedProgramOut,
    OfferedProgramPatchRequest,
    OfferedProgramsListResponse,
)


class ProgramsServices:
    def _rows_for_user(self, uid: int) -> list[OfferedProgram]:
        return [p for p in list(OfferedProgram.select()) if int(p.user_id) == uid]

    def _name_taken(self, uid: int, name: str, exclude_id: int | None = None) -> bool:
        key = name.strip().lower()
        if not key:
            return False
        for p in self._rows_for_user(uid):
            if exclude_id is not None and int(p.id) == exclude_id:
                continue
            if (p.name or "").strip().lower() == key:
                return True
        return False

    def _next_sort_order(self, uid: int) -> int:
        rows = self._rows_for_user(uid)
        if not rows:
            return 0
        return max(int(r.sort_order or 0) for r in rows) + 1

    def _to_out(self, row: OfferedProgram) -> OfferedProgramOut:
        dur = row.duration_months
        return OfferedProgramOut(
            id=int(row.id),
            name=str(row.name or "").strip(),
            price_usd=float(row.price_usd or 0),
            duration_months=int(dur) if dur is not None and int(dur) > 0 else None,
            sort_order=int(row.sort_order or 0),
        )

    def list_for_user(self, user_id: int) -> OfferedProgramsListResponse:
        try:
            with db_session:
                rows = sorted(
                    self._rows_for_user(user_id),
                    key=lambda r: (int(r.sort_order or 0), int(r.id)),
                )
                programs = [self._to_out(r) for r in rows]
            return OfferedProgramsListResponse(programs=programs)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al leer programas.") from None

    def create(self, user_id: int, body: OfferedProgramCreateRequest) -> OfferedProgramOut:
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
        price = float(body.price_usd)
        if price < 0:
            raise HTTPException(status_code=400, detail="El precio no puede ser negativo.")
        try:
            with db_session:
                if self._name_taken(user_id, name):
                    raise HTTPException(status_code=400, detail="Ya existe un programa con ese nombre.")
                row = OfferedProgram(
                    user_id=user_id,
                    name=name,
                    price_usd=price,
                    duration_months=int(body.duration_months) if body.duration_months else None,
                    sort_order=self._next_sort_order(user_id),
                    created_at=datetime.now(timezone.utc),
                )
                flush()
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al crear programa.") from None

    def update(
        self,
        user_id: int,
        program_id: int,
        body: OfferedProgramPatchRequest,
    ) -> OfferedProgramOut:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == program_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Programa no encontrado.")
                row = rows[0]
                if body.name is not None:
                    nn = body.name.strip()
                    if not nn:
                        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
                    if self._name_taken(user_id, nn, exclude_id=program_id):
                        raise HTTPException(status_code=400, detail="Ya existe un programa con ese nombre.")
                    row.name = nn
                if body.price_usd is not None:
                    if float(body.price_usd) < 0:
                        raise HTTPException(status_code=400, detail="El precio no puede ser negativo.")
                    row.price_usd = float(body.price_usd)
                if body.duration_months is not None:
                    row.duration_months = int(body.duration_months) if body.duration_months else None
                if body.sort_order is not None:
                    row.sort_order = int(body.sort_order)
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al actualizar programa.") from None

    def delete(self, user_id: int, program_id: int) -> OfferedProgramsListResponse:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == program_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Programa no encontrado.")
                rows[0].delete()
            return self.list_for_user(user_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al eliminar programa.") from None


def normalize_program_lookup_key(name: str) -> str:
    """Coincide con la lógica del front (acentos / mayúsculas / espacios)."""
    t = unicodedata.normalize("NFD", (name or "").strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def build_program_norm_duration_map(user_id: int) -> dict[str, int]:
    """Duración en meses por nombre normalizado de programa (catálogo /programas)."""
    rows = [p for p in list(OfferedProgram.select()) if int(p.user_id) == user_id]
    out: dict[str, int] = {}
    for p in rows:
        nk = normalize_program_lookup_key(str(p.name or ""))
        dur = p.duration_months
        if nk and dur is not None and int(dur) > 0:
            out[nk] = int(dur)
    return out


def program_duration_months_for_prog_raw(norm_durations: dict[str, int], programa: str | None) -> int | None:
    raw = (programa or "").strip()
    if not raw:
        return None
    nk = normalize_program_lookup_key(raw)
    return norm_durations.get(nk)


def build_program_norm_price_map(user_id: int) -> dict[str, float]:
    """Misma sesión Pony que el caller (`with db_session`)."""
    rows = [p for p in list(OfferedProgram.select()) if int(p.user_id) == user_id]
    out: dict[str, float] = {}
    for p in rows:
        nk = normalize_program_lookup_key(str(p.name or ""))
        if nk:
            out[nk] = float(p.price_usd or 0)
    return out


def program_price_usd_for_prog_raw(norm_prices: dict[str, float], programa_ofrecido: str | None) -> float | None:
    raw = (programa_ofrecido or "").strip()
    if not raw:
        return None
    nk = normalize_program_lookup_key(raw)
    if nk in norm_prices:
        return norm_prices[nk]
    return None
