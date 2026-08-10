"""Importación idempotente CRM legacy juano → ATV (lead, lead_payment, legacy_cuota_ref, legacy_lead_ref)."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from pony.orm import db_session, flush, rollback

from src.db import db
from src.models import Lead, LeadPayment, LegacyCuotaRef, LegacyLeadRef

LEGACY_SOURCE = "legacy_juano"
CIERRE_NUEVO_CONCEPTOS = frozenset({"PIF", "1ra Cuota"})
ATIPICO_MONTOS = frozenset(range(1, 15))
GHL_FUENTE_PLACEHOLDER = "{{ custom_values.offer_name }} Strategy Session"
GHL_CONTACT_RE = re.compile(r"GHL contact_id:\s*(\S+)", re.IGNORECASE)
MATCH_DATE_WINDOW_DAYS = 1
PAYMENT_MATCH_DATE_WINDOW_DAYS = 30

MERGE_FILL_FIELDS = ("email", "telefono", "nombre", "origen", "keyword")
NEVER_TOUCH_FIELDS = frozenset({"status", "estado", "closer", "setter", "notas"})

CLOSER_ALIASES: dict[str, str] = {
    "catalina": "Catalina Zarlenga",
    "ignacio": "Ignacio Claveria",
    "matias": "Matías Sandobal",
}

TEST_NAMES = frozenset(
    n.casefold()
    for n in (
        "PRUEBA 5",
        "PRUEBA MEDICOS Y SEGURIDAD INDUSTRIAL LATAM SAS",
        "x",
        "DFS",
        "Uuaq",
        "Oko",
        "yuyu",
        "veran",
        "dsfd",
        "fgghhhh",
    )
)

TEST_EMAILS = frozenset(
    e.casefold()
    for e in (
        "x@gmail.com",
        "ws@gmail.com",
        "uuq@gmail.com",
        "oko@gmail.com",
        "yuyu@gmail.com",
        "awm@oytk.com",
        "djjej@gmail.com",
        "prueba12@gmail.com",
        "nicholas@gmail.com",
        "veran@gmail.com",
    )
)

SITUACION_TO_STATUS: dict[str, str] = {
    "venta": "Cerrado",
    "en seguimiento": "Seguimiento",
    "adentro en seguimiento": "Seguimiento",
    "no show": "No show",
    "lead descartado": "Descalificado",
    "reagendó": "Re-agenda",
    "reagendo": "Re-agenda",
    "nuevo": "Pendiente",
    "no agendó": "Pendiente",
    "no agendo": "Pendiente",
    "llamada cancelada": "Pendiente",
    "canceló": "Pendiente",
    "cancelo": "Pendiente",
    "fee": "Seguimiento",
    "no cerró": "Seguimiento",
    "no cerro": "Seguimiento",
    "adentro en llamada": "Seguimiento",
}

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

NULL_MARKERS = frozenset({"—", "–", "-", "", "N/A", "n/a", "null", "None"})
DUPLICADO_CUOTA_WINDOW_MINUTES = 10

COLLISION_SCORE_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("nombre", ("nombre",)),
    ("correo", ("correo",)),
    ("telefono", ("tel_norm", "telefono")),
    ("producto", ("producto",)),
    ("situacion", ("situacion",)),
    ("presento", ("presento",)),
    ("fecha_agenda", ("fecha_agenda",)),
    ("fecha_llamada", ("fecha_llamada",)),
    ("calificado", ("calificado",)),
)


def clean(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return None if s in NULL_MARKERS else s


def normalize_csv_row(row: dict[str, str]) -> dict[str, str]:
    return {k: (clean(v) or "") for k, v in row.items()}


@dataclass
class ImportLogEntry:
    table: str
    legacy_id: str
    action: str
    detail: str = ""


@dataclass
class ImportStats:
    leads_inserted: int = 0
    leads_skipped: int = 0
    pagos_inserted: int = 0
    pagos_skipped: int = 0
    cuotas_inserted: int = 0
    cuotas_skipped: int = 0
    cuotas_excluded: int = 0
    leads_excluded: int = 0
    excluded_leads: list[dict[str, str]] = field(default_factory=list)
    excluded_cuotas: list[dict[str, str]] = field(default_factory=list)
    leads_created_from_pagos: int = 0
    leads_matched_existing_atv: int = 0
    match_tel: int = 0
    match_email: int = 0
    match_nombre: int = 0
    match_created: int = 0
    leads_merged: int = 0
    leads_created_new: int = 0
    match_ghl_contact_call: int = 0
    match_ghl_contact_agendo: int = 0
    match_tel10: int = 0
    match_ambiguo: int = 0
    posible_duplicado_nombre: int = 0
    match_by_method: dict[str, int] = field(default_factory=dict)
    match_by_month: dict[str, dict[str, int]] = field(default_factory=dict)
    merge_targets: dict[int, list[dict[str, str]]] = field(default_factory=dict)
    merge_absorbed: int = 0
    merge_collision_groups: int = 0
    collision_details: list["CollisionDetail"] = field(default_factory=list)
    pagos_usd_total: float = 0.0
    pagos_usd_julio: float = 0.0
    pagos_matched_existing: int = 0
    pagos_new_contact: int = 0
    atv_leads_by_period: dict[str, int] = field(default_factory=dict)
    flags: dict[str, int] = field(default_factory=dict)
    logs: list[ImportLogEntry] = field(default_factory=list)

    def log(self, table: str, legacy_id: str, action: str, detail: str = "") -> None:
        self.logs.append(ImportLogEntry(table, legacy_id, action, detail))

    def flag(self, name: str, n: int = 1) -> None:
        self.flags[name] = self.flags.get(name, 0) + n

    def bump_match(self, method: str, month_key: str | None = None) -> None:
        self.match_by_method[method] = self.match_by_method.get(method, 0) + 1
        if month_key:
            bucket = self.match_by_month.setdefault(month_key, {})
            bucket[method] = bucket.get(method, 0) + 1
            bucket["_total"] = bucket.get("_total", 0) + 1

    def record_merge_target(
        self,
        lead_id: int,
        *,
        legacy_id: str,
        nombre: str,
        fecha_llamada: date | None,
        method: str,
        atv_nombre: str = "",
    ) -> None:
        self.merge_targets.setdefault(int(lead_id), []).append(
            {
                "legacy_id": legacy_id,
                "nombre": nombre,
                "fecha_llamada": fecha_llamada.isoformat() if fecha_llamada else "",
                "method": method,
                "atv_nombre": atv_nombre,
            }
        )


@dataclass
class LeadMatchResult:
    lead: Lead | None
    method: str
    score: float
    ambiguous: bool = False
    candidate_ids: list[int] = field(default_factory=list)
    posible_duplicado: bool = False


@dataclass
class DuplicateReportSample:
    legacy_id: str
    nombre_csv: str
    nombre_atv: str
    method: str
    diffs: list[str]


@dataclass
class CuotaReportItem:
    legacy_id: str
    alumno: str
    monto_total: float | None
    abonado: float | None
    saldo: float | None
    detail: str


@dataclass
class CollisionDetail:
    atv_lead_id: int
    atv_nombre: str
    winner_legacy_id: str
    winner_nombre: str
    winner_reason: str
    rows: list[dict[str, str]]


@dataclass
class LeadRowPlan:
    row: dict[str, str]
    legacy_id: str
    nombre: str
    email: str
    telefono: str
    tel_raw: str
    tel_invalido: str | None
    action: str
    match: LeadMatchResult | None
    lead_id: int | None
    period_key: str
    meta: dict[str, Any]
    status: str
    keyword: str
    producto: str
    closer_raw: str
    agendo: datetime | None
    created_at: datetime
    fecha_bot: datetime
    fecha_llamada: date | None
    fecha_agenda: date | None
    absorb_motivo: str = ""
    collision_score: int = 0


@dataclass
class MergeCollisionSample:
    atv_lead_id: int
    atv_nombre: str
    csv_rows: list[dict[str, str]]


@dataclass
class DuplicateReport:
    total_csv: int = 0
    leads_origin_total: int = 0
    excluded_leads: list[dict[str, str]] = field(default_factory=list)
    would_merge: int = 0
    would_create: int = 0
    match_ambiguo: int = 0
    posible_duplicado_nombre: int = 0
    by_method: dict[str, int] = field(default_factory=dict)
    by_month: dict[str, dict[str, int]] = field(default_factory=dict)
    merge_targets: dict[int, list[dict[str, str]]] = field(default_factory=dict)
    merge_lead_names: dict[int, str] = field(default_factory=dict)
    samples: list[DuplicateReportSample] = field(default_factory=list)
    cuotas_duplicado_probable: int = 0
    cuotas_sobrepago: int = 0
    cuotas_duplicado_items: list[CuotaReportItem] = field(default_factory=list)
    cuotas_sobrepago_items: list[CuotaReportItem] = field(default_factory=list)


def _norm_key(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", str(text).strip())
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def normalize_closer(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    key = _norm_key(s)
    return CLOSER_ALIASES.get(key, s)


def normalize_producto_norm(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s or s.casefold() == "null":
        return ""
    if "herramienta 3 meses" in s.casefold():
        return "Otro"
    return s


def validate_phone(raw: str | None) -> tuple[str, str | None]:
    """Retorna (tel usable, tel invalido para legacy_meta)."""
    s = re.sub(r"\D", "", str(raw or "").strip())
    if not s:
        return "", None
    if len(s) < 8 or len(s) > 15:
        return "", s
    return s, None


def parse_date(raw: str | None) -> date | None:
    raw = clean(raw)
    if raw is None:
        return None
    head = raw.split("T")[0].split(" ")[0]
    if head.startswith("0026-"):
        head = "20" + head[2:]
    try:
        y, m, d = [int(x) for x in head.split("-")]
        return date(y, m, d)
    except ValueError:
        return None


def parse_dt(raw: str | None) -> datetime | None:
    raw = clean(raw)
    if raw is None:
        return None
    s = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        d = parse_date(raw)
        if d:
            return datetime(d.year, d.month, d.day)
        return None


def extract_email(*texts: str | None) -> str:
    for t in texts:
        if not t:
            continue
        m = EMAIL_RE.search(str(t))
        if m:
            return m.group(0).casefold()
    return ""


def is_test_lead(nombre: str, email: str) -> bool:
    return _norm_key(nombre) in TEST_NAMES or email.casefold() in TEST_EMAILS


def map_situacion(situacion: str | None) -> tuple[str, str]:
    raw = (situacion or "").strip()
    key = _norm_key(raw)
    mapped = SITUACION_TO_STATUS.get(key, "Pendiente")
    return mapped, raw


def map_fuente(fuente: str | None) -> tuple[str, str]:
    raw = (fuente or "").strip()
    if GHL_FUENTE_PLACEHOLDER.casefold() in raw.casefold() or "{{" in raw:
        return "Desconocido", raw
    return raw, raw


def merge_meta(existing: Any, patch: dict) -> dict:
    base: dict = dict(existing) if isinstance(existing, dict) else {}
    base.update(patch)
    return base


def load_expected_counts(data_dir: Path) -> dict[str, Any] | None:
    path = data_dir / "expected_counts.json"
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else None


def compute_merge_collision_stats(
    merge_targets: dict[int, list[dict[str, str]]],
    *,
    lead_names: dict[int, str] | None = None,
) -> tuple[int, int, int, int, list[MergeCollisionSample]]:
    merge_rows = sum(len(rows) for rows in merge_targets.values())
    distinct_leads = len(merge_targets)
    collision_groups = {lid: rows for lid, rows in merge_targets.items() if len(rows) > 1}
    collisions = len(collision_groups)
    max_rows = max((len(rows) for rows in merge_targets.values()), default=0)
    samples: list[MergeCollisionSample] = []
    for lead_id, rows in sorted(collision_groups.items(), key=lambda x: -len(x[1]))[:10]:
        atv_name = (lead_names or {}).get(lead_id, "")
        samples.append(
            MergeCollisionSample(
                atv_lead_id=lead_id,
                atv_nombre=atv_name,
                csv_rows=list(rows),
            )
        )
    return merge_rows, distinct_leads, collisions, max_rows, samples


def _period_bucket_summary(bucket: dict[str, int]) -> str:
    total = bucket.get("_total", 0)
    merge = sum(
        v
        for k, v in bucket.items()
        if k not in ("_total", "nuevo") and "ambiguo" not in k and "posible" not in k
    )
    nuevo = bucket.get("nuevo", 0)
    return f"total={total} merge~={merge} nuevo={nuevo} detalle={bucket}"


def format_leads_reconciliation(
    *,
    origin_total: int | None,
    excluded: list[dict[str, str]],
    merge_rows: int,
    create_rows: int,
) -> list[str]:
    excluded_n = len(excluded)
    origin = origin_total if origin_total is not None else excluded_n + merge_rows + create_rows
    expected_net = origin - excluded_n
    lines = [
        "--- LEADS (reconciliación) ---",
        f"  Origen (expected_counts) : {origin}",
        f"  Excluidos (es_prueba)    : {excluded_n:4d}",
    ]
    for item in excluded:
        lines.append(f"    - {item.get('nombre', '?')} <{item.get('email', '')}>")
    lines.extend([
        f"  Esperado neto            : {expected_net}",
        f"  ├─ merge                 : {merge_rows}",
        f"  └─ nuevos                : {create_rows}",
    ])
    actual_net = merge_rows + create_rows
    if actual_net != expected_net:
        lines.append(f"  ⚠️  merge+nuevos={actual_net} ≠ esperado neto={expected_net} (delta={actual_net - expected_net})")
    return lines


def format_merge_collision_section(
    merge_targets: dict[int, list[dict[str, str]]],
    *,
    lead_names: dict[int, str] | None = None,
    merge_absorbed: int = 0,
    collision_groups: int = 0,
    collision_details: list[CollisionDetail] | None = None,
    merge_row_count: int | None = None,
) -> list[str]:
    merge_rows, distinct_leads, collisions, max_rows, samples = compute_merge_collision_stats(
        merge_targets, lead_names=lead_names
    )
    if merge_row_count is not None:
        merge_rows = merge_row_count
    if collision_groups:
        max_rows = max(max_rows, 2)
    lines = [
        "--- MERGES ---",
        f"  Filas CSV con merge           : {merge_rows}",
        f"  Leads ATV distintos alcanzados: {distinct_leads}",
        f"  Colisiones (2+ filas → 1 lead): {collision_groups or collisions}",
    ]
    if collision_groups or merge_absorbed:
        lines.extend([
            f"  ├─ ganadoras (merge)          : {collision_groups}",
            f"  └─ absorbidas (sin lead nuevo): {merge_absorbed}",
        ])
    lines.append(f"  Máximo de filas sobre un lead : {max_rows}")
    if collision_details:
        lines.append("--- Colisiones resueltas (todas) ---")
        for detail in collision_details:
            lines.append(
                f"  ATV lead_id={detail.atv_lead_id} {detail.atv_nombre!r} "
                f"→ ganadora={detail.winner_nombre!r} ({detail.winner_reason})"
            )
            for row in detail.rows:
                lines.append(
                    f"    [{row['rol']}] {row['nombre']!r} legacy={row['legacy_id'][:8]}… "
                    f"fecha={row.get('fecha_llamada') or '—'} method={row.get('method')} score={row.get('score')}"
                )
    elif collisions > 0:
        lines.append("--- Colisiones (muestra hasta 10) ---")
        for sample in samples:
            lines.append(f"  ATV lead_id={sample.atv_lead_id} nombre={sample.atv_nombre!r}")
            for row in sample.csv_rows:
                lines.append(
                    f"    csv legacy={row['legacy_id'][:8]}… nombre={row['nombre']!r} "
                    f"fecha_llamada={row.get('fecha_llamada') or '—'} method={row.get('method', '')}"
                )
    return lines


def format_pagos_section(stats: ImportStats, expected: dict[str, Any] | None) -> list[str]:
    exp_total = expected.get("pagos_usd_total") if expected else None
    exp_julio = expected.get("pagos_usd_julio") if expected else None
    ok_total = ""
    ok_julio = ""
    if exp_total is not None:
        ok_total = " ✅" if round(stats.pagos_usd_total, 2) == round(float(exp_total), 2) else " ❌"
    if exp_julio is not None:
        ok_julio = " ✅" if round(stats.pagos_usd_julio, 2) == round(float(exp_julio), 2) else " ❌"
    lines = [
        "--- PAGOS ---",
        f"  Filas insertadas    : {stats.pagos_inserted}",
        f"  Suma USD            : {stats.pagos_usd_total:.2f}"
        + (f"   (esperado: {float(exp_total):.2f}){ok_total}" if exp_total is not None else ""),
        f"  Suma USD julio 2026 : {stats.pagos_usd_julio:.2f}"
        + (f"   (esperado: {float(exp_julio):.2f}){ok_julio}" if exp_julio is not None else ""),
        f"  Contactos nuevos    : {stats.pagos_new_contact}",
        f"  Matcheados a lead   : {stats.pagos_matched_existing}",
    ]
    return lines


def format_match_rate_table(
    csv_by_period: dict[str, dict[str, int]],
    atv_by_period: dict[str, int],
) -> list[str]:
    lines = ["--- Tasa de match CSV vs ATV (por periodo) ---"]
    for period in sorted(set(csv_by_period) | set(atv_by_period)):
        bucket = csv_by_period.get(period, {})
        csv_total = bucket.get("_total", 0)
        merges = sum(
            v
            for k, v in bucket.items()
            if k not in ("_total", "nuevo") and "ambiguo" not in k and "posible" not in k
        )
        atv_n = atv_by_period.get(period, 0)
        tasa = f"{100.0 * merges / atv_n:.1f}%" if atv_n else "n/a"
        lines.append(
            f"  {period} | CSV: {csv_total} | ATV: {atv_n} | merges: {merges} | tasa: {tasa}"
        )
    return lines


def format_period_breakdown(by_period: dict[str, dict[str, int]], *, title: str) -> list[str]:
    lines = [title]
    for period in sorted(by_period.keys()):
        lines.append(f"  {period}: {_period_bucket_summary(by_period[period])}")
    return lines


def extract_ghl_contact_id(lead: Lead) -> str:
    cid = (getattr(lead, "ghl_contact_id", None) or "").strip()
    if cid:
        return cid
    m = GHL_CONTACT_RE.search(str(lead.notas or ""))
    return m.group(1) if m else ""


def tel_digits(raw: str | None) -> str:
    return re.sub(r"\D", "", str(raw or "").strip())


def tel_last10(digits: str) -> str:
    return digits[-10:] if len(digits) >= 10 else digits


def dt_to_date(val: datetime | date | None) -> date | None:
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    return val.date()


def dates_within_window(a: date | None, b: date | None, days: int = MATCH_DATE_WINDOW_DAYS) -> bool:
    if a is None or b is None:
        return False
    return abs((a - b).days) <= days


def month_key_from_row(row: dict[str, str]) -> str:
    for key in ("fecha", "fecha_agenda", "fecha_llamada", "created_at"):
        d = parse_date(row.get(key))
        if d:
            return f"{d.year}-{d.month:02d}"
    return "unknown"


def period_key_from_row(row: dict[str, str]) -> str:
    """Mes calendario; junio 2026 partido en H1 (d≤14) y H2 (d≥15)."""
    for key in ("fecha", "fecha_agenda", "fecha_llamada", "created_at"):
        d = parse_date(row.get(key))
        if d:
            month = f"{d.year}-{d.month:02d}"
            if d.year == 2026 and d.month == 6:
                return f"{month}-H1" if d.day <= 14 else f"{month}-H2"
            return month
    return "unknown"


def _cuota_row_excluded(alumno: str) -> bool:
    return _norm_key(alumno) in TEST_NAMES or alumno.casefold() == "fgghhhh"


def _parse_cuota_float(raw: str | None) -> float | None:
    s = clean(raw)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def detect_cuota_duplicados(rows: list[dict[str, str]]) -> dict[str, str]:
    """legacy_id → duplicado_grupo: mismo alumno, created_at ≤10 min; siguiente_cobro solo si ambos tienen valor."""
    from collections import defaultdict

    by_alumno: dict[str, list[tuple[str, dict[str, str], datetime | None]]] = defaultdict(list)
    for row in rows:
        legacy_id = (row.get("id") or "").strip()
        alumno = unicodedata.normalize("NFKC", (row.get("alumno") or "").strip())
        if _cuota_row_excluded(alumno):
            continue
        by_alumno[_norm_key(alumno)].append((legacy_id, row, parse_dt(row.get("created_at"))))

    marked: dict[str, str] = {}
    window_secs = DUPLICADO_CUOTA_WINDOW_MINUTES * 60
    for alumno_key, items in by_alumno.items():
        if len(items) < 2:
            continue
        for i, (id_a, row_a, t_a) in enumerate(items):
            if t_a is None:
                continue
            for id_b, row_b, t_b in items[i + 1 :]:
                if t_b is None:
                    continue
                if abs((t_a - t_b).total_seconds()) > window_secs:
                    continue
                sig_a = clean(row_a.get("siguiente_cobro"))
                sig_b = clean(row_b.get("siguiente_cobro"))
                if sig_a and sig_b:
                    if sig_a != sig_b:
                        continue
                elif sig_a or sig_b:
                    continue
                sig_label = sig_a or sig_b or "sin_siguiente"
                grupo = f"{alumno_key}|{sig_label}"
                marked[id_a] = grupo
                marked[id_b] = grupo
    return marked


def analyze_cuotas_csv(rows: list[dict[str, str]]) -> tuple[int, int, list[CuotaReportItem], list[CuotaReportItem]]:
    duplicados = detect_cuota_duplicados(rows)
    dup_items: list[CuotaReportItem] = []
    sobrepago_items: list[CuotaReportItem] = []
    seen_dup: set[str] = set()
    seen_sob: set[str] = set()

    for row in rows:
        legacy_id = (row.get("id") or "").strip()
        alumno = unicodedata.normalize("NFKC", (row.get("alumno") or "").strip())
        if _cuota_row_excluded(alumno):
            continue
        monto_total = _parse_cuota_float(row.get("monto_total"))
        abonado = _parse_cuota_float(row.get("abonado"))
        saldo = _parse_cuota_float(row.get("saldo"))

        if legacy_id in duplicados and legacy_id not in seen_dup:
            seen_dup.add(legacy_id)
            dup_items.append(
                CuotaReportItem(
                    legacy_id=legacy_id,
                    alumno=alumno,
                    monto_total=monto_total,
                    abonado=abonado,
                    saldo=saldo,
                    detail=f"grupo={duplicados[legacy_id]}",
                )
            )

        if saldo is not None and saldo < 0 and legacy_id not in seen_sob:
            seen_sob.add(legacy_id)
            sobrepago_items.append(
                CuotaReportItem(
                    legacy_id=legacy_id,
                    alumno=alumno,
                    monto_total=monto_total,
                    abonado=abonado,
                    saldo=saldo,
                    detail=f"sobrepago_monto={abs(saldo)}",
                )
            )

    return len(dup_items), len(sobrepago_items), dup_items, sobrepago_items


def resolve_agendo(row: dict[str, str]) -> tuple[datetime | None, str | None]:
    """agendo = fecha_agenda → fecha → created_at (marcado inferido)."""
    ag = parse_dt(row.get("fecha_agenda"))
    if ag is not None:
        return ag, None
    ag = parse_dt(row.get("fecha"))
    if ag is not None:
        return ag, "fecha"
    ag = parse_dt(row.get("created_at"))
    if ag is not None:
        return ag, "created_at"
    return None, None


def _lead_has_legacy_id(lead: Lead, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    if (lead.legacy_id or "").strip() == lid:
        return True
    meta = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
    imported = meta.get("imported_legacy_ids")
    if isinstance(imported, list) and lid in imported:
        return True
    return False


def _field_diffs(csv_row: dict[str, str], lead: Lead) -> list[str]:
    diffs: list[str] = []
    pairs = (
        ("nombre", "nombre", csv_row.get("nombre")),
        ("email", "email", (csv_row.get("correo") or "").casefold()),
        ("telefono", "telefono", csv_row.get("tel_norm") or csv_row.get("telefono")),
    )
    for label, attr, csv_val in pairs:
        csv_s = str(csv_val or "").strip()
        atv_s = str(getattr(lead, attr, "") or "").strip()
        if csv_s and atv_s and csv_s.casefold() != atv_s.casefold():
            diffs.append(f"{label}: csv={csv_s!r} atv={atv_s!r}")
    return diffs


def rows_leads_for_user(uid: int) -> list[Lead]:
    return [r for r in list(Lead.select()) if int(r.user_id) == uid]


def lead_ids_with_legacy_ref(uid: int) -> set[int]:
    out: set[int] = set()
    for ref in rows_lead_refs_for_user(uid):
        if ref.lead_id is not None:
            out.add(int(ref.lead_id))
    return out


def is_pago_huerfano_lead(lead: Lead, ref_lead_ids: set[int]) -> bool:
    return (lead.source or "") == LEGACY_SOURCE and int(lead.id) not in ref_lead_ids


def sum_payments_usd(uid: int) -> float:
    total = 0.0
    for p in rows_payments_for_user(uid):
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        if meta.get("es_programado") or meta.get("monto_cero"):
            continue
        total += float(p.monto or 0)
    return round(total, 2)


def rows_payments_for_user(uid: int) -> list[LeadPayment]:
    return [r for r in list(LeadPayment.select()) if int(r.user_id) == uid]


def rows_cuotas_for_user(uid: int) -> list[LegacyCuotaRef]:
    return [r for r in list(LegacyCuotaRef.select()) if int(r.user_id) == uid]


def legacy_id_exists_lead(uid: int, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    for r in rows_leads_for_user(uid):
        if _lead_has_legacy_id(r, lid):
            return True
    return False


def legacy_id_exists_payment(uid: int, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    for r in rows_payments_for_user(uid):
        if (r.legacy_id or "").strip() == lid:
            return True
    return False


def legacy_id_exists_cuota(uid: int, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    for r in rows_cuotas_for_user(uid):
        if (r.legacy_id or "").strip() == lid:
            return True
    return False


def rows_lead_refs_for_user(uid: int) -> list[LegacyLeadRef]:
    return [r for r in list(LegacyLeadRef.select()) if int(r.user_id) == uid]


def legacy_id_exists_lead_ref(uid: int, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    for r in rows_lead_refs_for_user(uid):
        if (r.legacy_id or "").strip() == lid:
            return True
    return False


def legacy_id_processed(uid: int, legacy_id: str) -> bool:
    return legacy_id_exists_lead(uid, legacy_id) or legacy_id_exists_lead_ref(uid, legacy_id)


NAME_CONNECTORS = frozenset({"y", "and", "de", "del", "la", "los", "las", "e", "o"})


def name_tokens(raw: str | None) -> set[str]:
    nk = _norm_key(raw)
    return {t for t in nk.split() if t and t not in NAME_CONNECTORS}


def mismo_nombre(a: str | None, b: str | None) -> bool:
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    return ta <= tb or tb <= ta


def score_lead_csv_row(row: dict[str, str]) -> tuple[int, datetime | None]:
    count = 0
    for _label, keys in COLLISION_SCORE_FIELDS:
        val = ""
        for key in keys:
            val = (row.get(key) or "").strip()
            if val:
                break
        if clean(val) is not None:
            count += 1
    return count, parse_dt(row.get("created_at"))


def pick_collision_winner(plans: list[LeadRowPlan]) -> tuple[LeadRowPlan, str]:
    atv_nombre = ""
    if plans and plans[0].match and plans[0].match.lead:
        atv_nombre = str(plans[0].match.lead.nombre or "")

    candidates = list(plans)
    if atv_nombre:
        atv_matches = [p for p in plans if mismo_nombre(atv_nombre, p.nombre)]
        if len(atv_matches) == 1:
            atv_matches[0].collision_score = score_lead_csv_row(atv_matches[0].row)[0]
            return atv_matches[0], "coincide_nombre_atv"
        if len(atv_matches) > 1:
            candidates = atv_matches

    best = candidates[0]
    best_score, best_created = score_lead_csv_row(best.row)
    best.collision_score = best_score
    for plan in candidates[1:]:
        score, created = score_lead_csv_row(plan.row)
        plan.collision_score = score
        if score > best_score:
            best, best_score, best_created = plan, score, created
        elif score == best_score:
            if created and best_created and created > best_created:
                best, best_created = plan, created
            elif created and not best_created:
                best, best_created = plan, created
    if len(candidates) > 1 and all(score_lead_csv_row(p.row)[0] == best_score for p in candidates):
        reason = f"empate score={best_score}, gana created_at más reciente"
    else:
        reason = f"score={best_score} campos no nulos"
    return best, reason


def resolve_merge_collisions(plans: list[LeadRowPlan]) -> list[CollisionDetail]:
    by_lead: dict[int, list[LeadRowPlan]] = defaultdict(list)
    for plan in plans:
        if plan.action == "merge" and plan.lead_id is not None:
            by_lead[int(plan.lead_id)].append(plan)

    details: list[CollisionDetail] = []
    for lead_id, group in by_lead.items():
        if len(group) < 2:
            continue
        winner, reason = pick_collision_winner(group)
        atv_nombre = str(winner.match.lead.nombre or "") if winner.match and winner.match.lead else ""
        row_summaries: list[dict[str, str]] = []
        for plan in group:
            is_winner = plan.legacy_id == winner.legacy_id
            if not is_winner:
                if not mismo_nombre(winner.nombre, plan.nombre):
                    plan.action = "create"
                    plan.lead_id = None
                    plan.absorb_motivo = ""
                    plan.meta["colision_rechazada_por_apellido"] = True
                    if plan.match:
                        plan.match = LeadMatchResult(
                            None, "colision_rechazada_apellido", plan.match.score
                        )
                    row_summaries.append(
                        {
                            "legacy_id": plan.legacy_id,
                            "nombre": plan.nombre,
                            "fecha_llamada": plan.fecha_llamada.isoformat() if plan.fecha_llamada else "",
                            "method": "colision_rechazada_apellido",
                            "score": str(plan.collision_score or score_lead_csv_row(plan.row)[0]),
                            "rol": "nuevo_separado",
                        }
                    )
                    continue
                plan.action = "absorb"
                plan.absorb_motivo = f"collision_absorbed:{reason}"
            row_summaries.append(
                {
                    "legacy_id": plan.legacy_id,
                    "nombre": plan.nombre,
                    "fecha_llamada": plan.fecha_llamada.isoformat() if plan.fecha_llamada else "",
                    "method": plan.match.method if plan.match else "",
                    "score": str(plan.collision_score or score_lead_csv_row(plan.row)[0]),
                    "rol": "ganadora" if is_winner else "absorbida",
                }
            )
        details.append(
            CollisionDetail(
                atv_lead_id=lead_id,
                atv_nombre=atv_nombre,
                winner_legacy_id=winner.legacy_id,
                winner_nombre=winner.nombre,
                winner_reason=reason,
                rows=row_summaries,
            )
        )
    return details


def fetch_atv_leads_by_period(user_id: int) -> dict[str, int]:
    """Conteo de leads ATV por periodo (jun-2026 partido H1/H2)."""
    from decouple import config

    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return {}
    try:
        import psycopg2
    except ImportError:
        return {}
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return {}
    result: dict[str, int] = defaultdict(int)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  to_char(agendo, 'YYYY-MM') AS mes,
                  CASE WHEN EXTRACT(DAY FROM agendo) <= 14 THEN 'H1' ELSE 'H2' END AS quincena,
                  COUNT(*) AS leads_atv
                FROM lead
                WHERE user_id = %s AND agendo IS NOT NULL
                GROUP BY 1, 2
                ORDER BY 1, 2
                """,
                (user_id,),
            )
            for mes, quincena, count in cur.fetchall():
                if mes == "2026-06":
                    key = f"{mes}-{quincena}"
                else:
                    key = str(mes)
                result[key] += int(count)
    finally:
        conn.close()
    return dict(result)


