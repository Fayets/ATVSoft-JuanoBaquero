"""API de reportes semanales (Claude)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from pony.orm import db_session, flush
from pydantic import BaseModel, Field, model_validator

from src.models import WeeklyReport
from src.services.weekly_report_service import (
    extract_feedback_marketing,
    generate_weekly_report,
    normalize_period,
    preview_weekly_data,
)
from src.weekly_reports_export import (
    build_weekly_report_pdf,
    sanitize_weekly_content,
    weekly_report_filename,
)

router = APIRouter(prefix="/api/weekly-reports", tags=["weekly-reports"], redirect_slashes=False)


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


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


class WeeklyReportOut(BaseModel):
    id: int
    semana_inicio: date
    semana_fin: date
    contenido: str = ""
    estado: str
    error_msg: str = ""
    llamadas_count: int = 0
    closer_dias_count: int = 0
    feedback_marketing: str = ""
    created_at: str
    updated_at: str | None = None


class WeeklyReportsListResponse(BaseModel):
    weekly_reports: list[WeeklyReportOut] = Field(default_factory=list)


class WeeklyReportGenerateRequest(BaseModel):
    fecha_inicio: date
    fecha_fin: date
    dias: list[date] | None = Field(
        default=None,
        description="Días incluidos dentro del rango; si omitís, se usan todos.",
    )

    @model_validator(mode="after")
    def _validate_period(self) -> "WeeklyReportGenerateRequest":
        if self.fecha_inicio > self.fecha_fin:
            raise ValueError("fecha_inicio debe ser anterior o igual a fecha_fin.")
        return self


class WeeklyReportGenerateResponse(BaseModel):
    id: int
    estado: str


class WeeklyPreviewOut(BaseModel):
    semana_inicio: date
    semana_fin: date
    llamadas_count: int
    closer_dias_count: int
    dias_seleccionados: int = 0


def _feedback_out(row: WeeklyReport) -> str:
    stored = (row.feedback_marketing or "").strip()
    if stored:
        return stored
    return extract_feedback_marketing(row.contenido or "")


def _to_out(row: WeeklyReport) -> WeeklyReportOut:
    return WeeklyReportOut(
        id=int(row.id),
        semana_inicio=row.semana_inicio,
        semana_fin=row.semana_fin,
        contenido=sanitize_weekly_content(row.contenido or ""),
        estado=(row.estado or "pendiente").strip(),
        error_msg=(row.error_msg or "").strip(),
        llamadas_count=int(row.llamadas_count or 0),
        closer_dias_count=int(row.closer_dias_count or 0),
        feedback_marketing=_feedback_out(row),
        created_at=_dt_iso(row.created_at) or "",
        updated_at=_dt_iso(row.updated_at),
    )


def _parse_dias_query(raw: str | None) -> list[date] | None:
    if not raw or not raw.strip():
        return None
    out: list[date] = []
    for part in raw.split(","):
        piece = part.strip()
        if not piece:
            continue
        out.append(date.fromisoformat(piece))
    return out or None


@router.get("", response_model=WeeklyReportsListResponse)
def list_weekly_reports(
    user_id: Annotated[str, Depends(require_user_id)],
) -> WeeklyReportsListResponse:
    uid = _parse_uid(user_id)
    with db_session:
        rows = sorted(
            [r for r in list(WeeklyReport.select()) if int(r.user_id) == uid],
            key=lambda r: r.semana_inicio,
            reverse=True,
        )
        return WeeklyReportsListResponse(weekly_reports=[_to_out(r) for r in rows])


@router.get("/preview", response_model=WeeklyPreviewOut)
def preview_weekly_report(
    fecha_inicio: date = Query(...),
    fecha_fin: date = Query(...),
    dias: str | None = Query(None, description="CSV YYYY-MM-DD de días incluidos"),
    user_id: Annotated[str, Depends(require_user_id)] = "",
) -> WeeklyPreviewOut:
    uid = _parse_uid(user_id)
    try:
        data = preview_weekly_data(uid, fecha_inicio, fecha_fin, _parse_dias_query(dias))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return WeeklyPreviewOut(**data)


@router.get("/{report_id}/download")
def download_weekly_report_pdf(
    report_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> Response:
    uid = _parse_uid(user_id)
    with db_session:
        row = WeeklyReport.get(id=report_id)
        if row is None or int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte semanal no encontrado.")
        if (row.estado or "").strip().lower() != "listo":
            raise HTTPException(status_code=400, detail="El reporte aún no está listo.")
        contenido = (row.contenido or "").strip()
        if not contenido:
            raise HTTPException(status_code=400, detail="El reporte no tiene contenido.")
        label = f"{row.semana_inicio.strftime('%d/%m/%Y')} – {row.semana_fin.strftime('%d/%m/%Y')}"
        filename = weekly_report_filename(row.semana_inicio.isoformat(), row.semana_fin.isoformat())

    try:
        pdf_bytes = build_weekly_report_pdf(contenido, semana_label=label)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Falta fpdf2 en el backend (pip install fpdf2).",
        ) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{report_id}", response_model=WeeklyReportOut)
def get_weekly_report(
    report_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> WeeklyReportOut:
    uid = _parse_uid(user_id)
    with db_session:
        row = WeeklyReport.get(id=report_id)
        if row is None or int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte semanal no encontrado.")
        return _to_out(row)


@router.delete("/{report_id}")
def delete_weekly_report(
    report_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, bool]:
    uid = _parse_uid(user_id)
    with db_session:
        row = WeeklyReport.get(id=report_id)
        if row is None or int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte semanal no encontrado.")
        row.delete()
    return {"ok": True}


def _run_generate(uid: int, fecha_inicio: date, fecha_fin: date, dias: list[date] | None) -> None:
    try:
        generate_weekly_report(uid, fecha_inicio, fecha_fin, dias)
    except Exception as exc:
        print(f"[weekly-report] user={uid} {fecha_inicio}..{fecha_fin} error: {exc}")


@router.post("/generate", response_model=WeeklyReportGenerateResponse)
def generate_weekly_report_endpoint(
    body: WeeklyReportGenerateRequest,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> WeeklyReportGenerateResponse:
    uid = _parse_uid(user_id)
    try:
        start, end, included = normalize_period(body.fecha_inicio, body.fecha_fin, body.dias)
        data = preview_weekly_data(uid, body.fecha_inicio, body.fecha_fin, body.dias)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if data["llamadas_count"] == 0 and data["closer_dias_count"] == 0:
        raise HTTPException(
            status_code=400,
            detail="No hay análisis Fathom ni reportes diarios del closer para los días seleccionados.",
        )

    with db_session:
        existing = [
            r
            for r in list(WeeklyReport.select())
            if int(r.user_id) == uid and r.semana_inicio == start and r.semana_fin == end
        ]
        if existing:
            row = existing[0]
            row.estado = "generando"
            row.error_msg = ""
            row.llamadas_count = int(data["llamadas_count"])
            row.closer_dias_count = int(data["closer_dias_count"])
            row.updated_at = datetime.utcnow()
            report_id = int(row.id)
        else:
            row = WeeklyReport(
                user_id=uid,
                semana_inicio=start,
                semana_fin=end,
                estado="generando",
                llamadas_count=int(data["llamadas_count"]),
                closer_dias_count=int(data["closer_dias_count"]),
            )
            flush()
            report_id = int(row.id)

    background.add_task(_run_generate, uid, body.fecha_inicio, body.fecha_fin, body.dias)
    return WeeklyReportGenerateResponse(id=report_id, estado="generando")
