from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timezone

from src.models import CallReport as CallReportEntity
from src.models import CrmClient as CrmClientEntity
from src.models import Lead as LeadEntity
from src.models import LeadPayment as LeadPaymentEntity
from src.services.programs_services import (
    build_program_norm_duration_map,
    normalize_program_lookup_key,
    program_duration_months_for_prog_raw,
)

DEFAULT_FAMILY_DURATION_MONTHS = 6

SALE_ABIERTO = "abierto"
SALE_CERRADO = "cerrado"

CLIENT_LEAD_STATUSES = frozenset({"cerrado", "sena", "seña"})

TRACKING_GROUPS = (
    ("venta_abierta", "Venta abierta", "Clientes con venta aún no cerrada"),
    ("proxima_vencer", "Próxima a vencer", "Programa al 80% o más de avance"),
    ("vencido", "Programa vencido", "Ya completó o superó la duración del programa"),
    ("buenas_wins", "Buenas wins", "3 o más wins cargadas manualmente"),
    ("recien_iniciado", "Recién iniciado", "Menos del 25% del programa"),
    ("en_curso", "En curso", "Entre 25% y 80% de avance"),
    ("incompleto", "Datos incompletos", "Falta información que no está en el sistema"),
)

_DURATION_RE = re.compile(
    r"(\d{1,3})\s*(?:meses?|mes|m\b|month?s?)",
    re.IGNORECASE,
)


def _norm_status(raw: str | None) -> str:
    s = unicodedata.normalize("NFKD", (raw or "").strip().lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def lead_is_client(lead: LeadEntity) -> bool:
    st = _norm_status(lead.status or lead.estado)
    if st in CLIENT_LEAD_STATUSES:
        return True
    if float(lead.pago or 0) > 0 and st not in ("descalificado", "no show"):
        return True
    return False


def parse_duration_from_text(text: str | None) -> int | None:
    if not text or not str(text).strip():
        return None
    m = _DURATION_RE.search(str(text))
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 120 else None


def _add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, min(d.day, 28))


def compute_progress(start: date, duration_months: int, today: date | None = None) -> tuple[float, int, date]:
    duration = max(1, int(duration_months or 1))
    ref = today or date.today()
    days_elapsed = max(0, (ref - start).days)
    total_days = duration * 30
    percent = min(100.0, max(0.0, round((days_elapsed / total_days) * 100, 1)))
    end = _add_months(start, duration)
    return percent, days_elapsed, end


def normalize_sale_status(raw: str | None) -> str:
    s = _norm_status(raw)
    if s in ("abierto", "open", "pendiente", "sena", "seña"):
        return SALE_ABIERTO
    return SALE_CERRADO


