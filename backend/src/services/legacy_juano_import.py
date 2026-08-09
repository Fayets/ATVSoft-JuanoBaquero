"""Importación idempotente CRM legacy juano → ATV (lead, lead_payment, legacy_cuota_ref)."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from pony.orm import db_session, flush, rollback

from src.db import db
from src.models import Lead, LeadPayment, LegacyCuotaRef

LEGACY_SOURCE = "legacy_juano"
CIERRE_NUEVO_CONCEPTOS = frozenset({"PIF", "1ra Cuota"})
ATIPICO_MONTOS = frozenset(range(1, 15))
GHL_FUENTE_PLACEHOLDER = "{{ custom_values.offer_name }} Strategy Session"

EXPECTED_CSV_DATA_ROWS = {
    "leads.csv": 2478,
    "pagos.csv": 351,
    "cuotas.csv": 20,
}

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
    leads_created_from_pagos: int = 0
    leads_matched_existing_atv: int = 0
    match_tel: int = 0
    match_email: int = 0
    match_nombre: int = 0
    match_created: int = 0
    flags: dict[str, int] = field(default_factory=dict)
    logs: list[ImportLogEntry] = field(default_factory=list)

    def log(self, table: str, legacy_id: str, action: str, detail: str = "") -> None:
        self.logs.append(ImportLogEntry(table, legacy_id, action, detail))

    def flag(self, name: str, n: int = 1) -> None:
        self.flags[name] = self.flags.get(name, 0) + n


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
    if raw is None or not str(raw).strip() or str(raw).strip().casefold() == "null":
        return None
    head = str(raw).strip().split("T")[0].split(" ")[0]
    if head.startswith("0026-"):
        head = "20" + head[2:]
    try:
        y, m, d = [int(x) for x in head.split("-")]
        return date(y, m, d)
    except ValueError:
        return None


def parse_dt(raw: str | None) -> datetime | None:
    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip().replace("Z", "+00:00")
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


def rows_leads_for_user(uid: int) -> list[Lead]:
    return [r for r in list(Lead.select()) if int(r.user_id) == uid]


def rows_payments_for_user(uid: int) -> list[LeadPayment]:
    return [r for r in list(LeadPayment.select()) if int(r.user_id) == uid]


def rows_cuotas_for_user(uid: int) -> list[LegacyCuotaRef]:
    return [r for r in list(LegacyCuotaRef.select()) if int(r.user_id) == uid]


def legacy_id_exists_lead(uid: int, legacy_id: str) -> bool:
    lid = (legacy_id or "").strip()
    if not lid:
        return False
    for r in rows_leads_for_user(uid):
        if (r.legacy_id or "").strip() == lid:
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


@dataclass
class IdentityIndex:
    by_tel: dict[str, Lead]
    by_email: dict[str, Lead]
    by_name: dict[str, Lead]

    @classmethod
    def build(cls, uid: int) -> IdentityIndex:
        by_tel: dict[str, Lead] = {}
        by_email: dict[str, Lead] = {}
        by_name: dict[str, Lead] = {}
        for lead in rows_leads_for_user(uid):
            tel, _ = validate_phone(lead.telefono)
            if tel and tel not in by_tel:
                by_tel[tel] = lead
            em = (lead.email or "").strip().casefold()
            if em and em not in by_email:
                by_email[em] = lead
            nk = _norm_key(lead.nombre)
            if nk and nk not in by_name:
                by_name[nk] = lead
        return cls(by_tel=by_tel, by_email=by_email, by_name=by_name)

    def register(self, lead: Lead) -> None:
        tel, _ = validate_phone(lead.telefono)
        if tel:
            self.by_tel[tel] = lead
        em = (lead.email or "").strip().casefold()
        if em:
            self.by_email[em] = lead
        nk = _norm_key(lead.nombre)
        if nk:
            self.by_name[nk] = lead


def resolve_lead(
    uid: int,
    index: IdentityIndex,
    *,
    tel_norm: str | None,
    email: str | None,
    nombre: str | None,
    stats: ImportStats,
    context_legacy_id: str,
) -> tuple[Lead | None, str, float]:
    tel, _ = validate_phone(tel_norm)
    if tel and tel in index.by_tel:
        lead = index.by_tel[tel]
        stats.log("match", context_legacy_id, "tel_norm", f"lead_id={lead.id}")
        return lead, "tel_norm", 1.0
    em = (email or "").strip().casefold()
    if em and em in index.by_email:
        lead = index.by_email[em]
        stats.log("match", context_legacy_id, "email", f"lead_id={lead.id}")
        return lead, "email", 0.95
    nk = _norm_key(nombre)
    if nk and nk in index.by_name:
        lead = index.by_name[nk]
        stats.log("match", context_legacy_id, "nombre", f"lead_id={lead.id}")
        return lead, "nombre", 0.85
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


def list_auth_users() -> list[tuple[int, str]]:
    import src.models  # noqa: F401
    from src.models import AuthUser

    db.generate_mapping(create_tables=True)
    with db_session:
        return [(int(u.id), str(u.username or "")) for u in list(AuthUser.select())]


def resolve_target_user(user_id: int) -> tuple[int, str]:
    import src.models  # noqa: F401
    from src.models import AuthUser

    db.generate_mapping(create_tables=True)
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
    errors: list[str] = []
    for name, expected in EXPECTED_CSV_DATA_ROWS.items():
        path = data_dir / name
        with path.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        found = len(rows)
        if found != expected:
            errors.append(f"{name}: esperado {expected} filas de datos, encontrado {found}")
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
            return list(csv.DictReader(f))

    def import_leads(self) -> None:
        rows = self._read_csv("leads.csv")
        for row in rows:
            legacy_id = (row.get("id") or "").strip()
            if legacy_id_exists_lead(self.user_id, legacy_id):
                self.stats.leads_skipped += 1
                continue

            nombre = unicodedata.normalize("NFKC", (row.get("nombre") or "").strip())
            email = (row.get("correo") or "").strip().casefold()
            tel_raw = row.get("tel_norm") or row.get("telefono") or ""
            telefono, tel_invalido = validate_phone(tel_raw)

            es_prueba = is_test_lead(nombre, email)
            status, situacion_orig = map_situacion(row.get("situacion"))
            keyword, fuente_raw = map_fuente(row.get("fuente"))
            producto_raw = row.get("producto") or ""
            producto = normalize_producto_norm(producto_raw)

            created_at = parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None)
            fecha_bot = parse_dt(row.get("fecha"))
            fecha_inferida = False
            if fecha_bot is None:
                fecha_bot = created_at
                fecha_inferida = True

            meta: dict[str, Any] = {
                "cierre": (row.get("cierre") or "").strip(),
                "presento": (row.get("presento") or "").strip(),
                "calificado": (row.get("calificado") or "").strip(),
                "ghl_contact_id": (row.get("ghl_contact_id") or "").strip(),
                "situacion_orig": situacion_orig,
                "fuente_orig": fuente_raw,
                "es_prueba": es_prueba,
                "fecha_inferida": fecha_inferida,
            }
            if tel_invalido:
                meta["telefono_invalido"] = tel_invalido
                self.stats.flag("telefono_invalido")
            if es_prueba:
                self.stats.flag("es_prueba")
            if fecha_inferida:
                self.stats.flag("fecha_inferida")

            closer_raw = (row.get("closer") or "").strip()
            if self.dry_run:
                self.stats.leads_inserted += 1
                self.stats.log("lead", legacy_id, "dry_run_insert", nombre)
                continue

            lead = Lead(
                user_id=self.user_id,
                source=LEGACY_SOURCE,
                legacy_id=legacy_id,
                nombre=nombre,
                email=email,
                telefono=telefono,
                setter=(row.get("setter") or "").strip(),
                closer=closer_raw,
                closer_norm=normalize_closer(closer_raw),
                status=status,
                estado=status,
                origen=(row.get("origen") or "").strip(),
                keyword=keyword,
                programa_ofrecido=producto,
                agendo=parse_dt(row.get("fecha_agenda")),
                call=parse_dt(row.get("fecha_llamada")),
                fecha_bot=fecha_bot,
                created_at=created_at,
                legacy_meta=meta,
            )
            flush()
            self._index.register(lead)
            self.stats.leads_inserted += 1

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

            lead, method, _score = resolve_lead(
                self.user_id,
                self._index,
                tel_norm=tel_in,
                email=email,
                nombre=nombre,
                stats=self.stats,
                context_legacy_id=legacy_id,
            )
            if method == "tel_norm":
                self.stats.match_tel += 1
            elif method == "email":
                self.stats.match_email += 1
            elif method == "nombre":
                self.stats.match_nombre += 1

            created_new = False
            if lead is None:
                if self.dry_run:
                    self.stats.leads_created_from_pagos += 1
                    self.stats.match_created += 1
                    self.stats.pagos_inserted += 1
                    self.stats.log("pago", legacy_id, "dry_run_insert", f"new_lead:{nombre}")
                    continue
                telefono, tel_invalido = validate_phone(tel_in)
                meta_lead: dict[str, Any] = {"created_from": "pagos.csv"}
                if tel_invalido:
                    meta_lead["telefono_invalido"] = tel_invalido
                closer_raw = (row.get("closer") or "").strip()
                lead = Lead(
                    user_id=self.user_id,
                    source=LEGACY_SOURCE,
                    legacy_id=None,
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
            elif (lead.source or "atv") == "atv":
                self.stats.leads_matched_existing_atv += 1
                if not self.dry_run:
                    snapshot_lead_if_atv(lead)

            monto = float(row.get("usd") or 0)
            fecha = parse_date(row.get("fecha")) or date.today()
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
        for row in rows:
            legacy_id = (row.get("id") or "").strip()
            alumno = unicodedata.normalize("NFKC", (row.get("alumno") or "").strip())
            if _norm_key(alumno) in TEST_NAMES or alumno.casefold() == "fgghhhh":
                self.stats.cuotas_excluded += 1
                self.stats.log("cuota", legacy_id, "excluded_test", alumno)
                continue
            if legacy_id_exists_cuota(self.user_id, legacy_id):
                self.stats.cuotas_skipped += 1
                continue

            lead, score, method = fuzzy_match_lead(self.user_id, alumno)
            ultimo = parse_date(row.get("ultimo_cobro"))
            siguiente = parse_date(row.get("siguiente_cobro"))
            meta: dict[str, Any] = {}
            if (row.get("ultimo_cobro") or "").startswith("0026-"):
                meta["fecha_corregida_0026"] = True
            if (row.get("ultimo_cobro") or "").startswith("2025-07-14"):
                meta["fecha_revisar_2025"] = True
            try:
                abonado = float(row.get("abonado") or 0)
                monto_total = float(row.get("monto_total") or 0)
                if abonado > monto_total and monto_total > 0:
                    meta["saldo_inconsistente"] = True
                    self.stats.flag("saldo_inconsistente")
            except ValueError:
                pass
            if ultimo and siguiente and siguiente < ultimo:
                meta["siguiente_anterior_ultimo"] = True

            closer_raw = (row.get("closer") or "").strip()
            if self.dry_run:
                self.stats.cuotas_inserted += 1
                detail = f"match={method} score={score:.2f}" if lead else "sin_vincular"
                self.stats.log("cuota", legacy_id, "dry_run_insert", detail)
                continue

            LegacyCuotaRef(
                user_id=self.user_id,
                source=LEGACY_SOURCE,
                legacy_id=legacy_id,
                lead_id=int(lead.id) if lead else None,
                alumno_raw=alumno,
                programa_raw=(row.get("programa") or "").strip(),
                monto_total=float(row.get("monto_total") or 0) if row.get("monto_total") else None,
                abonado=float(row.get("abonado") or 0) if row.get("abonado") else None,
                saldo=float(row.get("saldo") or 0) if row.get("saldo") else None,
                ultimo_cobro=ultimo,
                siguiente_cobro=siguiente,
                closer_raw=closer_raw,
                closer_norm=normalize_closer(closer_raw),
                situacion_raw=(row.get("situacion") or "").strip(),
                cuota_label=(row.get("cuota") or "").strip(),
                match_score=score if lead else score,
                match_method=method if lead else "unlinked",
                legacy_meta=meta,
                created_at=parse_dt(row.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None),
            )
            self.stats.cuotas_inserted += 1

    def run(self, only: str | None = None) -> ImportStats:
        self.verify_csvs()
        import src.models  # noqa: F401

        db.generate_mapping(create_tables=True)
        self._index = IdentityIndex.build(self.user_id)
        with db_session:
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
        return self.stats


def format_summary(stats: ImportStats, dry_run: bool, user_id: int | None = None, username: str | None = None) -> str:
    mode = "DRY-RUN" if dry_run else "IMPORT"
    lines = [
        f"=== {mode} legacy juano ===",
    ]
    if user_id is not None:
        lines.append(f"Tenant destino: user_id={user_id} username={username!r}")
    lines.extend([
        f"Leads insertados: {stats.leads_inserted} (omitidos: {stats.leads_skipped})",
        f"Pagos insertados: {stats.pagos_inserted} (omitidos: {stats.pagos_skipped})",
        f"Cuotas insertadas: {stats.cuotas_inserted} (omitidas: {stats.cuotas_skipped}, excluidas: {stats.cuotas_excluded})",
        f"Leads creados desde pagos: {stats.leads_created_from_pagos}",
        f"Pagos matcheados a leads ATV preexistentes: {stats.leads_matched_existing_atv}",
        "--- Matches pagos → lead ---",
        f"  tel_norm: {stats.match_tel}",
        f"  email: {stats.match_email}",
        f"  nombre: {stats.match_nombre}",
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
