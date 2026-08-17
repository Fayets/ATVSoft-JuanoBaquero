"""updated_at + rastro de cambios de status en lead.legacy_meta.actualizaciones."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.services.legacy_juano_import import merge_meta

UNWORKED_STATUS = frozenset({"", "agendado", "pendiente"})


def status_is_unworked(raw: str | None) -> bool:
    return (raw or "").strip().lower() in UNWORKED_STATUS


def touch_lead_updated_at(row: Any) -> None:
    row.updated_at = datetime.utcnow()


def append_status_audit(row: Any, antes: str, despues: str, origen: str) -> None:
    a = (antes or "").strip()
    d = (despues or "").strip()
    if a == d:
        return
    meta = merge_meta(getattr(row, "legacy_meta", None), {})
    actualizaciones = meta.get("actualizaciones")
    if not isinstance(actualizaciones, list):
        actualizaciones = []
    actualizaciones.append(
        {
            "fecha": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "campo": "status",
            "antes": a,
            "despues": d,
            "origen": origen,
        }
    )
    meta["actualizaciones"] = actualizaciones
    row.legacy_meta = meta