@dataclass
class IdentityIndex:
    by_tel: dict[str, Lead]
    by_tel10: dict[str, Lead]
    by_email: dict[str, Lead]
    by_name: dict[str, Lead]
    by_ghl_contact: dict[str, list[Lead]]

    @classmethod
    def build(cls, uid: int) -> IdentityIndex:
        return cls.build_from_leads(rows_leads_for_user(uid))

    @classmethod
    def build_from_leads(cls, leads: list[Lead]) -> IdentityIndex:
        by_tel: dict[str, Lead] = {}
        by_tel10: dict[str, Lead] = {}
        by_email: dict[str, Lead] = {}
        by_name: dict[str, Lead] = {}
        by_ghl_contact: dict[str, list[Lead]] = {}
        for lead in leads:
            digits = tel_digits(lead.telefono)
            if digits and digits not in by_tel:
                by_tel[digits] = lead
            t10 = tel_last10(digits)
            if t10 and t10 not in by_tel10:
                by_tel10[t10] = lead
            em = (lead.email or "").strip().casefold()
            if em and em not in by_email:
                by_email[em] = lead
            nk = _norm_key(lead.nombre)
            if nk and nk not in by_name:
                by_name[nk] = lead
            ghl = extract_ghl_contact_id(lead)
            if ghl:
                by_ghl_contact.setdefault(ghl, []).append(lead)
        return cls(
            by_tel=by_tel,
            by_tel10=by_tel10,
            by_email=by_email,
            by_name=by_name,
            by_ghl_contact=by_ghl_contact,
        )

    def register(self, lead: Lead) -> None:
        digits = tel_digits(lead.telefono)
        if digits:
            self.by_tel[digits] = lead
        t10 = tel_last10(digits)
        if t10:
            self.by_tel10[t10] = lead
        em = (lead.email or "").strip().casefold()
        if em:
            self.by_email[em] = lead
        nk = _norm_key(lead.nombre)
        if nk:
            self.by_name[nk] = lead
        ghl = extract_ghl_contact_id(lead)
        if ghl:
            self.by_ghl_contact.setdefault(ghl, []).append(lead)


