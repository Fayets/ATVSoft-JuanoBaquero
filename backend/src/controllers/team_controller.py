import calendar
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session
from pydantic import BaseModel, Field
from starlette.responses import Response

from src.models import CloserReport, SeguimientoReport, SetterReport, TeamMember
from src.services.closer_report_auto_service import (
    AR_TZ,
    generate_closer_report_for_member,
    generate_daily_reports_for_user,
    preview_closer_report,
)
from src.services.discord_service import DiscordServices
from src.team_reports_pdf import build_team_reports_pdf, fecha_iso_a_dd_mm_yyyy

router = APIRouter(prefix="/api/team", tags=["team"], redirect_slashes=False)
discord_service = DiscordServices()

DEFAULT_COMMISSION_PCT = 5.0
VALID_ROLES = frozenset({"setter", "closer", "cash"})
SEGUIMIENTO_MEMBER_ROLES = frozenset({"setter", "closer", "cash"})


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _notas_str(val: str | None) -> str:
    return (val or "").strip()


def _setter_report_discord_payload(r: SetterReport) -> dict[str, Any]:
    sentimiento = _notas_str(r.sentimiento_trafico)
    insights = _notas_str(r.insights_marketing)
    dia_bueno = _notas_str(getattr(r, "dia_bueno_malo", None))
    avatar = _notas_str(r.avatar_tipo_agendas)
    return {
        "fecha": r.fecha.isoformat(),
        "conversaciones": int(r.conversaciones),
        "agendas": int(r.agendas),
        "links_enviados": int(r.links_enviados),
        "leads_nuevos": int(getattr(r, "leads_nuevos", 0) or 0),
        "seguimientos": int(getattr(r, "seguimientos", 0) or 0),
        "outbounds": int(getattr(r, "outbounds", 0) or 0),
        "sentimiento_trafico": sentimiento or None,
        "avatar_tipo_agendas": avatar or None,
        "insights_marketing": insights or None,
        "dia_bueno_malo": dia_bueno or None,
    }


def _closer_ventas_discord_payload(r: CloserReport) -> dict[str, Any]:
    return {
        "fecha": r.fecha.isoformat(),
        "llamadas_agendadas": int(r.llamadas_agendadas),
        "shows": int(r.shows),
        "cierres": int(r.cierres),
        "calificados": int(r.calificados),
        "descalificados": int(r.descalificados),
        "ingreso": float(r.ingreso),
    }


def _member_name_for_report(uid: int, member_id: int) -> str:
    for m in _members_for_user(uid):
        if m.id == member_id:
            return m.nombre
    return "(sin miembro)"


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


def _members_for_user(uid: int) -> list[TeamMember]:
    return [m for m in list(TeamMember.select()) if m.user_id == uid]


def _get_active_member(uid: int, member_id: int, rol: str) -> TeamMember:
    for m in _members_for_user(uid):
        if m.id == member_id and m.activo and m.rol == rol:
            return m
    raise HTTPException(
        status_code=404,
        detail="Miembro no encontrado, inactivo o el rol no coincide con el reporte.",
    )


def _get_member_for_seguimiento(uid: int, member_id: int) -> TeamMember:
    for m in _members_for_user(uid):
        if m.id == member_id and m.activo and m.rol in SEGUIMIENTO_MEMBER_ROLES:
            return m
    raise HTTPException(
        status_code=404,
        detail="Miembro no encontrado, inactivo o rol no válido para seguimiento (setter, closer o cash).",
    )


def _month_range(ym: str) -> tuple[date, date]:
    if not re.match(r"^\d{4}-\d{2}$", ym.strip()):
        raise HTTPException(status_code=400, detail="month debe ser YYYY-MM.")
    y_s, m_s = ym.strip().split("-")
    y, m = int(y_s), int(m_s)
    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Mes inválido en month.")
    start = date(y, m, 1)
    last = calendar.monthrange(y, m)[1]
    end = date(y, m, last)
    return start, end


