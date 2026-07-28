"""Asignación automática de triajers (round-robin por carga)."""

from __future__ import annotations

from src.models import Lead, TeamMember


def list_active_triajer_names(user_id: int) -> list[str]:
    names = [
        (m.nombre or "").strip()
        for m in TeamMember.select(
            lambda m: m.user_id == user_id and m.rol == "triajer" and m.activo
        )
        if (m.nombre or "").strip()
    ]
    names.sort(key=lambda n: n.casefold())
    return names


def _counts_by_triajer(user_id: int, names: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {n: 0 for n in names}
    name_by_fold = {n.casefold(): n for n in names}
    for lead in Lead.select(lambda l: l.user_id == user_id):
        t = (getattr(lead, "triajer", None) or "").strip()
        if not t:
            continue
        canon = name_by_fold.get(t.casefold())
        if canon is not None:
            counts[canon] += 1
    return counts


def pick_next_triajer(user_id: int) -> str:
    """Triajer activo con menos leads asignados (desempate por nombre)."""
    names = list_active_triajer_names(user_id)
    if not names:
        return ""
    counts = _counts_by_triajer(user_id, names)
    return min(names, key=lambda n: (counts[n], n.casefold()))


def pick_next_triajer_from_counts(names: list[str], counts: dict[str, int]) -> str:
    """Elige el siguiente triajer usando un contador mutable (batch)."""
    if not names:
        return ""
    return min(names, key=lambda n: (counts.get(n, 0), n.casefold()))


def assign_triajers_to_leads(user_id: int, leads: list[Lead]) -> int:
    """Asigna triajer a leads sin uno. Devuelve cuántos se asignaron."""
    names = list_active_triajer_names(user_id)
    if not names:
        return 0
    counts = _counts_by_triajer(user_id, names)
    assigned = 0
    for lead in leads:
        if (getattr(lead, "triajer", None) or "").strip():
            continue
        name = pick_next_triajer_from_counts(names, counts)
        if not name:
            break
        lead.triajer = name
        counts[name] = counts.get(name, 0) + 1
        assigned += 1
    return assigned