def _match_ghl_contact_date(
    candidates: list[Lead],
    ref_date: date | None,
    attr: str,
) -> tuple[Lead | None, bool, list[int]]:
    if not candidates or ref_date is None:
        return None, False, []
    matched: list[Lead] = []
    for lead in candidates:
        dt = getattr(lead, attr, None)
        if dates_within_window(dt_to_date(dt), ref_date):
            matched.append(lead)
    if len(matched) == 1:
        return matched[0], False, [int(matched[0].id)]
    if len(matched) > 1:
        return None, True, [int(m.id) for m in matched]
    return None, False, []


def resolve_lead_from_csv(
    index: IdentityIndex,
    *,
    ghl_contact_id: str | None,
    fecha_llamada: date | None,
    fecha_agenda: date | None,
    tel_norm: str | None,
    email: str | None,
    nombre: str | None,
) -> LeadMatchResult:
    ghl = (ghl_contact_id or "").strip()
    if ghl:
        candidates = index.by_ghl_contact.get(ghl, [])
        if candidates:
            lead, amb, cids = _match_ghl_contact_date(candidates, fecha_llamada, "call")
            if amb:
                return LeadMatchResult(None, "ghl_contact_call_ambiguo", 0.0, True, cids)
            if lead is not None:
                return LeadMatchResult(lead, "ghl_contact_call", 0.99, False, cids)
            lead, amb, cids = _match_ghl_contact_date(candidates, fecha_agenda, "agendo")
            if amb:
                return LeadMatchResult(None, "ghl_contact_agendo_ambiguo", 0.0, True, cids)
            if lead is not None:
                return LeadMatchResult(lead, "ghl_contact_agendo", 0.97, False, cids)

    digits = tel_digits(tel_norm)
    if digits and digits in index.by_tel:
        lead = index.by_tel[digits]
        return LeadMatchResult(lead, "tel_norm", 1.0, False, [int(lead.id)])
    t10 = tel_last10(digits)
    if t10 and t10 in index.by_tel10:
        lead = index.by_tel10[t10]
        return LeadMatchResult(lead, "tel10", 0.92, False, [int(lead.id)])

    em = (email or "").strip().casefold()
    if em and em in index.by_email:
        lead = index.by_email[em]
        return LeadMatchResult(lead, "email", 0.95, False, [int(lead.id)])

    nk = _norm_key(nombre)
    if nk and nk in index.by_name:
        lead = index.by_name[nk]
        return LeadMatchResult(None, "nombre_posible_duplicado", 0.85, False, [int(lead.id)], True)

    return LeadMatchResult(None, "nuevo", 0.0)


def merge_lead_from_csv(lead: Lead, row: dict[str, str], meta: dict[str, Any], match: LeadMatchResult) -> None:
    snapshot_lead_if_atv(lead)
    meta_patch = dict(meta)
    meta_patch["match_method"] = match.method
    meta_patch["match_score"] = match.score
    meta_patch["legacy_lead"] = dict(row)
    existing = lead.legacy_meta if isinstance(lead.legacy_meta, dict) else {}
    imported = list(existing.get("imported_legacy_ids") or [])
    lid = (row.get("id") or "").strip()
    if lid and lid not in imported:
        imported.append(lid)
    meta_patch["imported_legacy_ids"] = imported
    lead.legacy_meta = merge_meta(existing, meta_patch)

    ghl = (row.get("ghl_contact_id") or "").strip()
    if ghl and not (getattr(lead, "ghl_contact_id", None) or "").strip():
        lead.ghl_contact_id = ghl

    tel_raw = row.get("tel_norm") or row.get("telefono") or ""
    telefono_csv, _ = validate_phone(tel_raw)
    fill_map = {
        "email": (row.get("correo") or "").strip().casefold(),
        "telefono": telefono_csv,
        "nombre": unicodedata.normalize("NFKC", (row.get("nombre") or "").strip()),
        "origen": (row.get("origen") or "").strip(),
        "keyword": map_fuente(row.get("fuente"))[0],
    }
    for field in MERGE_FILL_FIELDS:
        if field not in NEVER_TOUCH_FIELDS:
            cur = (getattr(lead, field, None) or "").strip()
            new_val = fill_map.get(field, "")
            if not cur and new_val:
                setattr(lead, field, new_val)


@dataclass
class PaymentLeadMatch:
    lead: Lead | None
    method: str
    score: float
    tier: str  # auto | review | none
    candidate_ids: list[int] = field(default_factory=list)
    note: str = ""


def _leads_by_name_tokens(leads: list[Lead], nombre: str | None) -> list[Lead]:
    if not (nombre or "").strip():
        return []
    return [lead for lead in leads if mismo_nombre(nombre, lead.nombre)]


def _leads_by_name_date(
    leads: list[Lead],
    nombre: str | None,
    fecha_pago: date | None,
    *,
    days: int = PAYMENT_MATCH_DATE_WINDOW_DAYS,
) -> list[Lead]:
    if fecha_pago is None:
        return []
    matched: list[Lead] = []
    for lead in _leads_by_name_tokens(leads, nombre):
        for attr in ("call", "agendo", "fecha_bot", "created_at"):
            dt = dt_to_date(getattr(lead, attr, None))
            if dates_within_window(dt, fecha_pago, days):
                matched.append(lead)
                break
    return matched


