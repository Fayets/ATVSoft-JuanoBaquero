from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from fastapi.responses import Response
from pony.orm import ObjectNotFound, db_session
from pydantic import BaseModel

from src.call_reports_export import (
    build_call_reports_pdf,
    download_filename_for_reports,
    report_as_dict,
)
from src.lead_display_utils import lead_display_nombre
from src.models import CallReport as CallReportEntity
from src.models import Lead as LeadEntity
from src.schemas import (
    CallReportAnalyzeRequest,
    CallReportAnalyzeResponse,
    CallReportBulkIdsRequest,
    CallReportOut,
    CallReportsListResponse,
    ClaudeApiStatusResponse,
    FathomApiStatusResponse,
)
from src.services.anthropic_service import get_claude_status_for_user
from src.services.fathom_service import get_fathom_status_for_user
from src.services.call_report_service import (
    analyze_call_report,
    delete_call_reports,
    get_or_create_report,
    is_fathom_link,
    normalize_fathom_url,
    notify_call_report_discord,
)

router = APIRouter(prefix="/api/call-reports", tags=["call-reports"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _sort_ts(row: CallReportEntity) -> float:
    dt = row.created_at
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return float(dt.replace(tzinfo=timezone.utc).timestamp())


def _lead_nombre_map(uid: int, lead_ids: set[int]) -> dict[int, str]:
    if not lead_ids:
        return {}
    out: dict[int, str] = {}
    for lid in lead_ids:
        try:
            lead = LeadEntity[lid]
        except ObjectNotFound:
            continue
        if int(lead.user_id) != uid:
            continue
        out[lid] = lead_display_nombre(lead.nombre, lead.ig) or "Sin nombre"
    return out


def _resolve_lead_nombre(row: CallReportEntity, live_names: dict[int, str]) -> str:
    snap = (row.lead_nombre or "").strip()
    if snap:
        return snap
    return live_names.get(int(row.lead_id), "") or "Sin nombre"


def _to_out(row: CallReportEntity, live_names: dict[int, str]) -> CallReportOut:
    lid = int(row.lead_id)
    return CallReportOut(
        id=str(row.id),
        lead_id=str(lid),
        lead_nombre=_resolve_lead_nombre(row, live_names),
        fathom_url=row.fathom_url or "",
        estado=(row.estado or "pendiente").strip(),
        error_msg=(row.error_msg or "").strip() or None,
        participantes=(row.participantes or "").strip() or None,
        motivo_reunion=(row.motivo_reunion or "").strip() or None,
        nivel_dolor=(getattr(row, "nivel_dolor", None) or "").strip() or None,
        capacidad_decision=(getattr(row, "capacidad_decision", None) or "").strip() or None,
        capacidad_economica=(getattr(row, "capacidad_economica", None) or "").strip() or None,
        fit_real=(getattr(row, "fit_real", None) or "").strip() or None,
        objecion_diagnostico=(getattr(row, "objecion_diagnostico", None) or "").strip() or None,
        cambio_energia=(getattr(row, "cambio_energia", None) or "").strip() or None,
        objecion_no_manejada=(getattr(row, "objecion_no_manejada", None) or "").strip() or None,
        razon_real_no_cerrar=(getattr(row, "razon_real_no_cerrar", None) or "").strip() or None,
        compromisos_prometidos=(getattr(row, "compromisos_prometidos", None) or "").strip() or None,
        patrones_y_mejoras=(getattr(row, "patrones_y_mejoras", None) or "").strip() or None,
        resumen=(row.resumen or "").strip() or None,
        hubo_objeciones=(row.hubo_objeciones or "").strip() or None,
        tipo_perfil=(row.tipo_perfil or "").strip() or None,
        ingresos_estimados=(row.ingresos_estimados or "").strip() or None,
        situacion_y_deseo=(row.situacion_y_deseo or "").strip() or None,
        closer_report=(row.closer_report or "").strip() or None,
        dolores_llamada=(row.dolores_llamada or "").strip() or None,
        razon_compra=(row.razon_compra or "").strip() or None,
        program_offered=(row.program_offered or "").strip() or None,
        status_llamada=(row.status_llamada or "").strip() or None,
        created_at=_dt_iso(row.created_at) or "",
        updated_at=_dt_iso(row.updated_at),
    )


def _load_owned_reports(uid: int, ids: list[int]) -> list[CallReportEntity]:
    rows: list[CallReportEntity] = []
    for rid in ids:
        row = CallReportEntity.get(id=rid)
        if row is None or int(row.user_id) != uid:
            continue
        rows.append(row)
    return rows


def _export_payloads(uid: int, ids: list[int]) -> list[dict[str, str]]:
    with db_session:
        rows = _load_owned_reports(uid, ids)
        if not rows:
            raise HTTPException(status_code=404, detail="No se encontraron reportes.")
        live = _lead_nombre_map(uid, {int(r.lead_id) for r in rows})
        payloads: list[dict[str, str]] = []
        for row in rows:
            # Clone with resolved name for export helpers
            class _Tmp:
                pass

            tmp = _Tmp()
            tmp.lead_nombre = _resolve_lead_nombre(row, live)
            tmp.fathom_url = row.fathom_url
            tmp.participantes = row.participantes
            tmp.motivo_reunion = row.motivo_reunion
            for key in (
                "nivel_dolor",
                "capacidad_decision",
                "capacidad_economica",
                "fit_real",
                "objecion_diagnostico",
                "cambio_energia",
                "objecion_no_manejada",
                "razon_real_no_cerrar",
                "compromisos_prometidos",
                "patrones_y_mejoras",
                "resumen",
                "closer_report",
                "hubo_objeciones",
                "tipo_perfil",
                "ingresos_estimados",
                "situacion_y_deseo",
            ):
                setattr(tmp, key, getattr(row, key, None) or "")
            payloads.append(report_as_dict(tmp, _dt_iso(row.created_at) or ""))
        return payloads


@router.get("", response_model=CallReportsListResponse)
def list_call_reports(
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    with db_session:
        rows = [r for r in list(CallReportEntity.select()) if int(r.user_id) == uid]
        rows.sort(key=_sort_ts, reverse=True)
        lead_ids = {int(r.lead_id) for r in rows}
        names = _lead_nombre_map(uid, lead_ids)
        # Backfill snapshot on read when lead still exists
        for r in rows:
            if not (r.lead_nombre or "").strip():
                live = names.get(int(r.lead_id))
                if live:
                    r.lead_nombre = live
        out = [_to_out(r, names) for r in rows]

    return CallReportsListResponse(call_reports=out)


@router.get("/claude-status", response_model=ClaudeApiStatusResponse)
def claude_api_status(
    user_id: Annotated[str, Depends(require_user_id)],
) -> ClaudeApiStatusResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    result = get_claude_status_for_user(uid)
    return ClaudeApiStatusResponse(**result)


@router.get("/fathom-status", response_model=FathomApiStatusResponse)
def fathom_api_status(
    user_id: Annotated[str, Depends(require_user_id)],
) -> FathomApiStatusResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    result = get_fathom_status_for_user(uid)
    return FathomApiStatusResponse(**result)


@router.post("/analyze", response_model=CallReportAnalyzeResponse)
def analyze_call_report_endpoint(
    body: CallReportAnalyzeRequest,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportAnalyzeResponse:
    try:
        uid = int(user_id)
        lead_id = int(body.lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="lead_id o user_id inválido") from e

    fathom_url = normalize_fathom_url(body.fathom_url)
    if not is_fathom_link(fathom_url):
        raise HTTPException(status_code=400, detail="fathom_url inválido.")

    with db_session:
        try:
            lead = LeadEntity[lead_id]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
        if int(lead.user_id) != uid:
            raise HTTPException(status_code=404, detail="Lead no encontrado.")

    report_id, created = get_or_create_report(lead_id, fathom_url, uid)
    should_run = created
    estado = "pendiente"
    if not created:
        with db_session:
            row = CallReportEntity.get(id=report_id)
            estado = (row.estado or "pendiente") if row else "pendiente"
            # Reintentar error/pendiente, o regenerar listo (formato nuevo / re-análisis manual).
            if estado in ("error", "pendiente", "listo"):
                should_run = True
                if row is not None:
                    row.estado = "pendiente"
                    row.error_msg = ""
                estado = "pendiente"

    if should_run:
        background.add_task(analyze_call_report, report_id)

    return CallReportAnalyzeResponse(report_id=report_id, estado=estado)


@router.post("/bulk-delete")
def bulk_delete_call_reports(
    body: CallReportBulkIdsRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, int | str]:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e
    ids = [int(i) for i in body.ids if i is not None]
    if not ids:
        raise HTTPException(status_code=400, detail="ids vacío.")
    deleted = delete_call_reports(uid, ids)
    return {"status": "ok", "deleted": deleted}


@router.post("/bulk-download")
def bulk_download_call_reports(
    body: CallReportBulkIdsRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> Response:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e
    ids = [int(i) for i in body.ids if i is not None]
    if not ids:
        raise HTTPException(status_code=400, detail="ids vacío.")

    payloads = _export_payloads(uid, ids)
    filename = download_filename_for_reports(payloads, "pdf")
    try:
        content = build_call_reports_pdf(payloads)
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail="Falta fpdf2 en el backend (pip install fpdf2).",
        ) from e

    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )


@router.get("/{report_id}", response_model=CallReportOut)
def get_call_report(
    report_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportOut:
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e

    with db_session:
        try:
            row = CallReportEntity[rid]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.")
        names = _lead_nombre_map(uid, {int(row.lead_id)})
        if not (row.lead_nombre or "").strip() and names.get(int(row.lead_id)):
            row.lead_nombre = names[int(row.lead_id)]
        return _to_out(row, names)


@router.post("/{report_id}/reanalyze", response_model=CallReportAnalyzeResponse)
def reanalyze_call_report(
    report_id: str,
    background: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CallReportAnalyzeResponse:
    """Re-lanza el análisis aunque el lead ya no exista."""
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e

    with db_session:
        row = CallReportEntity.get(id=rid)
        if row is None or int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.")
        if (row.estado or "") == "procesando":
            return CallReportAnalyzeResponse(report_id=rid, estado="procesando")
        row.estado = "pendiente"
        row.error_msg = ""

    background.add_task(analyze_call_report, rid)
    return CallReportAnalyzeResponse(report_id=rid, estado="pendiente")


class DiscordNotifyOut(BaseModel):
    sent: bool
    detail: str


@router.post("/{report_id}/discord", response_model=DiscordNotifyOut)
def notify_call_report_discord_endpoint(
    report_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> DiscordNotifyOut:
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e
    try:
        notify_call_report_discord(rid, uid)
    except RuntimeError as e:
        msg = str(e)
        if "no configurado" in msg.lower():
            raise HTTPException(status_code=503, detail=msg) from e
        if "no encontrado" in msg.lower():
            raise HTTPException(status_code=404, detail=msg) from e
        if "no se pudo enviar" in msg.lower():
            raise HTTPException(status_code=502, detail=msg) from e
        raise HTTPException(status_code=400, detail=msg) from e
    return DiscordNotifyOut(sent=True, detail="Análisis enviado a Discord.")


@router.delete("/{report_id}")
def delete_call_report(
    report_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e
    deleted = delete_call_reports(uid, [rid])
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Reporte no encontrado.")
    return {"status": "ok", "id": str(rid)}


@router.get("/{report_id}/download")
def download_call_report(
    report_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> Response:
    try:
        rid = int(report_id)
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="report_id o user_id inválido") from e

    payloads = _export_payloads(uid, [rid])
    filename = download_filename_for_reports(payloads, "pdf")
    try:
        body = build_call_reports_pdf(payloads)
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail="Falta fpdf2 en el backend (pip install fpdf2).",
        ) from e

    return Response(
        content=body,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )
