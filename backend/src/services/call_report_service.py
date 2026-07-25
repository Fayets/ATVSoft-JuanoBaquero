"""Orquestación de reportes de llamadas Fathom."""

from __future__ import annotations

from datetime import datetime

from pony.orm import ObjectNotFound, db_session, flush

from src.call_reports_export import (
    build_call_reports_pdf,
    download_filename_for_reports,
    report_as_dict,
)
from src.lead_display_utils import lead_display_nombre
from src.models import ApiConnection
from src.models import CallReport
from src.models import Lead as LeadEntity
from src.services.anthropic_service import normalize_claude_runtime_error
from src.services.call_analysis_service import ANALYSIS_RESULT_KEYS, run_call_analysis
from src.services.discord_service import DiscordServices
from src.services.fathom_service import fetch_fathom_meeting

discord_service = DiscordServices()


def normalize_fathom_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def is_fathom_link(url: str | None) -> bool:
    return bool(url) and "fathom.video" in str(url).lower()


def _snapshot_lead_nombre(lead_id: int) -> str:
    try:
        lead = LeadEntity[lead_id]
    except ObjectNotFound:
        return ""
    return lead_display_nombre(lead.nombre, lead.ig) or (lead.nombre or "").strip() or "Sin nombre"


def get_or_create_report(lead_id: int, fathom_url: str, user_id: int) -> tuple[int, bool]:
    """Devuelve (report_id, created). Si ya existía el link, created=False."""
    normalized = normalize_fathom_url(fathom_url)
    with db_session:
        existing = CallReport.get(fathom_url=normalized)
        if existing:
            # Refrescar snapshot si el lead sigue existiendo.
            if not (existing.lead_nombre or "").strip():
                name = _snapshot_lead_nombre(int(existing.lead_id) or lead_id)
                if name:
                    existing.lead_nombre = name
            return int(existing.id), False
        row = CallReport(
            lead_id=lead_id,
            lead_nombre=_snapshot_lead_nombre(lead_id),
            fathom_url=normalized,
            user_id=user_id,
            estado="pendiente",
        )
        flush()
        return int(row.id), True


def _call_report_created_iso(row: CallReport) -> str:
    dt = row.created_at
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _call_report_pdf(row: CallReport) -> tuple[bytes, str]:
    created = _call_report_created_iso(row)
    export_row = report_as_dict(row, created)
    try:
        pdf_bytes = build_call_reports_pdf([export_row])
    except ImportError as exc:
        raise RuntimeError("Falta fpdf2 en el backend (pip install fpdf2).") from exc
    filename = download_filename_for_reports([export_row], "pdf")
    return pdf_bytes, filename


def _call_analysis_discord_payload(row: CallReport) -> dict[str, str]:
    closer = ""
    try:
        lead = LeadEntity[int(row.lead_id)]
        closer = (lead.closer or "").strip()
    except ObjectNotFound:
        pass
    return {
        "lead_nombre": (row.lead_nombre or "").strip() or "Sin nombre",
        "closer": closer,
        "fathom_url": (row.fathom_url or "").strip(),
        "nivel_dolor": (row.nivel_dolor or "").strip(),
        "fit_real": (row.fit_real or "").strip(),
        "objecion_diagnostico": (row.objecion_diagnostico or "").strip(),
        "razon_real_no_cerrar": (row.razon_real_no_cerrar or "").strip(),
        "patrones_y_mejoras": (row.patrones_y_mejoras or "").strip(),
    }


def notify_call_report_discord(report_id: int, user_id: int) -> None:
    """Envía manualmente el análisis listo al webhook de marketing."""
    if not discord_service.is_call_analysis_webhook_configured():
        raise RuntimeError(
            "Webhook de Discord no configurado (DISCORD_CLOSER_MARKETING_WEBHOOK_URL)."
        )
    with db_session:
        row = CallReport.get(id=report_id)
        if row is None or int(row.user_id) != user_id:
            raise RuntimeError("Reporte no encontrado.")
        if (row.estado or "").strip().lower() != "listo":
            raise RuntimeError("El análisis aún no está listo. Esperá a que termine o reanalizá.")
        payload = _call_analysis_discord_payload(row)
        pdf_bytes, pdf_filename = _call_report_pdf(row)
    sent, discord_err = discord_service.send_call_analysis_to_discord(
        payload,
        pdf_bytes=pdf_bytes,
        pdf_filename=pdf_filename,
    )
    if not sent:
        msg = "No se pudo enviar el reporte a Discord."
        if discord_err:
            msg = f"{msg} {discord_err}"
        raise RuntimeError(msg)


def analyze_call_report(report_id: int) -> None:
    with db_session:
        row = CallReport.get(id=report_id)
        if not row:
            return
        if row.estado in ("procesando", "listo"):
            return
        row.estado = "procesando"
        row.error_msg = ""
        if not (row.lead_nombre or "").strip():
            name = _snapshot_lead_nombre(int(row.lead_id))
            if name:
                row.lead_nombre = name
        fathom_url = row.fathom_url
        user_id = int(row.user_id)
        claude_conn = ApiConnection.get(user_id=user_id, platform="claude")
        claude_api_key = ""
        if claude_conn and isinstance(claude_conn.credentials, dict):
            claude_api_key = str(claude_conn.credentials.get("api_key") or "").strip()

    try:
        meeting = fetch_fathom_meeting(fathom_url, user_id)
        analysis = run_call_analysis(
            meeting.get("transcript") or "",
            api_key=claude_api_key,
        )
        with db_session:
            row = CallReport.get(id=report_id)
            if not row:
                return
            row.participantes = meeting.get("participantes") or ""
            row.motivo_reunion = meeting.get("motivo_reunion") or ""
            for key in ANALYSIS_RESULT_KEYS:
                setattr(row, key, analysis.get(key) or "")
            row.estado = "listo"
            row.updated_at = datetime.utcnow()
            report_uid = int(row.user_id)
        try:
            notify_call_report_discord(report_id, report_uid)
        except Exception:
            pass
    except Exception as exc:
        with db_session:
            row = CallReport.get(id=report_id)
            if not row:
                return
            row.estado = "error"
            row.error_msg = normalize_claude_runtime_error(str(exc))
            row.updated_at = datetime.utcnow()


def delete_call_reports(user_id: int, report_ids: list[int]) -> int:
    deleted = 0
    with db_session:
        for rid in report_ids:
            row = CallReport.get(id=rid)
            if row is None or int(row.user_id) != user_id:
                continue
            row.delete()
            deleted += 1
    return deleted