def resolve_lead_for_payment(
    index: IdentityIndex,
    target_leads: list[Lead],
    *,
    tel_norm: str | None,
    email: str | None,
    nombre: str | None,
    fecha_pago: date | None = None,
    allow_name_date_match: bool = False,
) -> PaymentLeadMatch:
    """Resuelve lead destino para un pago. tier=auto → reconciliar sin revisión."""

    digits = tel_digits(tel_norm)
    if digits and digits in index.by_tel:
        lead = index.by_tel[digits]
        return PaymentLeadMatch(lead, "tel_norm", 1.0, "auto", [int(lead.id)])

    t10 = tel_last10(digits)
    if t10 and t10 in index.by_tel10:
        lead = index.by_tel10[t10]
        return PaymentLeadMatch(lead, "tel10", 0.92, "auto", [int(lead.id)])

    em = (email or "").strip().casefold()
    if em and em in index.by_email:
        lead = index.by_email[em]
        return PaymentLeadMatch(lead, "email", 0.95, "auto", [int(lead.id)])

    name_date_hits = _leads_by_name_date(target_leads, nombre, fecha_pago)
    if len(name_date_hits) == 1:
        lead = name_date_hits[0]
        tier = "auto" if allow_name_date_match else "review"
        return PaymentLeadMatch(
            lead if allow_name_date_match else lead,
            "nombre_fecha",
            0.82,
            tier,
            [int(lead.id)],
        )
    if len(name_date_hits) > 1:
        cids = [int(x.id) for x in name_date_hits]
        return PaymentLeadMatch(
            None,
            "nombre_fecha_ambiguo",
            0.0,
            "review",
            cids,
            note=f"{len(name_date_hits)} candidatos",
        )

    nk = _norm_key(nombre)
    if nk and nk in index.by_name:
        lead = index.by_name[nk]
        return PaymentLeadMatch(lead, "nombre_exacto", 0.85, "review", [int(lead.id)])

    token_hits = _leads_by_name_tokens(target_leads, nombre)
    if len(token_hits) == 1:
        lead = token_hits[0]
        return PaymentLeadMatch(lead, "nombre_tokens", 0.78, "review", [int(lead.id)])
    if len(token_hits) > 1:
        cids = [int(x.id) for x in token_hits]
        return PaymentLeadMatch(
            None,
            "nombre_tokens_ambiguo",
            0.0,
            "review",
            cids,
            note=f"{len(token_hits)} candidatos por tokens",
        )

    return PaymentLeadMatch(None, "none", 0.0, "none", [])


def resolve_lead(
    uid: int,
    index: IdentityIndex,
    *,
    tel_norm: str | None,
    email: str | None,
    nombre: str | None,
    stats: ImportStats,
    context_legacy_id: str,
    fecha_pago: date | None = None,
) -> tuple[Lead | None, str, float]:
    target_leads = rows_leads_for_user(uid)
    match = resolve_lead_for_payment(
        index,
        target_leads,
        tel_norm=tel_norm,
        email=email,
        nombre=nombre,
        fecha_pago=fecha_pago,
        allow_name_date_match=True,
    )
    if match.lead is not None:
        stats.log("match", context_legacy_id, match.method, f"lead_id={match.lead.id}")
        return match.lead, match.method, match.score
    return None, "none", 0.0


def fuzzy_match_lead(uid: int, alumno: str, min_score: float = 0.82) -> tuple[Lead | None, float, str]:
    nk = _norm_key(alumno)
    if not nk:
        return None, 0.0, "none"
    best: Lead | None = None
    best_score = 0.0
    for lead in rows_leads_for_user(uid):
        score = SequenceMatcher(None, nk, _norm_key(lead.nombre)).ratio()
        if score > best_score:
            best_score = score
            best = lead
    if best is not None and best_score >= min_score:
        return best, best_score, "fuzzy_nombre"
    return None, best_score, "fuzzy_low"