def _collect_team_reports(uid: int, desde: date, hasta: date) -> list[dict[str, Any]]:
    if hasta < desde:
        raise HTTPException(status_code=400, detail="La fecha hasta debe ser mayor o igual que desde.")
    if (hasta - desde).days > 400:
        raise HTTPException(status_code=400, detail="El rango máximo es 400 días.")

    def _mn(members: dict[int, TeamMember], mid: int) -> str:
        m = members.get(mid)
        return m.nombre if m else "(sin miembro)"

    with db_session:
        members = {m.id: m for m in _members_for_user(uid)}
        rows: list[dict[str, Any]] = []
        for r in list(SetterReport.select()):
            if r.user_id != uid or not (desde <= r.fecha <= hasta):
                continue
            rows.append(
                {
                    "kind": "setter",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "conversaciones": r.conversaciones,
                    "agendas": r.agendas,
                    "links_enviados": r.links_enviados,
                    "notas": r.notas or "",
                    "sentimiento_trafico": r.sentimiento_trafico or "",
                    "avatar_tipo_agendas": r.avatar_tipo_agendas or "",
                    "insights_marketing": r.insights_marketing or "",
                    "leads_nuevos": int(getattr(r, "leads_nuevos", 0) or 0),
                    "seguimientos": int(getattr(r, "seguimientos", 0) or 0),
                    "outbounds": int(getattr(r, "outbounds", 0) or 0),
                    "conversaciones_stories": int(getattr(r, "conversaciones_stories", 0) or 0),
                    "conversaciones_reels": int(getattr(r, "conversaciones_reels", 0) or 0),
                    "agendas_stories": int(getattr(r, "agendas_stories", 0) or 0),
                    "agendas_reels": int(getattr(r, "agendas_reels", 0) or 0),
                    "agendas_ads": int(getattr(r, "agendas_ads", 0) or 0),
                    "links_enviados_stories": int(getattr(r, "links_enviados_stories", 0) or 0),
                    "links_enviados_reels": int(getattr(r, "links_enviados_reels", 0) or 0),
                    "dia_bueno_malo": getattr(r, "dia_bueno_malo", None) or "",
                }
            )
        for r in list(CloserReport.select()):
            if r.user_id != uid or not (desde <= r.fecha <= hasta):
                continue
            rows.append(
                {
                    "kind": "closer",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "llamadas_agendadas": r.llamadas_agendadas,
                    "shows": r.shows,
                    "cierres": r.cierres,
                    "shows_organico": int(getattr(r, "shows_organico", 0) or 0),
                    "shows_ads": int(getattr(r, "shows_ads", 0) or 0),
                    "cierres_organico": int(getattr(r, "cierres_organico", 0) or 0),
                    "cierres_ads": int(getattr(r, "cierres_ads", 0) or 0),
                    "reservas": int(getattr(r, "reservas", 0) or 0),
                    "seguimiento": int(getattr(r, "seguimiento", 0) or 0),
                    "facturacion": float(getattr(r, "facturacion", 0) or 0),
                    "calificados": r.calificados,
                    "descalificados": r.descalificados,
                    "ingreso": float(r.ingreso),
                    "notas": r.notas or "",
                }
            )
        for r in list(SeguimientoReport.select()):
            if r.user_id != uid or not (desde <= r.fecha <= hasta):
                continue
            rows.append(
                {
                    "kind": "seguimiento",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "nombre_lead": (r.nombre_lead or "").strip(),
                    "monto": float(r.monto),
                }
            )
    rows.sort(key=lambda x: (x["fecha"], x["id"]), reverse=True)
    return rows


TEAM_REPORT_FILTROS = frozenset({"todos", "setter", "closer_ventas", "seguimiento"})


def _parse_team_report_filtro(raw: str | None) -> str:
    v = (raw or "todos").strip().lower()
    if v not in TEAM_REPORT_FILTROS:
        raise HTTPException(
            status_code=400,
            detail="filtro debe ser todos, setter, closer_ventas o seguimiento.",
        )
    return v


def _filter_team_reports(rows: list[dict[str, Any]], filtro: str) -> list[dict[str, Any]]:
    if filtro == "todos":
        return rows
    if filtro == "setter":
        return [r for r in rows if r.get("kind") == "setter"]
    if filtro == "closer_ventas":
        return [r for r in rows if r.get("kind") == "closer"]
    if filtro == "seguimiento":
        return [r for r in rows if r.get("kind") == "seguimiento"]
    return rows


class CreateTeamMemberBody(BaseModel):
    nombre: str = Field(min_length=1, max_length=500)
    rol: str


class TeamMemberOut(BaseModel):
    id: int
    nombre: str
    rol: str
    activo: bool


class UpdateTeamMemberBody(BaseModel):
    nombre: str | None = None
    activo: bool | None = None


class SetterReportBody(BaseModel):
    member_id: int
    fecha: date
    conversaciones: int = 0
    agendas: int = 0
    links_enviados: int = 0
    conversaciones_stories: int = 0
    conversaciones_reels: int = 0
    agendas_stories: int = 0
    agendas_reels: int = 0
    agendas_ads: int = 0
    links_enviados_stories: int = 0
    links_enviados_reels: int = 0
    notas: str | None = None
    sentimiento_trafico: str | None = None
    avatar_tipo_agendas: str | None = None
    insights_marketing: str | None = None
    leads_nuevos: int = 0
    seguimientos: int = 0
    outbounds: int = 0
    dia_bueno_malo: str | None = None


class CloserReportBody(BaseModel):
    member_id: int
    fecha: date
    llamadas_agendadas: int = 0
    shows: int = 0
    cierres: int = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0


class SeguimientoReportBody(BaseModel):
    member_id: int
    fecha: date
    nombre_lead: str = Field(min_length=1, max_length=500)
    monto: float = Field(ge=0)


class CloserReportPreviewOut(BaseModel):
    llamadas_agendadas: int = 0
    shows: int = 0
    cierres: int = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0


class CloserReportGenerateOut(BaseModel):
    id: int
    updated: bool
    llamadas_agendadas: int = 0
    shows: int = 0
    cierres: int = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0
    discord_sent: bool = False


class CloserReportGenerateDayOut(BaseModel):
    fecha: str
    generated: int
    discord_sent: bool = False


class ReportSavedOut(BaseModel):
    id: int
    updated: bool


class DiscordNotifyOut(BaseModel):
    sent: bool
    detail: str


class SetterStatsOut(BaseModel):
    member_id: int
    nombre: str
    conversaciones: int
    agendas: int
    links_enviados: int
    # Base imputable ($): agendas × ticket medio equipo (ingreso/cierres en el mes)
    generado: float
    comision: float


class CloserStatsOut(BaseModel):
    member_id: int
    nombre: str
    llamadas_agendadas: int
    shows: int
    cierres: int
    calificados: int
    descalificados: int
    ingreso: float
    comision: float


class TeamDashboardOut(BaseModel):
    month: str
    cash_total: float
    comisiones: float
    commission_pct: float
    total_conversaciones: int = Field(
        ...,
        description="Suma de conversaciones de todos los SetterReport del mes (user_id).",
    )
    setters: list[SetterStatsOut]
    closers: list[CloserStatsOut]


class TeamDashboardDailyRow(BaseModel):
    fecha: str = Field(..., description="YYYY-MM-DD (día calendario del reporte setter).")
    conversaciones: int = Field(..., ge=0, description="Suma de conversaciones ese día (todos los SetterReport del usuario).")


@router.get("/members")
def list_members(
    user_id: str = Depends(require_user_id),
    incluir_inactivos: bool = Query(False, description="Incluye miembros desactivados (útil para edición / historial)."),
) -> dict[str, Any]:
    uid = _parse_uid(user_id)
    with db_session:
        pool = _members_for_user(uid)
        if not incluir_inactivos:
            pool = [m for m in pool if m.activo]
        setters = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "setter"
        ]
        closers = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "closer"
        ]
        cash_members = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "cash"
        ]
        return {
            "setters": [s.model_dump() for s in setters],
            "closers": [c.model_dump() for c in closers],
            "cash": [x.model_dump() for x in cash_members],
        }


@router.post("/members")
def create_member(body: CreateTeamMemberBody, user_id: str = Depends(require_user_id)) -> TeamMemberOut:
    uid = _parse_uid(user_id)
    rol = body.rol.strip().lower()
    if rol not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail="rol debe ser 'setter', 'closer' o 'cash'.",
        )
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="nombre es obligatorio.")
    with db_session:
        m = TeamMember(user_id=uid, nombre=nombre, rol=rol, activo=True)
        m.flush()
        return TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)


