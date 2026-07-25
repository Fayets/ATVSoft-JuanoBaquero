"""Corrección manual reportes closer Nick Xanders — julio 2026 (fuente: closer).

Ejecutar desde backend/: python3 scripts/correct_closer_reports_jul2026.py
Solo aplica cambios si los valores actuales difieren del target.
Guarda backup JSON en data/ y valores anteriores en notas del reporte.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from pony.orm import db_session

from src.db import db
from src.models import CloserReport, TeamMember

BACKUP_PATH = Path(__file__).resolve().parents[1] / "data" / "closer_report_corrections_2026-07-09.json"

# Nick Xanders member_id=2 — fechas con reporte existente
CORRECTIONS: dict[date, dict] = {
    date(2026, 7, 13): {
        "llamadas_agendadas": 3,
        "shows": 3,
        "cierres": 0,
        "calificados": 1,
        "ingreso": 0.0,
    },
    date(2026, 7, 14): {
        "llamadas_agendadas": 2,
        "shows": 2,
        "cierres": 0,
        "calificados": 0,
        "ingreso": 0.0,
    },
    date(2026, 7, 15): {
        "llamadas_agendadas": 2,
        "shows": 2,
        "cierres": 0,
        "calificados": 1,
        "ingreso": 0.0,
    },
    date(2026, 7, 16): {
        "llamadas_agendadas": 4,
        "shows": 1,
        "cierres": 0,
        "calificados": 1,
        "ingreso": 0.0,
    },
    date(2026, 7, 18): {
        "llamadas_agendadas": 2,
        "shows": 2,
        "cierres": 0,
        "calificados": 2,
        "ingreso": 0.0,
    },
    date(2026, 7, 20): {
        "llamadas_agendadas": 1,
        "shows": 1,
        "cierres": 1,
        "calificados": 1,
        "ingreso": 15000.0,
    },
    date(2026, 7, 22): {
        "llamadas_agendadas": 1,
        "shows": 1,
        "cierres": 1,
        "calificados": 1,
        "ingreso": 5000.0,
    },
}

MEMBER_ID = 2
CORRECTION_NOTE_PREFIX = "[backup auto 2026-07-09]"


def _snapshot(r: CloserReport) -> dict:
    return {
        "id": r.id,
        "fecha": r.fecha.isoformat(),
        "member_id": r.member_id,
        "llamadas_agendadas": r.llamadas_agendadas,
        "shows": r.shows,
        "cierres": r.cierres,
        "calificados": r.calificados,
        "descalificados": r.descalificados,
        "ingreso": float(r.ingreso),
        "notas": r.notas or "",
    }


def _backup_note(before: dict) -> str:
    return (
        f"{CORRECTION_NOTE_PREFIX} "
        f"llamadas={before['llamadas_agendadas']}, shows={before['shows']}, "
        f"cierres={before['cierres']}, calificados={before['calificados']}, "
        f"descalificados={before['descalificados']}, ingreso={before['ingreso']}"
    )


def main() -> None:
    db.generate_mapping(create_tables=False)
    log: list[dict] = []
    updated = 0
    skipped = 0

    with db_session:
        member = TeamMember.get(id=MEMBER_ID)
        member_name = member.nombre if member else "?"

        for target_date, target in CORRECTIONS.items():
            rows = [
                r
                for r in list(CloserReport.select())
                if r.member_id == MEMBER_ID and r.fecha == target_date
            ]
            if not rows:
                log.append({"fecha": target_date.isoformat(), "status": "no_report"})
                continue

            r = rows[0]
            before = _snapshot(r)
            needs_update = any(
                getattr(r, k) != v for k, v in target.items()
            ) or (r.descalificados < 0)

            if not needs_update:
                log.append({"fecha": target_date.isoformat(), "status": "already_ok", "before": before})
                skipped += 1
                continue

            if CORRECTION_NOTE_PREFIX not in (r.notas or ""):
                r.notas = _backup_note(before)

            for k, v in target.items():
                setattr(r, k, v)

            if r.descalificados < 0:
                r.descalificados = 0

            after = _snapshot(r)
            log.append(
                {
                    "fecha": target_date.isoformat(),
                    "status": "updated",
                    "member": member_name,
                    "before": before,
                    "after": after,
                }
            )
            updated += 1

    payload = {
        "corrected_at": datetime.now(timezone.utc).isoformat(),
        "source": "Corrección manual closer Nick Xanders — mensaje jul 2026",
        "member_id": MEMBER_ID,
        "entries": log,
        "updated_count": updated,
        "skipped_count": skipped,
    }
    BACKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
    BACKUP_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"\nBackup: {BACKUP_PATH}")
    print(f"Updated: {updated}, skipped (already ok): {skipped}")


if __name__ == "__main__":
    main()