def snapshot_lead_if_atv(lead: Lead) -> None:
    if (lead.source or "atv") != "atv":
        return
    meta = merge_meta(getattr(lead, "legacy_meta", None), {})
    if meta.get("pre_import_snapshot"):
        return
    meta["pre_import_snapshot"] = {
        "pago": float(lead.pago or 0),
        "debe": lead.debe,
        "status": lead.status or lead.estado or "",
        "programa_ofrecido": lead.programa_ofrecido or "",
        "snapshot_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    }
    lead.legacy_meta = meta


def recalc_lead_financials(uid: int, lead: Lead, payments: list[LeadPayment]) -> None:
    lead_payments = [p for p in payments if int(p.lead_id) == int(lead.id)]
    total = 0.0
    for p in lead_payments:
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        if meta.get("es_programado"):
            continue
        if meta.get("monto_cero"):
            continue
        total += float(p.monto or 0)
    lead.pago = total

    contract_prices: list[float] = []
    conflict = False
    cierre_prices: list[float] = []
    for p in lead_payments:
        meta = p.legacy_meta if isinstance(p.legacy_meta, dict) else {}
        pc = meta.get("precio_contrato")
        if pc is None:
            continue
        try:
            val = float(pc)
        except (TypeError, ValueError):
            continue
        contract_prices.append(val)
        if (p.concepto or "") in CIERRE_NUEVO_CONCEPTOS:
            cierre_prices.append(val)

    contract: float | None = None
    if len(cierre_prices) == 1:
        contract = cierre_prices[0]
    elif len(cierre_prices) > 1:
        contract = max(cierre_prices)
        conflict = True
    elif contract_prices:
        contract = max(contract_prices)
        if len(set(contract_prices)) > 1:
            conflict = True

    if contract is not None:
        raw_debe = contract - total
        meta = merge_meta(getattr(lead, "legacy_meta", None), {})
        if raw_debe < 0:
            meta["sobrepago"] = True
            meta["sobrepago_monto"] = abs(raw_debe)
            lead.debe = 0.0
        else:
            lead.debe = raw_debe
        if conflict:
            meta["precio_contrato_conflicto"] = True
        lead.legacy_meta = meta
    else:
        lead.debe = None
        meta = merge_meta(getattr(lead, "legacy_meta", None), {})
        if conflict:
            meta["precio_contrato_conflicto"] = True
            lead.legacy_meta = meta

    valid_product = ""
    for p in lead_payments:
        prod = normalize_producto_norm(p.producto)
        if prod and prod not in ("Sin especificar", "Otro"):
            valid_product = prod
            break
        if prod and not valid_product:
            valid_product = prod
    if valid_product and not (lead.programa_ofrecido or "").strip():
        lead.programa_ofrecido = valid_product

    for p in lead_payments:
        if (p.concepto or "") in CIERRE_NUEVO_CONCEPTOS:
            st = (lead.status or lead.estado or "").strip()
            if st in ("", "Pendiente", "Agendado", "agendado"):
                lead.status = "Cerrado"
                lead.estado = "Cerrado"
            break


def ensure_db_mapping() -> None:
    import src.models  # noqa: F401
    from src.db import _migrate_postgres_legacy_juano

    _migrate_postgres_legacy_juano()
    if db.schema is None:
        db.generate_mapping(create_tables=True)


def list_auth_users() -> list[tuple[int, str]]:
    from src.models import AuthUser

    ensure_db_mapping()
    with db_session:
        return [(int(u.id), str(u.username or "")) for u in list(AuthUser.select())]


def resolve_target_user(user_id: int) -> tuple[int, str]:
    from src.models import AuthUser

    ensure_db_mapping()
    with db_session:
        users = [(int(u.id), str(u.username or "")) for u in list(AuthUser.select())]
        for uid, name in users:
            if uid == user_id:
                return uid, name
        listing = ", ".join(f"id={i} username={n!r}" for i, n in users) or "(ninguno)"
        raise ValueError(
            f"user_id={user_id} no existe en authuser. Usuarios disponibles: {listing}"
        )


def verify_csv_row_counts(data_dir: Path) -> None:
    expected = load_expected_counts(data_dir)
    if not expected:
        return
    mapping = {
        "leads.csv": "leads_total",
        "pagos.csv": "pagos_total",
        "cuotas.csv": "cuotas_total",
    }
    errors: list[str] = []
    for name, key in mapping.items():
        exp = expected.get(key)
        if exp is None:
            continue
        path = data_dir / name
        with path.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        found = len(rows)
        if found != int(exp):
            errors.append(f"{name}: esperado {exp} filas (expected_counts.json), encontrado {found}")
        if found == 100:
            errors.append(f"{name}: sospecha export Supabase truncado (exactamente 100 filas)")
    if errors:
        raise ValueError("Conteo CSV inválido:\n  " + "\n  ".join(errors))


class LegacyJuanoImporter:
    def __init__(self, user_id: int, data_dir: Path, dry_run: bool = False) -> None:
        self.user_id = user_id
        self.data_dir = data_dir
        self.dry_run = dry_run
        self.stats = ImportStats()
        self._index: IdentityIndex | None = None

    def verify_csvs(self) -> None:
        missing = []
        for name in ("leads.csv", "pagos.csv", "cuotas.csv"):
            if not (self.data_dir / name).is_file():
                missing.append(name)
        if missing:
            raise FileNotFoundError(
                f"Faltan CSV en {self.data_dir}: {', '.join(missing)}. "
                "Copiá pagos.csv, leads.csv y cuotas.csv antes de importar."
            )
        verify_csv_row_counts(self.data_dir)

    def _read_csv(self, name: str) -> list[dict[str, str]]:
        path = self.data_dir / name
        with path.open(encoding="utf-8-sig", newline="") as f:
            return [normalize_csv_row(row) for row in csv.DictReader(f)]

    def _write_lead_ref(
        self,
        *,
        legacy_id: str,
        lead_id: int | None,
        rol: str,
        motivo: str,
        row: dict[str, str],
        log_action: str,
    ) -> None:
        if self.dry_run:
            self.stats.log("lead_ref", legacy_id, log_action, f"lead_id={lead_id} rol={rol}")
            return
        LegacyLeadRef(
            user_id=self.user_id,
            legacy_id=legacy_id,
            lead_id=lead_id,
            rol=rol,
            motivo=motivo,
            payload=dict(row),
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        flush()

    def _plan_lead_row(self, row: dict[str, str]) -> LeadRowPlan | None:
        legacy_id = (row.get("id") or "").strip()
        if legacy_id_processed(self.user_id, legacy_id):
            self.stats.leads_skipped += 1
            return None

        nombre = unicodedata.normalize("NFKC", (row.get("nombre") or "").strip())
        email = (row.get("correo") or "").strip().casefold()
        tel_raw = row.get("tel_norm") or row.get("telefono") or ""
        telefono, tel_invalido = validate_phone(tel_raw)

        if is_test_lead(nombre, email):
            self.stats.leads_excluded += 1
            self.stats.excluded_leads.append(
                {"legacy_id": legacy_id, "nombre": nombre, "email": email, "reason": "es_prueba"}
            )
            self.stats.log("lead", legacy_id, "excluded_es_prueba", nombre)
            return None

        status, situacion_orig = map_situacion(row.get("situacion"))
        keyword, fuente_raw = map_fuente(row.get("fuente"))
        producto = normalize_producto_norm(row.get("producto") or "")
        created_at = parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None)
        fecha_bot = parse_dt(row.get("fecha"))
        fecha_inferida = False
        if fecha_bot is None:
            fecha_bot = created_at
            fecha_inferida = True
        agendo, agendo_inferido = resolve_agendo(row)
        fecha_llamada = parse_date(row.get("fecha_llamada"))
        fecha_agenda = parse_date(row.get("fecha_agenda"))
        period_key = period_key_from_row(row)
        closer_raw = (row.get("closer") or "").strip()

        meta: dict[str, Any] = {
            "cierre": (row.get("cierre") or "").strip(),
            "presento": (row.get("presento") or "").strip(),
            "calificado": (row.get("calificado") or "").strip(),
            "ghl_contact_id": (row.get("ghl_contact_id") or "").strip(),
            "situacion_orig": situacion_orig,
            "fuente_orig": fuente_raw,
            "fecha_inferida": fecha_inferida,
        }
        if agendo_inferido:
            meta["agendo_inferido"] = agendo_inferido
        if tel_invalido:
            meta["telefono_invalido"] = tel_invalido
            self.stats.flag("telefono_invalido")
        if fecha_inferida:
            self.stats.flag("fecha_inferida")

        assert self._index is not None
        match = resolve_lead_from_csv(
            self._index,
            ghl_contact_id=row.get("ghl_contact_id"),
            fecha_llamada=fecha_llamada,
            fecha_agenda=fecha_agenda,
            tel_norm=tel_raw,
            email=email,
            nombre=nombre,
        )

        if match.ambiguous:
            action = "create"
        elif match.posible_duplicado:
            action = "create"
        elif match.lead is not None:
            action = "merge"
        else:
            action = "create"

        return LeadRowPlan(
            row=row,
            legacy_id=legacy_id,
            nombre=nombre,
            email=email,
            telefono=telefono,
            tel_raw=tel_raw,
            tel_invalido=tel_invalido,
            action=action,
            match=match,
            lead_id=int(match.lead.id) if match.lead is not None else None,
            period_key=period_key,
            meta=meta,
            status=status,
            keyword=keyword,
            producto=producto,
            closer_raw=closer_raw,
            agendo=agendo,
            created_at=created_at,
            fecha_bot=fecha_bot,
            fecha_llamada=fecha_llamada,
            fecha_agenda=fecha_agenda,
        )

    def _apply_lead_plan(self, plan: LeadRowPlan) -> None:
        legacy_id = plan.legacy_id
        match = plan.match
        period_key = plan.period_key

        if plan.action == "absorb":
            self.stats.merge_absorbed += 1
            self.stats.leads_merged += 1
            self.stats.leads_inserted += 1
            self.stats.bump_match(match.method if match else "absorb", period_key)
            self._write_lead_ref(
                legacy_id=legacy_id,
                lead_id=plan.lead_id,
                rol="merge_absorbed",
                motivo=plan.absorb_motivo or "collision_absorbed",
                row=plan.row,
                log_action="dry_run_absorb" if self.dry_run else "absorb",
            )
            self.stats.log(
                "lead",
                legacy_id,
                "dry_run_absorb" if self.dry_run else "absorb",
                f"lead_id={plan.lead_id}",
            )
            return

        if plan.action == "merge":
            assert match is not None and match.lead is not None
            self.stats.leads_merged += 1
            self.stats.leads_matched_existing_atv += 1
            self.stats.bump_match(match.method, period_key)
            self.stats.record_merge_target(
                int(match.lead.id),
                legacy_id=legacy_id,
                nombre=plan.nombre,
                fecha_llamada=plan.fecha_llamada,
                method=match.method,
                atv_nombre=str(match.lead.nombre or ""),
            )
            if match.method == "tel_norm":
                self.stats.match_tel += 1
            elif match.method == "tel10":
                self.stats.match_tel10 += 1
            elif match.method == "email":
                self.stats.match_email += 1
            elif match.method.startswith("ghl_contact_call"):
                self.stats.match_ghl_contact_call += 1
            elif match.method.startswith("ghl_contact_agendo"):
                self.stats.match_ghl_contact_agendo += 1
            if self.dry_run:
                self.stats.leads_inserted += 1
                self.stats.log("lead", legacy_id, "dry_run_merge", f"lead_id={match.lead.id} {match.method}")
            else:
                merge_lead_from_csv(match.lead, plan.row, plan.meta, match)
                self.stats.leads_inserted += 1
            self._write_lead_ref(
                legacy_id=legacy_id,
                lead_id=int(match.lead.id),
                rol="merge_winner",
                motivo=match.method,
                row=plan.row,
                log_action="dry_run_merge_ref" if self.dry_run else "merge_ref",
            )
            return

        # create (nuevo, ambiguo, posible_dup)
        if match and match.ambiguous:
            self.stats.match_ambiguo += 1
            self.stats.bump_match(match.method, period_key)
            plan.meta["match_ambiguo"] = True
            plan.meta["candidato_lead_ids"] = match.candidate_ids
        elif match and match.posible_duplicado:
            self.stats.posible_duplicado_nombre += 1
            self.stats.bump_match(match.method, period_key)
            plan.meta["posible_duplicado"] = True
            plan.meta["candidato_lead_id"] = match.candidate_ids[0] if match.candidate_ids else None
        else:
            if not (match and (match.ambiguous or match.posible_duplicado)):
                self.stats.bump_match("nuevo", period_key)

        plan.meta["match_method"] = match.method if match else "nuevo"
        if self.dry_run:
            self.stats.leads_created_new += 1
            self.stats.leads_inserted += 1
            action = "dry_run_insert"
            if match and match.ambiguous:
                action = "dry_run_ambiguo"
            elif match and match.posible_duplicado:
                action = "dry_run_posible_dup"
            self.stats.log("lead", legacy_id, action, plan.nombre)
            self._write_lead_ref(
                legacy_id=legacy_id,
                lead_id=None,
                rol="new",
                motivo=plan.meta.get("match_method", "nuevo"),
                row=plan.row,
                log_action="dry_run_new_ref",
            )
            return

        lead_kwargs: dict[str, Any] = {
            "user_id": self.user_id,
            "source": LEGACY_SOURCE,
            "legacy_id": legacy_id,
            "nombre": plan.nombre,
            "email": plan.email,
            "telefono": plan.telefono,
            "setter": (plan.row.get("setter") or "").strip(),
            "closer": plan.closer_raw,
            "closer_norm": normalize_closer(plan.closer_raw),
            "status": plan.status,
            "estado": plan.status,
            "origen": (plan.row.get("origen") or "").strip(),
            "keyword": plan.keyword,
            "programa_ofrecido": plan.producto,
            "agendo": plan.agendo,
            "call": parse_dt(plan.row.get("fecha_llamada")),
            "fecha_bot": plan.fecha_bot,
            "created_at": plan.created_at,
            "legacy_meta": plan.meta,
        }
        ghl = (plan.row.get("ghl_contact_id") or "").strip()
        if ghl:
            lead_kwargs["ghl_contact_id"] = ghl
        lead = Lead(**lead_kwargs)
        flush()
        assert self._index is not None
        self._index.register(lead)
        self.stats.leads_created_new += 1
        self.stats.leads_inserted += 1
        self._write_lead_ref(
            legacy_id=legacy_id,
            lead_id=int(lead.id),
            rol="new",
            motivo=plan.meta.get("match_method", "nuevo"),
            row=plan.row,
            log_action="new_ref",
        )

    def import_leads(self) -> None:
        rows = self._read_csv("leads.csv")
        plans: list[LeadRowPlan] = []
        for row in rows:
            plan = self._plan_lead_row(row)
            if plan is not None:
                plans.append(plan)

        collision_details = resolve_merge_collisions(plans)
        self.stats.merge_collision_groups = len(collision_details)
        self.stats.collision_details = collision_details

        for plan in plans:
            self._apply_lead_plan(plan)

    def report_duplicates(self) -> DuplicateReport:
        """Solo lectura: simula matcheo leads.csv vs ATV sin escribir."""
        rows = self._read_csv("leads.csv")
        expected = load_expected_counts(self.data_dir)
        origin_total = int(expected["leads_total"]) if expected and expected.get("leads_total") is not None else len(rows)
        report = DuplicateReport(total_csv=len(rows), leads_origin_total=origin_total)
        index = IdentityIndex.build(self.user_id)
        for row in rows:
            legacy_id = (row.get("id") or "").strip()
            nombre = unicodedata.normalize("NFKC", (row.get("nombre") or "").strip())
            email = (row.get("correo") or "").strip().casefold()
            if is_test_lead(nombre, email):
                report.excluded_leads.append(
                    {"legacy_id": legacy_id, "nombre": nombre, "email": email, "reason": "es_prueba"}
                )
                continue
            if legacy_id_processed(self.user_id, legacy_id):
                continue
            tel_raw = row.get("tel_norm") or row.get("telefono") or ""
            period_key = period_key_from_row(row)
            fecha_llamada = parse_date(row.get("fecha_llamada"))
            match = resolve_lead_from_csv(
                index,
                ghl_contact_id=row.get("ghl_contact_id"),
                fecha_llamada=fecha_llamada,
                fecha_agenda=parse_date(row.get("fecha_agenda")),
                tel_norm=tel_raw,
                email=email,
                nombre=nombre,
            )
            if match.ambiguous:
                report.match_ambiguo += 1
                report.would_create += 1
                method = match.method
            elif match.posible_duplicado:
                report.posible_duplicado_nombre += 1
                report.would_create += 1
                method = match.method
            elif match.lead is not None:
                report.would_merge += 1
                method = match.method
                lead_id = int(match.lead.id)
                atv_nombre = str(match.lead.nombre or "")
                report.merge_lead_names[lead_id] = atv_nombre
                report.merge_targets.setdefault(lead_id, []).append(
                    {
                        "legacy_id": legacy_id,
                        "nombre": nombre,
                        "fecha_llamada": fecha_llamada.isoformat() if fecha_llamada else "",
                        "method": method,
                        "atv_nombre": atv_nombre,
                    }
                )
            else:
                report.would_create += 1
                method = "nuevo"
            report.by_method[method] = report.by_method.get(method, 0) + 1
            bucket = report.by_month.setdefault(period_key, {})
            bucket[method] = bucket.get(method, 0) + 1
            bucket["_total"] = bucket.get("_total", 0) + 1
            if match.lead is not None and len(report.samples) < 30:
                report.samples.append(
                    DuplicateReportSample(
                        legacy_id=legacy_id,
                        nombre_csv=nombre,
                        nombre_atv=str(match.lead.nombre or ""),
                        method=method,
                        diffs=_field_diffs(row, match.lead),
                    )
                )

        cuota_rows = self._read_csv("cuotas.csv")
        dup_n, sob_n, dup_items, sob_items = analyze_cuotas_csv(cuota_rows)
        report.cuotas_duplicado_probable = dup_n
        report.cuotas_sobrepago = sob_n
        report.cuotas_duplicado_items = dup_items
        report.cuotas_sobrepago_items = sob_items
        return report

    def run_report_duplicates(self) -> DuplicateReport:
        self.verify_csvs()
        ensure_db_mapping()
        with db_session:
            return self.report_duplicates()

    def import_pagos(self) -> None:
        rows = self._read_csv("pagos.csv")
        all_payments = rows_payments_for_user(self.user_id)

        for row in rows:
            legacy_id = (row.get("id") or "").strip()
            if legacy_id_exists_payment(self.user_id, legacy_id):
                self.stats.pagos_skipped += 1
                continue

            email = extract_email(row.get("notas"), row.get("cliente"))
            tel_in = row.get("tel_norm") or ""
            nombre = unicodedata.normalize("NFKC", (row.get("cliente") or "").strip())
            monto = float(row.get("usd") or 0)
            fecha = parse_date(row.get("fecha")) or date.today()
            self.stats.pagos_usd_total += monto
            if fecha.year == 2026 and fecha.month == 7:
                self.stats.pagos_usd_julio += monto

            lead, method, _score = resolve_lead(
                self.user_id,
                self._index,
                tel_norm=tel_in,
                email=email,
                nombre=nombre,
                stats=self.stats,
                context_legacy_id=legacy_id,
                fecha_pago=fecha,
            )
            if method in ("tel_norm", "tel10"):
                self.stats.match_tel += 1
            elif method == "email":
                self.stats.match_email += 1
            elif method.startswith("nombre"):
                self.stats.match_nombre += 1

            created_new = False
            if lead is None:
                if self.dry_run:
                    self.stats.leads_created_from_pagos += 1
                    self.stats.match_created += 1
                    self.stats.pagos_new_contact += 1
                    self.stats.pagos_inserted += 1
                    self.stats.log("pago", legacy_id, "dry_run_insert", f"new_lead:{nombre}")
                    continue
                telefono, tel_invalido = validate_phone(tel_in)
                meta_lead: dict[str, Any] = {
                    "created_from": "pagos.csv",
                    "lead_huerfano": True,
                }
                if tel_invalido:
                    meta_lead["telefono_invalido"] = tel_invalido
                closer_raw = (row.get("closer") or "").strip()
                lead = Lead(
                    user_id=self.user_id,
                    source=LEGACY_SOURCE,
                    nombre=nombre,
                    email=email,
                    telefono=telefono,
                    setter=(row.get("setter") or "").strip(),
                    closer=closer_raw,
                    closer_norm=normalize_closer(closer_raw),
                    status="Cerrado" if (row.get("concepto") or "") in CIERRE_NUEVO_CONCEPTOS else "Pendiente",
                    estado="Cerrado" if (row.get("concepto") or "") in CIERRE_NUEVO_CONCEPTOS else "Pendiente",
                    legacy_meta=meta_lead,
                )
                flush()
                self._index.register(lead)
                created_new = True
                self.stats.leads_created_from_pagos += 1
                self.stats.match_created += 1
                self.stats.pagos_new_contact += 1
            elif (lead.source or "atv") == "atv":
                self.stats.leads_matched_existing_atv += 1
                self.stats.pagos_matched_existing += 1
                if not self.dry_run:
                    snapshot_lead_if_atv(lead)
            else:
                self.stats.pagos_matched_existing += 1

            concepto = (row.get("concepto") or "").strip()
            producto = normalize_producto_norm(row.get("producto_norm"))
            metodo = (row.get("metodo") or "").strip()
            closer_raw = (row.get("closer") or "").strip()

            pay_meta: dict[str, Any] = {
                "producto_original": (row.get("producto_original") or "").strip(),
                "closer_raw": closer_raw,
                "closer_norm": normalize_closer(closer_raw),
                "setter": (row.get("setter") or "").strip(),
                "origen_ghl": str(row.get("origen_ghl") or "").strip().lower() in ("true", "t", "1", "yes"),
            }
            pc = row.get("precio_contrato")
            if pc not in (None, ""):
                try:
                    pay_meta["precio_contrato"] = float(pc)
                except ValueError:
                    pass
            rev = row.get("revenue_ghl")
            if rev not in (None, ""):
                try:
                    pay_meta["revenue_ghl"] = float(rev)
                except ValueError:
                    pass
            if monto == 0:
                pay_meta["monto_cero"] = True
                self.stats.flag("monto_cero")
            if monto in ATIPICO_MONTOS:
                pay_meta["monto_atipico"] = True
                self.stats.flag("monto_atipico")
            if fecha > date.today():
                pay_meta["es_programado"] = True
                self.stats.flag("es_programado")
            pay_meta["match_method"] = method if not created_new else "created"

            if self.dry_run:
                self.stats.pagos_inserted += 1
                self.stats.log("pago", legacy_id, "dry_run_insert", f"lead:{nombre}")
                continue

            payment = LeadPayment(
                user_id=self.user_id,
                lead_id=int(lead.id),
                source=LEGACY_SOURCE,
                legacy_id=legacy_id,
                monto=monto,
                fecha=fecha,
                concepto=concepto,
                producto=producto,
                metodo=metodo,
                nota=(row.get("notas") or "").strip(),
                created_at=parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None),
                legacy_meta=pay_meta,
            )
            flush()
            all_payments.append(payment)
            self.stats.pagos_inserted += 1

        if not self.dry_run:
            touched_ids = {int(p.lead_id) for p in all_payments if (p.source or "") == LEGACY_SOURCE}
            for lead in rows_leads_for_user(self.user_id):
                if int(lead.id) in touched_ids:
                    recalc_lead_financials(self.user_id, lead, all_payments)

    def import_cuotas(self) -> None:
        rows = self._read_csv("cuotas.csv")
        duplicados = detect_cuota_duplicados(rows)
        for row in rows:
            legacy_id = (row.get("id") or "").strip()
            alumno = unicodedata.normalize("NFKC", (row.get("alumno") or "").strip())
            if _cuota_row_excluded(alumno):
                self.stats.cuotas_excluded += 1
                self.stats.excluded_cuotas.append(
                    {
                        "legacy_id": legacy_id,
                        "alumno": alumno,
                        "reason": "es_prueba",
                    }
                )
                self.stats.log("cuota", legacy_id, "excluded_test", alumno)
                continue
            if legacy_id_exists_cuota(self.user_id, legacy_id):
                self.stats.cuotas_skipped += 1
                continue

            lead, score, method = fuzzy_match_lead(self.user_id, alumno)
            ultimo = parse_date(row.get("ultimo_cobro"))
            siguiente = parse_date(row.get("siguiente_cobro"))
            meta: dict[str, Any] = {}
            if legacy_id in duplicados:
                meta["duplicado_probable"] = True
                meta["duplicado_grupo"] = duplicados[legacy_id]
                self.stats.flag("duplicado_probable")
            if (row.get("ultimo_cobro") or "").startswith("0026-"):
                meta["fecha_corregida_0026"] = True
            if (row.get("ultimo_cobro") or "").startswith("2025-07-14"):
                meta["fecha_revisar_2025"] = True
            monto_total = _parse_cuota_float(row.get("monto_total"))
            abonado = _parse_cuota_float(row.get("abonado"))
            saldo = _parse_cuota_float(row.get("saldo"))
            if abonado is not None and monto_total is not None and abonado > monto_total and monto_total > 0:
                meta["saldo_inconsistente"] = True
                self.stats.flag("saldo_inconsistente")
            if saldo is not None and saldo < 0:
                meta["sobrepago"] = True
                meta["sobrepago_monto"] = abs(saldo)
                self.stats.flag("sobrepago")
            if ultimo and siguiente and siguiente < ultimo:
                meta["siguiente_anterior_ultimo"] = True

            closer_raw = (row.get("closer") or "").strip()
            if self.dry_run:
                self.stats.cuotas_inserted += 1
                detail = f"match={method} score={score:.2f}" if lead else "sin_vincular"
                self.stats.log("cuota", legacy_id, "dry_run_insert", detail)
                continue

            cuota_kwargs: dict[str, Any] = {
                "user_id": self.user_id,
                "source": LEGACY_SOURCE,
                "legacy_id": legacy_id,
                "alumno_raw": alumno,
                "programa_raw": (row.get("programa") or "").strip(),
                "monto_total": monto_total,
                "abonado": abonado,
                "saldo": saldo,
                "ultimo_cobro": ultimo,
                "siguiente_cobro": siguiente,
                "closer_raw": closer_raw,
                "closer_norm": normalize_closer(closer_raw),
                "situacion_raw": (row.get("situacion") or "").strip(),
                "match_score": score if lead else score,
                "match_method": method if lead else "unlinked",
                "legacy_meta": meta,
                "created_at": parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None),
            }
            cuota_lbl = (row.get("cuota") or "").strip()
            if cuota_lbl:
                cuota_kwargs["cuota_label"] = cuota_lbl
            if lead is not None:
                cuota_kwargs["lead_id"] = int(lead.id)
            LegacyCuotaRef(**cuota_kwargs)
            self.stats.cuotas_inserted += 1

    def run(self, only: str | None = None) -> ImportStats:
        self.verify_csvs()
        ensure_db_mapping()
        with db_session:
            self._index = IdentityIndex.build(self.user_id)
            try:
                if only in (None, "leads"):
                    self.import_leads()
                if only in (None, "pagos"):
                    if only == "pagos":
                        self._index = IdentityIndex.build(self.user_id)
                    assert self._index is not None
                    self.import_pagos()
                if only in (None, "cuotas"):
                    self.import_cuotas()
                if self.dry_run:
                    rollback()
                else:
                    flush()
            except Exception:
                rollback()
                raise
            self.stats.atv_leads_by_period = fetch_atv_leads_by_period(self.user_id)
        return self.stats

    def save_import_summary(self) -> Path:
        return write_import_summary(
            self.data_dir,
            self.stats,
            user_id=self.user_id,
            dry_run=self.dry_run,
        )