@router.delete("/members/{member_id}")
def delete_member(member_id: int, user_id: str = Depends(require_user_id)) -> dict[str, str]:
    """Elimina el miembro y todos sus reportes (setter, closer y seguimiento) del mismo usuario."""
    uid = _parse_uid(user_id)
    with db_session:
        found: TeamMember | None = None
        for m in _members_for_user(uid):
            if m.id == member_id:
                found = m
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Miembro no encontrado.")
        for r in list(SetterReport.select()):
            if r.user_id == uid and r.member_id == member_id:
                r.delete()
        for r in list(CloserReport.select()):
            if r.user_id == uid and r.member_id == member_id:
                r.delete()
        for r in list(SeguimientoReport.select()):
            if r.user_id == uid and r.member_id == member_id:
                r.delete()
        found.delete()
    return {"status": "ok"}


@router.patch("/members/{member_id}")
def update_member(
    member_id: int,
    body: UpdateTeamMemberBody,
    user_id: str = Depends(require_user_id),
) -> TeamMemberOut:
    uid = _parse_uid(user_id)
    if body.nombre is None and body.activo is None:
        raise HTTPException(status_code=400, detail="Enviá al menos nombre o activo para actualizar.")
    with db_session:
        found: TeamMember | None = None
        for m in _members_for_user(uid):
            if m.id == member_id:
                found = m
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Miembro no encontrado.")
        if body.nombre is not None:
            n = body.nombre.strip()
            if not n:
                raise HTTPException(status_code=400, detail="nombre no puede estar vacío.")
            found.nombre = n
        if body.activo is not None:
            found.activo = body.activo
        return TeamMemberOut(id=found.id, nombre=found.nombre, rol=found.rol, activo=found.activo)


@router.get("/reports")
def list_team_reports(
    desde: date = Query(..., description="Inicio del rango (YYYY-MM-DD)"),
    hasta: date = Query(..., description="Fin del rango (YYYY-MM-DD)"),
    user_id: str = Depends(require_user_id),
) -> dict[str, Any]:
    uid = _parse_uid(user_id)
    rows = _collect_team_reports(uid, desde, hasta)
    return {"reports": rows}


@router.get("/reports/pdf")
def team_reports_pdf(
    desde: date = Query(...),
    hasta: date = Query(...),
    filtro: str = Query(
        "todos",
        description="todos | setter | closer_ventas | seguimiento",
    ),
    user_id: str = Depends(require_user_id),
) -> Response:
    uid = _parse_uid(user_id)
    rows = _collect_team_reports(uid, desde, hasta)
    rows = _filter_team_reports(rows, _parse_team_report_filtro(filtro))
    try:
        body = build_team_reports_pdf(rows)
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail="Falta la librería de PDF. En la carpeta backend ejecutá: pip install fpdf2",
        ) from e
    fn = f"reportes_equipo_{fecha_iso_a_dd_mm_yyyy(desde.isoformat())}_{fecha_iso_a_dd_mm_yyyy(hasta.isoformat())}.pdf"
    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@router.post("/setter-reports")