def normalize_wins(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        return [line.strip() for line in raw.splitlines() if line.strip()]
    return []


def _dt_to_date(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.date()


def wins_to_razon_compra(wins: list[str]) -> str:
    return "\n".join(normalize_wins(wins))


def duration_from_program_family(name: str | None) -> int | None:
    nk = normalize_program_lookup_key(name or "")
    if not nk:
        return None
    if "premium" in nk or "vip" in nk:
        return DEFAULT_FAMILY_DURATION_MONTHS
    return None


def _split_win_candidates(text: str | None) -> list[str]:
    if not text or not str(text).strip():
        return []
    raw = str(text).strip()
    parts = re.split(r"[\n\r;|]+", raw)
    out: list[str] = []
    for p in parts:
        s = p.strip().lstrip("-•* ").strip()
        if len(s) >= 4:
            out.append(s)
    return out[:5]


class ClientContext:
    """Caches por usuario para resolver campos sin N+1 queries."""

    def __init__(self, user_id: int) -> None:
        self.user_id = user_id
        self.overlays = {
            int(c.lead_id): c
            for c in CrmClientEntity.select()
            if int(c.user_id) == user_id
        }
        self.program_durations = build_program_norm_duration_map(user_id)
        self.payment_dates: dict[int, list[date]] = defaultdict(list)
        for p in LeadPaymentEntity.select():
            if int(p.user_id) != user_id:
                continue
            if p.fecha:
                self.payment_dates[int(p.lead_id)].append(p.fecha)
        self.call_reports: dict[int, CallReportEntity] = {}
        for cr in CallReportEntity.select():
            if int(cr.user_id) != user_id:
                continue
            lid = int(cr.lead_id)
            prev = self.call_reports.get(lid)
            if prev is None or (cr.created_at or datetime.min) >= (prev.created_at or datetime.min):
                self.call_reports[lid] = cr


def resolve_program_name(lead: LeadEntity, ctx: ClientContext) -> tuple[str, str]:
    prog = (lead.programa_ofrecido or "").strip()
    if prog:
        return prog, "leads.programa_ofrecido"
    alt = (lead.programada_ofrecido_llamada or "").strip()
    if alt:
        return alt, "leads.programada_ofrecido_llamada"
    cr = ctx.call_reports.get(int(lead.id))
    if cr and (cr.program_offered or "").strip():
        return (cr.program_offered or "").strip(), "call_report.program_offered"
    return "", "manual"


def resolve_duration(
    lead: LeadEntity,
    overlay: CrmClientEntity | None,
    program_name: str,
    ctx: ClientContext,
) -> tuple[int | None, str]:
    if overlay is not None and overlay.program_duration_months and int(overlay.program_duration_months) > 0:
        return int(overlay.program_duration_months), "crm_client.manual"
    from_catalog = program_duration_months_for_prog_raw(ctx.program_durations, program_name)
    if from_catalog:
        return from_catalog, "programas.duration_months"
    from_catalog_lead = program_duration_months_for_prog_raw(
        ctx.program_durations, lead.programa_ofrecido
    )
    if from_catalog_lead:
        return from_catalog_lead, "programas.duration_months"
    for src, label in (
        (program_name, "program_name"),
        (lead.programa_ofrecido, "leads.programa_ofrecido"),
        (lead.programada_ofrecido_llamada, "leads.programada_ofrecido_llamada"),
    ):
        parsed = parse_duration_from_text(src)
        if parsed:
            return parsed, f"parsed.{label}"
    for src, label in (
        (program_name, "program_name"),
        (lead.programa_ofrecido, "leads.programa_ofrecido"),
        (lead.programada_ofrecido_llamada, "leads.programada_ofrecido_llamada"),
    ):
        family = duration_from_program_family(src)
        if family:
            return family, "programas.family_default"
    return None, "manual"


def resolve_start_date(
    lead: LeadEntity,
    overlay: CrmClientEntity | None,
    ctx: ClientContext,
) -> tuple[date | None, str]:
    if overlay is not None and overlay.start_date is not None:
        return overlay.start_date, "crm_client.manual"
    pay_dates = ctx.payment_dates.get(int(lead.id), [])
    if pay_dates:
        return min(pay_dates), "cobranzas.primer_pago"
    agendo = _dt_to_date(lead.agendo)
    if agendo:
        return agendo, "leads.agendo"
    created = _dt_to_date(lead.created_at)
    if created:
        return created, "leads.created_at"
    return None, "manual"


def resolve_wins(
    lead: LeadEntity,
    overlay: CrmClientEntity | None,
    ctx: ClientContext,
) -> tuple[list[str], str]:
    del overlay  # wins viven en Leads; CRM edita el mismo campo
    wins: list[str] = []
    for chunk in _split_win_candidates(lead.razon_compra):
        wins.append(chunk)
    cr = ctx.call_reports.get(int(lead.id))
    if cr:
        for chunk in _split_win_candidates(cr.razon_compra):
            if chunk not in wins:
                wins.append(chunk)
    if wins:
        primary = "leads.razon_compra"
        if cr and cr.razon_compra and not (lead.razon_compra or "").strip():
            primary = "call_report.razon_compra"
        return wins, primary
    return [], "manual"


def sale_status_from_lead(lead: LeadEntity, overlay: CrmClientEntity | None) -> tuple[str, str]:
    if overlay is not None and (overlay.sale_status or "").strip():
        return normalize_sale_status(overlay.sale_status), "crm_client.manual"
    st = _norm_status(lead.status or lead.estado)
    if st in ("sena", "seña"):
        return SALE_ABIERTO, "leads.status"
    if st == "cerrado":
        return SALE_CERRADO, "leads.status"
    if float(lead.pago or 0) > 0:
        return SALE_CERRADO, "leads.pago"
    return SALE_ABIERTO, "leads.status"


def client_tags(sale_status: str, progress: float | None, wins: list[str], is_complete: bool) -> list[str]:
    tags: list[str] = []
    if not is_complete:
        tags.append("incompleto")
    if sale_status == SALE_ABIERTO:
        tags.append("venta_abierta")
    if is_complete and progress is not None:
        if progress >= 100:
            tags.append("vencido")
        elif progress >= 80:
            tags.append("proxima_vencer")
        elif progress < 25:
            tags.append("recien_iniciado")
        else:
            tags.append("en_curso")
    if len(wins) >= 3:
        tags.append("buenas_wins")
    return tags


def _dt_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def client_to_out(lead: LeadEntity, overlay: CrmClientEntity | None, ctx: ClientContext) -> dict:
    program_name, program_source = resolve_program_name(lead, ctx)
    duration, duration_source = resolve_duration(lead, overlay, program_name, ctx)
    start, start_source = resolve_start_date(lead, overlay, ctx)
    wins, wins_source = resolve_wins(lead, overlay, ctx)
    sale_status, sale_source = sale_status_from_lead(lead, overlay)

    missing: list[str] = []
    if not (lead.nombre or "").strip():
        missing.append("nombre")
    if not program_name:
        missing.append("programa")
    if not duration:
        missing.append("program_duration_months")
    if not start:
        missing.append("start_date")

    is_complete = len(missing) == 0
    progress: float | None = None
    days_elapsed: int | None = None
    end_date: str | None = None
    if is_complete and start is not None and duration:
        progress, days_elapsed, end = compute_progress(start, duration)
        end_date = end.isoformat()

    field_sources = {
        "full_name": "leads.nombre" if (lead.nombre or "").strip() else "manual",
        "program_name": program_source,
        "program_duration_months": duration_source,
        "start_date": start_source,
        "sale_status": sale_source,
        "wins": wins_source,
        "lead_status": "leads.status",
    }

    tags = client_tags(sale_status, progress, wins, is_complete)

    return {
        "id": str(lead.id),
        "lead_id": str(lead.id),
        "full_name": (lead.nombre or "").strip(),
        "program_name": program_name,
        "program_duration_months": duration,
        "start_date": start.isoformat() if start else None,
        "sale_status": sale_status,
        "lead_status": (lead.status or lead.estado or "").strip() or "Pendiente",
        "wins": wins,
        "notes": (overlay.notes if overlay else "") or "",
        "progress_percent": progress,
        "end_date": end_date,
        "days_elapsed": days_elapsed,
        "tags": tags,
        "is_complete": is_complete,
        "missing_fields": missing,
        "field_sources": field_sources,
        "created_at": _dt_iso(overlay.created_at if overlay else lead.created_at) or "",
        "updated_at": _dt_iso(overlay.updated_at if overlay else None),
    }


def _client_sort_key(client: dict) -> tuple:
    progress = client.get("progress_percent")
    name = (client.get("full_name") or "").lower()
    if progress is None:
        return (1, 0.0, name)
    return (0, -float(progress), name)


def list_clients_for_user(user_id: int) -> list[dict]:
    ctx = ClientContext(user_id)
    leads = [l for l in LeadEntity.select() if int(l.user_id) == user_id and lead_is_client(l)]
    clients = [client_to_out(lead, ctx.overlays.get(int(lead.id)), ctx) for lead in leads]
    clients.sort(key=_client_sort_key)
    return clients


def get_client_for_lead(user_id: int, lead_id: int) -> dict | None:
    ctx = ClientContext(user_id)
    lead = LeadEntity.get(id=lead_id, user_id=user_id)
    if lead is None or not lead_is_client(lead):
        return None
    return client_to_out(lead, ctx.overlays.get(lead_id), ctx)


def tracking_dashboard_for_user(user_id: int) -> dict:
    clients = list_clients_for_user(user_id)
    grouped: dict[str, list[dict]] = {key: [] for key, _, _ in TRACKING_GROUPS}
    for client in clients:
        for tag in client.get("tags") or []:
            if tag in grouped:
                grouped[tag].append(client)
    groups = [
        {"key": key, "label": label, "description": desc, "clients": grouped.get(key, [])}
        for key, label, desc in TRACKING_GROUPS
    ]
    return {"total_clients": len(clients), "groups": groups}


def parse_date_in(val: str | None) -> date | None:
    if val is None or not str(val).strip():
        return None
    head = str(val).strip().split("T")[0].split(" ")[0]
    try:
        y, m, d = [int(x) for x in head.split("-")]
        return date(y, m, d)
    except ValueError:
        return None


def touch_updated(row: CrmClientEntity) -> None:
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)


def upsert_overlay(
    user_id: int,
    lead_id: int,
    *,
    full_name: str | None = None,
    program_name: str | None = None,
    program_duration_months: int | None = None,
    start_date: date | None = None,
    sale_status: str | None = None,
    wins: list[str] | None = None,
    notes: str | None = None,
    unset_start: bool = False,
) -> tuple[LeadEntity, CrmClientEntity]:
    lead = LeadEntity.get(id=lead_id, user_id=user_id)
    if lead is None:
        raise ValueError("lead_not_found")
    if not lead_is_client(lead):
        raise ValueError("lead_not_client")

    if full_name is not None:
        lead.nombre = full_name.strip()
    if program_name is not None:
        lead.programa_ofrecido = program_name.strip()
    if wins is not None:
        lead.razon_compra = wins_to_razon_compra(wins)

    overlay = CrmClientEntity.get(user_id=user_id, lead_id=lead_id)
    if overlay is None:
        overlay = CrmClientEntity(user_id=user_id, lead_id=lead_id)

    if program_duration_months is not None:
        overlay.program_duration_months = int(program_duration_months)
    if unset_start:
        overlay.start_date = None
    elif start_date is not None:
        overlay.start_date = start_date
    if sale_status is not None:
        overlay.sale_status = normalize_sale_status(sale_status)
    if wins is not None:
        overlay.wins = normalize_wins(wins)
    if notes is not None:
        overlay.notes = notes.strip()

    touch_updated(overlay)
    return lead, overlay