IMPORT_SUMMARY_FILENAME = "import_summary.json"
EXCLUDED_ALERT_RATIO = 0.01


def write_import_summary(
    data_dir: Path,
    stats: ImportStats,
    *,
    user_id: int,
    dry_run: bool,
) -> Path:
    payload = {
        "user_id": user_id,
        "dry_run": dry_run,
        "completed_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "excluded": {
            "leads": {
                "count": stats.leads_excluded,
                "reason": "es_prueba",
                "items": stats.excluded_leads,
            },
            "cuotas": {
                "count": stats.cuotas_excluded,
                "reason": "es_prueba",
                "items": stats.excluded_cuotas,
            },
        },
        "applied": {
            "leads": {
                "total": stats.leads_inserted,
                "new": stats.leads_created_new,
                "merged": stats.leads_merged,
                "absorbed": stats.merge_absorbed,
                "collision_groups": stats.merge_collision_groups,
            },
            "pagos": {
                "inserted": stats.pagos_inserted,
                "usd_total": round(stats.pagos_usd_total, 2),
                "usd_julio": round(stats.pagos_usd_julio, 2),
            },
            "cuotas": {"inserted": stats.cuotas_inserted},
        },
        "collisions": [
            {
                "atv_lead_id": d.atv_lead_id,
                "atv_nombre": d.atv_nombre,
                "winner_legacy_id": d.winner_legacy_id,
                "winner_nombre": d.winner_nombre,
                "winner_reason": d.winner_reason,
                "rows": d.rows,
            }
            for d in stats.collision_details
        ],
    }
    path = data_dir / IMPORT_SUMMARY_FILENAME
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_import_summary(data_dir: Path) -> dict[str, Any]:
    path = data_dir / IMPORT_SUMMARY_FILENAME
    if not path.is_file():
        raise FileNotFoundError(
            f"Falta {path}. Corré el import (o dry-run) antes de validar."
        )
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("import_summary.json debe ser un objeto JSON")
    return data