def save_setter_report(body: SetterReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    member_name = ""
    result: ReportSavedOut
    with db_session:
        member = _get_active_member(uid, body.member_id, "setter")
        member_name = member.nombre
        existing = [
            r
            for r in list(SetterReport.select())
            if r.user_id == uid and r.member_id == body.member_id and r.fecha == body.fecha
        ]
        if existing:
            r = existing[0]
            r.conversaciones = body.conversaciones
            r.agendas = body.agendas
            r.links_enviados = body.links_enviados
            r.conversaciones_stories = body.conversaciones_stories
            r.conversaciones_reels = body.conversaciones_reels
            r.agendas_stories = body.agendas_stories
            r.agendas_reels = body.agendas_reels
            r.agendas_ads = body.agendas_ads
            r.links_enviados_stories = body.links_enviados_stories
            r.links_enviados_reels = body.links_enviados_reels
            r.notas = _notas_str(body.notas)
            r.sentimiento_trafico = _notas_str(body.sentimiento_trafico)
            r.avatar_tipo_agendas = _notas_str(body.avatar_tipo_agendas)
            r.insights_marketing = _notas_str(body.insights_marketing)
            r.leads_nuevos = body.leads_nuevos
            r.seguimientos = body.seguimientos
            r.outbounds = body.outbounds
            r.dia_bueno_malo = _notas_str(body.dia_bueno_malo)
            result = ReportSavedOut(id=r.id, updated=True)
        else:
            r = SetterReport(
                user_id=uid,
                member_id=body.member_id,
                fecha=body.fecha,
                conversaciones=body.conversaciones,
                agendas=body.agendas,
                links_enviados=body.links_enviados,
                conversaciones_stories=body.conversaciones_stories,
                conversaciones_reels=body.conversaciones_reels,
                agendas_stories=body.agendas_stories,
                agendas_reels=body.agendas_reels,
                agendas_ads=body.agendas_ads,
                links_enviados_stories=body.links_enviados_stories,
                links_enviados_reels=body.links_enviados_reels,
                notas=_notas_str(body.notas),
                sentimiento_trafico=_notas_str(body.sentimiento_trafico),
                avatar_tipo_agendas=_notas_str(body.avatar_tipo_agendas),
                insights_marketing=_notas_str(body.insights_marketing),
                leads_nuevos=body.leads_nuevos,
                seguimientos=body.seguimientos,
                outbounds=body.outbounds,
                dia_bueno_malo=_notas_str(body.dia_bueno_malo),
            )
            r.flush()
            result = ReportSavedOut(id=r.id, updated=False)

    try:
        discord_service.send_setter_report_to_discord(member_name, body.model_dump(mode="json"))
    except Exception:
        pass

    return result


@router.post("/setter-reports/{report_id}/discord", response_model=DiscordNotifyOut)
def notify_setter_report_discord(
    report_id: int,
    user_id: str = Depends(require_user_id),
) -> DiscordNotifyOut:
    uid = _parse_uid(user_id)
    if not discord_service.is_setter_webhook_configured():
        raise HTTPException(
            status_code=503,
            detail="Webhook de Discord no configurado (DISCORD_SETTER_WEBHOOK_URL).",
        )
    with db_session:
        found: SetterReport | None = None
        for r in list(SetterReport.select()):
            if r.id == report_id and r.user_id == uid:
                found = r
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Reporte setter no encontrado.")
        member_name = _member_name_for_report(uid, found.member_id)
        payload = _setter_report_discord_payload(found)

    sent = discord_service.send_setter_report_to_discord(member_name, payload)
    if not sent:
        raise HTTPException(status_code=502, detail="No se pudo enviar el reporte a Discord.")
    return DiscordNotifyOut(sent=True, detail="Reporte enviado a Discord.")


@router.post("/closer-reports/{report_id}/discord", response_model=DiscordNotifyOut)
def notify_closer_report_discord(
    report_id: int,
    user_id: str = Depends(require_user_id),
) -> DiscordNotifyOut:
    uid = _parse_uid(user_id)
    with db_session:
        found: CloserReport | None = None
        for r in list(CloserReport.select()):
            if r.id == report_id and r.user_id == uid:
                found = r
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Reporte closer no encontrado.")
        member_name = _member_name_for_report(uid, found.member_id)
        if not discord_service.is_closer_ventas_webhook_configured():
            raise HTTPException(
                status_code=503,
                detail="Webhook de Discord no configurado (DISCORD_CLOSER_VENTAS_WEBHOOK_URL).",
            )
        payload = _closer_ventas_discord_payload(found)

    sent = discord_service.send_closer_ventas_to_discord(member_name, payload)
    if not sent:
        raise HTTPException(status_code=502, detail="No se pudo enviar el reporte a Discord.")
    return DiscordNotifyOut(sent=True, detail="Reporte enviado a Discord.")


@router.get("/closer-reports/preview", response_model=CloserReportPreviewOut)
def closer_report_preview(
    member_id: int = Query(...),
    fecha: date = Query(...),
    user_id: str = Depends(require_user_id),
) -> CloserReportPreviewOut:
    uid = _parse_uid(user_id)
    try:
        metrics = preview_closer_report(uid, member_id, fecha)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return CloserReportPreviewOut(**metrics)


@router.post("/closer-reports/generate", response_model=CloserReportGenerateOut)
def generate_closer_report(
    member_id: int = Query(...),
    fecha: date = Query(...),
    send_discord: bool = Query(True, description="Enviar a Discord al generar"),
    user_id: str = Depends(require_user_id),
) -> CloserReportGenerateOut:
    uid = _parse_uid(user_id)
    with db_session:
        _get_active_member(uid, member_id, "closer")
    try:
        report, updated = generate_closer_report_for_member(
            uid,
            member_id,
            fecha,
            send_discord=send_discord,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    discord_sent = send_discord and discord_service.is_closer_ventas_webhook_configured()
    return CloserReportGenerateOut(
        id=report.id,
        updated=updated,
        llamadas_agendadas=int(report.llamadas_agendadas),
        shows=int(report.shows),
        cierres=int(report.cierres),
        calificados=int(report.calificados),
        descalificados=int(report.descalificados),
        ingreso=float(report.ingreso),
        discord_sent=discord_sent,
    )


@router.post("/closer-reports/generate-day", response_model=CloserReportGenerateDayOut)
def generate_closer_reports_day(
    fecha: date | None = Query(None, description="YYYY-MM-DD; default hoy Argentina"),
    send_discord: bool = Query(True, description="Enviar a Discord al generar"),
    user_id: str = Depends(require_user_id),
) -> CloserReportGenerateDayOut:
    uid = _parse_uid(user_id)
    target = fecha or datetime.now(AR_TZ).date()
    count = generate_daily_reports_for_user(uid, target, send_discord=send_discord)
    if count == 0:
        raise HTTPException(
            status_code=400,
            detail="No hay llamadas en el panel para generar reportes en esta fecha.",
        )
    discord_sent = send_discord and discord_service.is_closer_ventas_webhook_configured()
    return CloserReportGenerateDayOut(
        fecha=target.isoformat(),
        generated=count,
        discord_sent=discord_sent,
    )


@router.post("/closer-reports")
def save_closer_report(body: CloserReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    member_name = ""
    result: ReportSavedOut
    discord_payload: dict[str, Any] | None = None
    with db_session:
        member = _get_active_member(uid, body.member_id, "closer")
        member_name = member.nombre
        existing = [
            r
            for r in list(CloserReport.select())
            if r.user_id == uid
            and r.member_id == body.member_id
            and r.fecha == body.fecha
        ]
        if existing:
            r = existing[0]
            r.llamadas_agendadas = body.llamadas_agendadas
            r.shows = body.shows
            r.cierres = body.cierres
            r.calificados = body.calificados
            r.descalificados = body.descalificados
            r.ingreso = body.ingreso
            r.shows_organico = 0
            r.shows_ads = 0
            r.cierres_organico = 0
            r.cierres_ads = 0
            r.notas = ""
            result = ReportSavedOut(id=r.id, updated=True)
        else:
            r = CloserReport(
                user_id=uid,
                member_id=body.member_id,
                fecha=body.fecha,
                llamadas_agendadas=body.llamadas_agendadas,
                shows=body.shows,
                cierres=body.cierres,
                calificados=body.calificados,
                descalificados=body.descalificados,
                ingreso=body.ingreso,
                shows_organico=0,
                shows_ads=0,
                cierres_organico=0,
                cierres_ads=0,
                notas="",
            )
            r.flush()
            result = ReportSavedOut(id=r.id, updated=False)
        discord_payload = _closer_ventas_discord_payload(r)

    if discord_payload is not None:
        try:
            discord_service.send_closer_ventas_to_discord(member_name, discord_payload)
        except Exception:
            pass

    return result


@router.post("/seguimiento-reports")
def save_seguimiento_report(
    body: SeguimientoReportBody,
    user_id: str = Depends(require_user_id),
) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    nl = body.nombre_lead.strip()
    if not nl:
        raise HTTPException(status_code=400, detail="Indicá el nombre del lead.")
    with db_session:
        _get_member_for_seguimiento(uid, body.member_id)
        r = SeguimientoReport(
            user_id=uid,
            member_id=body.member_id,
            fecha=body.fecha,
            nombre_lead=nl,
            monto=float(body.monto),
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.get("/seguimiento-reports/month")
def seguimiento_reports_month(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> dict[str, Any]:
    """Totales y filas del mes para sumar a cash collected en el dashboard de ventas."""
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    with db_session:
        entries = [
            {"fecha": r.fecha.isoformat(), "monto": float(r.monto)}
            for r in list(SeguimientoReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]
    total = sum(e["monto"] for e in entries)
    return {"total": total, "entries": entries}


@router.get("/dashboard/daily", response_model=list[TeamDashboardDailyRow])
def team_dashboard_daily(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> list[TeamDashboardDailyRow]:
    """Conversaciones por día (suma de SetterReport del usuario en ese mes)."""
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    with db_session:
        rows_data = [
            (r.fecha, int(r.conversaciones))
            for r in list(SetterReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]
    by_day: dict[date, int] = defaultdict(int)
    for f, c in rows_data:
        by_day[f] += c

    out: list[TeamDashboardDailyRow] = []
    d = start
    while d <= end:
        out.append(
            TeamDashboardDailyRow(
                fecha=d.isoformat(),
                conversaciones=int(by_day.get(d, 0)),
            )
        )
        d += timedelta(days=1)
    return out


@router.get("/dashboard")
def team_dashboard(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> TeamDashboardOut:
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    ym = month.strip()

    with db_session:
        setter_rows = [
            r
            for r in list(SetterReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]
        total_conversaciones = sum(int(r.conversaciones) for r in setter_rows)
        closer_rows = [
            r
            for r in list(CloserReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]

        members_by_id = {m.id: m for m in _members_for_user(uid)}

        setter_totals: dict[int, dict[str, int]] = {}
        for r in setter_rows:
            acc = setter_totals.setdefault(
                r.member_id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            acc["conversaciones"] += r.conversaciones
            acc["agendas"] += r.agendas
            acc["links_enviados"] += r.links_enviados

        closer_totals: dict[int, dict[str, float | int]] = {}
        for r in closer_rows:
            acc = closer_totals.setdefault(
                r.member_id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            acc["llamadas_agendadas"] = int(acc["llamadas_agendadas"]) + r.llamadas_agendadas
            acc["shows"] = int(acc["shows"]) + r.shows
            acc["cierres"] = int(acc["cierres"]) + r.cierres
            acc["calificados"] = int(acc["calificados"]) + r.calificados
            acc["descalificados"] = int(acc["descalificados"]) + r.descalificados
            acc["ingreso"] = float(acc["ingreso"]) + float(r.ingreso)

        active_setters = [m for m in members_by_id.values() if m.activo and m.rol == "setter"]
        active_closers = [m for m in members_by_id.values() if m.activo and m.rol == "closer"]

        pct = DEFAULT_COMMISSION_PCT / 100.0

        closer_out: list[CloserStatsOut] = []
        comisiones_closer = 0.0
        cash_total = 0.0
        total_cierres_mes = 0
        for m in sorted(active_closers, key=lambda x: x.id):
            t = closer_totals.get(
                m.id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            ing = float(t["ingreso"])
            ci = int(t["cierres"])
            cash_total += ing
            total_cierres_mes += ci
            com = ing * pct
            comisiones_closer += com
            closer_out.append(
                CloserStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    llamadas_agendadas=int(t["llamadas_agendadas"]),
                    shows=int(t["shows"]),
                    cierres=ci,
                    calificados=int(t["calificados"]),
                    descalificados=int(t["descalificados"]),
                    ingreso=ing,
                    comision=com,
                )
            )

        avg_ticket = (cash_total / total_cierres_mes) if total_cierres_mes > 0 else 0.0

        setter_out: list[SetterStatsOut] = []
        comisiones_setter = 0.0
        for m in sorted(active_setters, key=lambda x: x.id):
            t = setter_totals.get(
                m.id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            agendas = int(t["agendas"])
            generado = avg_ticket * agendas
            com_set = generado * pct
            comisiones_setter += com_set
            setter_out.append(
                SetterStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    conversaciones=int(t["conversaciones"]),
                    agendas=agendas,
                    links_enviados=int(t["links_enviados"]),
                    generado=generado,
                    comision=com_set,
                )
            )

        comisiones = comisiones_closer + comisiones_setter

    return TeamDashboardOut(
        month=ym,
        cash_total=cash_total,
        comisiones=comisiones,
        commission_pct=DEFAULT_COMMISSION_PCT,
        total_conversaciones=total_conversaciones,
        setters=setter_out,
        closers=closer_out,
    )