def format_duplicate_report(report: DuplicateReport, user_id: int | None = None, username: str | None = None) -> str:
    lines = ["=== REPORT DUPLICATES (solo lectura) ==="]
    if user_id is not None:
        lines.append(f"Tenant: user_id={user_id} username={username!r}")
    lines.extend(format_leads_reconciliation(
        origin_total=report.leads_origin_total,
        excluded=report.excluded_leads,
        merge_rows=report.would_merge,
        create_rows=report.would_create,
    ))
    lines.extend(format_merge_collision_section(
        report.merge_targets,
        lead_names=report.merge_lead_names,
    ))
    lines.extend([
        f"Match ambiguo (contacto+fecha): {report.match_ambiguo}",
        f"Posible duplicado (solo nombre): {report.posible_duplicado_nombre}",
        "--- Por método ---",
    ])
    for method, cnt in sorted(report.by_method.items(), key=lambda x: -x[1]):
        lines.append(f"  {method}: {cnt}")
    lines.extend(format_period_breakdown(report.by_month, title="--- Por periodo (jun-2026 partido H1/H2) ---"))
    if report.samples:
        lines.append("--- Muestra matches (hasta 30) ---")
        for s in report.samples:
            diff = "; ".join(s.diffs) if s.diffs else "(sin diffs)"
            lines.append(f"  [{s.method}] csv={s.nombre_csv!r} atv={s.nombre_atv!r} | {diff}")
    lines.extend([
        "--- Cuotas (CSV) ---",
        f"duplicado_probable: {report.cuotas_duplicado_probable}",
        f"sobrepago (saldo < 0): {report.cuotas_sobrepago}",
    ])
    if report.cuotas_duplicado_items:
        lines.append("--- Cuotas duplicado_probable ---")
        for item in report.cuotas_duplicado_items:
            lines.append(
                f"  {item.alumno!r} id={item.legacy_id[:8]}… "
                f"monto={item.monto_total} abonado={item.abonado} saldo={item.saldo} | {item.detail}"
            )
    if report.cuotas_sobrepago_items:
        lines.append("--- Cuotas sobrepago ---")
        for item in report.cuotas_sobrepago_items:
            lines.append(
                f"  {item.alumno!r} id={item.legacy_id[:8]}… "
                f"monto={item.monto_total} abonado={item.abonado} saldo={item.saldo} | {item.detail}"
            )
    return "\n".join(lines)


def format_summary(
    stats: ImportStats,
    dry_run: bool,
    user_id: int | None = None,
    username: str | None = None,
    *,
    data_dir: Path | None = None,
) -> str:
    mode = "DRY-RUN" if dry_run else "IMPORT"
    lines = [
        f"=== {mode} legacy juano ===",
    ]
    if user_id is not None:
        lines.append(f"Tenant destino: user_id={user_id} username={username!r}")

    expected = load_expected_counts(data_dir) if data_dir else None
    origin_total = int(expected["leads_total"]) if expected and expected.get("leads_total") is not None else None
    create_rows = stats.leads_created_new
    lines.extend(format_leads_reconciliation(
        origin_total=origin_total,
        excluded=stats.excluded_leads,
        merge_rows=stats.leads_merged,
        create_rows=create_rows,
    ))
    lead_names: dict[int, str] = {}
    for lead_id, rows in stats.merge_targets.items():
        for row in rows:
            name = row.get("atv_nombre") or ""
            if name:
                lead_names[int(lead_id)] = name
                break
    lines.extend(format_merge_collision_section(
        stats.merge_targets,
        lead_names=lead_names,
        merge_absorbed=stats.merge_absorbed,
        collision_groups=stats.merge_collision_groups,
        collision_details=stats.collision_details,
        merge_row_count=stats.leads_merged,
    ))

    lines.extend([
        f"Leads insertados/mergeados: {stats.leads_inserted} (omitidos: {stats.leads_skipped})",
        f"  ambiguo: {stats.match_ambiguo} | posible_dup nombre: {stats.posible_duplicado_nombre}",
    ])
    lines.extend(format_pagos_section(stats, expected))
    lines.extend([
        f"Cuotas insertadas: {stats.cuotas_inserted} (omitidas: {stats.cuotas_skipped}, excluidas: {stats.cuotas_excluded})",
        f"Leads creados desde pagos: {stats.leads_created_from_pagos}",
        "--- Matches leads.csv ---",
    ])
    for method, cnt in sorted(stats.match_by_method.items(), key=lambda x: -x[1]):
        lines.append(f"  {method}: {cnt}")
    if stats.match_by_month:
        lines.extend(format_period_breakdown(stats.match_by_month, title="--- Leads por periodo (jun-2026 H1/H2) ---"))
        lines.extend(format_match_rate_table(stats.match_by_month, stats.atv_leads_by_period))
    lines.extend([
        "--- Matches pagos → lead ---",
        f"  tel_norm: {stats.match_tel}",
        f"  tel10: {stats.match_tel10}",
        f"  email: {stats.match_email}",
        f"  nombre: {stats.match_nombre}",
        f"  ghl_contact+call: {stats.match_ghl_contact_call}",
        f"  ghl_contact+agendo: {stats.match_ghl_contact_agendo}",
        f"  contacto nuevo: {stats.match_created}",
        "--- Flags ---",
    ])
    for key in (
        "es_prueba",
        "fecha_inferida",
        "monto_atipico",
        "es_programado",
        "monto_cero",
        "telefono_invalido",
        "saldo_inconsistente",
        "sobrepago",
        "duplicado_probable",
        "precio_contrato_conflicto",
    ):
        lines.append(f"  {key}: {stats.flags.get(key, 0)}")
    lines.append(f"Eventos log: {len(stats.logs)}")
    flagged = [e for e in stats.logs if e.action not in ("dry_run_insert",)]
    if flagged[:20]:
        lines.append("--- Muestra de log ---")
        for e in flagged[:20]:
            lines.append(f"  [{e.table}] {e.legacy_id} {e.action}: {e.detail}")
    return "\n".join(lines)
