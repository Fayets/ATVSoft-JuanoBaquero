"""Go High Level: sync manual de appointments vía API v2 (Private Integration Token)."""
from __future__ import annotations
import calendar
import threading
import time
import traceback
from collections.abc import Iterator
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pony.orm import ObjectNotFound, db_session
from pydantic import BaseModel, Field


from src.lead_audit import append_status_audit, status_is_unworked, touch_lead_updated_at
from src.lead_formulario import extract_formulario_from_ghl_body, merge_formulario
from src.models import ApiConnection, Lead
from src.services.legacy_juano_import import normalize_closer
from src.services.triajer_service import pick_next_triajer

router = APIRouter(prefix="/ghl", tags=["ghl"], redirect_slashes=False)

_GHL_API = "https://services.leadconnectorhq.com"
_GHL_VERSION = "2021-07-28"
_REQUEST_DELAY_S = 0.2
# GHL manda startTime naive en hora del calendar location (Colombia).
_GHL_NAIVE_TZ = ZoneInfo("America/Bogota")
# Evita dos syncs GHL en paralelo (manual o auto).
_GHL_SYNC_LOCK = threading.Lock()

class GHLSyncRequest(BaseModel):
    month: str | None = Field(default=None, description="YYYY-MM opcional para filtrar appointments")
    fecha: str | None = Field(default=None, description="YYYY-MM-DD: sync solo ese día (prioridad sobre month)")


class GHLRefrescarClosersOut(BaseModel):
    revisadas: int
    actualizadas: int
    sin_cambio: int
    api_error: int
    detalle: list[dict[str, Any]]
    desde: str
    hasta: str


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()

def _uid_int(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.")

def _parse_month(month: str) -> tuple[int, int]:
    try:
        year, mon = int(month[:4]), int(month[5:7])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    if mon < 1 or mon > 12:
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    return year, mon


def _parse_fecha(raw: str) -> date:
    try:
        y, m, d = (int(p) for p in raw.strip().split("-", 2))
        return date(y, m, d)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail="fecha debe tener formato YYYY-MM-DD.") from e


def _month_bounds_ms(month: str) -> tuple[int, int]:
    """Inicio/fin del mes en America/Bogota → epoch ms (requerido por /calendars/events)."""
    year, mon = _parse_month(month)
    last_day = calendar.monthrange(year, mon)[1]
    start = datetime(year, mon, 1, 0, 0, 0, tzinfo=_GHL_NAIVE_TZ)
    end = datetime(year, mon, last_day, 23, 59, 59, 999000, tzinfo=_GHL_NAIVE_TZ)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _day_bounds_ms(fecha: date) -> tuple[int, int]:
    """Inicio/fin del día civil en America/Bogota → epoch ms."""
    start = datetime.combine(fecha, dt_time.min, tzinfo=_GHL_NAIVE_TZ)
    end = datetime.combine(fecha, dt_time.max, tzinfo=_GHL_NAIVE_TZ)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _start_time_in_month(start_time_raw: str, month: str) -> bool:
    """True si startTime cae en YYYY-MM según calendario Colombia (no comparación de strings)."""
    dt_utc = _parse_ghl_datetime(start_time_raw)
    if dt_utc is None:
        return False
    local = dt_utc.replace(tzinfo=timezone.utc).astimezone(_GHL_NAIVE_TZ)
    return f"{local.year:04d}-{local.month:02d}" == month


def _start_time_on_day(start_time_raw: str, fecha: date) -> bool:
    """True si startTime cae en YYYY-MM-DD (America/Bogota)."""
    dt_utc = _parse_ghl_datetime(start_time_raw)
    if dt_utc is None:
        return False
    local = dt_utc.replace(tzinfo=timezone.utc).astimezone(_GHL_NAIVE_TZ)
    return local.date() == fecha


def _parse_ghl_datetime(raw: str | None) -> datetime | None:
    """Normaliza startTime GHL → UTC naive para guardar en BD.

    - Con `Z` / offset → se convierte a UTC.
    - Sin timezone (ej. `2026-07-24T12:00:00`) → se asume America/Bogota
      (hora del calendario GHL en Colombia) y recién ahí se pasa a UTC.
      Así `12:00` Colombia → `17:00` UTC, no `12:00` UTC.
    """
    if not raw:
        return None

    s = str(raw).strip()
    if not s:
        return None
    # fromisoformat no traga 'Z'
    s_iso = s.replace("Z", "+00:00").replace("z", "+00:00")
    dt: datetime | None = None
    try:
        dt = datetime.fromisoformat(s_iso)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(s[:19], fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    # Naive = wall-clock Colombia → UTC
    localized = dt.replace(tzinfo=_GHL_NAIVE_TZ)
    return localized.astimezone(timezone.utc).replace(tzinfo=None)

def _ghl_get(
    client: httpx.Client,
    token: str,
    path: str,
    params: dict | None = None,
) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "Version": _GHL_VERSION,
    }
    url = path if path.startswith("http") else f"{_GHL_API}{path}"
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            response = client.get(url, headers=headers, params=params)
            if response.status_code == 429:
                time.sleep(60)
                response = client.get(url, headers=headers, params=params)
            if response.status_code == 400 and "Timeout" in response.text:
                wait_s = 2 ** attempt
                print(f"[ghl] GHL timeout en {path}, reintento {attempt + 1}/3 en {wait_s}s", flush=True)
                time.sleep(wait_s)
                continue
            response.raise_for_status()
            body = response.json()
            return body if isinstance(body, dict) else {}
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if exc.response.status_code == 400 and "Timeout" in exc.response.text and attempt < 2:
                wait_s = 2 ** attempt
                print(f"[ghl] GHL timeout en {path}, reintento {attempt + 1}/3 en {wait_s}s", flush=True)
                time.sleep(wait_s)
                continue
            detail = ""
            try:
                detail = exc.response.text[:500]
            except Exception:
                pass
            raise HTTPException(
                status_code=502,
                detail=f"Error GHL {exc.response.status_code}: {detail}",
            ) from exc
        except httpx.RequestError as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise HTTPException(status_code=502, detail=f"No se pudo contactar a GHL: {exc!s}") from exc
    if isinstance(last_exc, httpx.HTTPStatusError):
        detail = last_exc.response.text[:500] if last_exc.response else ""
        raise HTTPException(
            status_code=502,
            detail=f"Error GHL {last_exc.response.status_code}: {detail}",
        ) from last_exc
    raise HTTPException(status_code=502, detail=f"No se pudo contactar a GHL: {last_exc!s}")

def _extract_events_list(payload: dict[str, Any]) -> list[Any]:
    events = payload.get("events") or payload.get("appointments") or []
    if isinstance(events, dict):
        events = events.get("events") or events.get("appointments") or []
    return events if isinstance(events, list) else []


def _get_contact_cached(
    client: httpx.Client,
    token: str,
    contact_id: str,
    cache: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if contact_id in cache:
        return cache[contact_id]
    time.sleep(_REQUEST_DELAY_S)
    data = _ghl_get(client, token, f"/contacts/{contact_id}")
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else data
    if not isinstance(contact, dict):
        contact = {"id": contact_id}
    cache[contact_id] = contact
    return contact


def _iter_contacts_with_appointments(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    month: str | None = None,
    fecha: date | None = None,
) -> Iterator[dict[str, Any]]:
    """Lista appointments del calendario vía GET /calendars/events (rango en ms).

    Si `fecha` está set → solo ese día. Si no → mes (`month` o mes actual Colombia).
    """
    if fecha is not None:
        start_ms, end_ms = _day_bounds_ms(fecha)
        range_label = fecha.isoformat()
    else:
        if not month:
            now = datetime.now(_GHL_NAIVE_TZ)
            month = f"{now.year:04d}-{now.month:02d}"
        start_ms, end_ms = _month_bounds_ms(month)
        range_label = month

    print(
        f"[ghl] /calendars/events location={location_id} calendar={calendar_id} "
        f"range={range_label} startMs={start_ms} endMs={end_ms}",
        flush=True,
    )

    data = _ghl_get(
        client,
        token,
        "/calendars/events",
        params={
            "locationId": location_id,
            "calendarId": calendar_id,
            "startTime": start_ms,
            "endTime": end_ms,
        },
    )
    events = _extract_events_list(data)
    raw_total = len(events)
    print(f"[ghl] events crudos de API (antes de filtros): {raw_total} keys={list(data.keys())}", flush=True)

    skipped_cal = 0
    skipped_range = 0
    skipped_cancelled = 0
    skipped_no_contact = 0
    kept = 0
    contact_cache: dict[str, dict[str, Any]] = {}
    sample_start: str | None = None

    for event in events:
        if not isinstance(event, dict):
            continue
        start_time_raw = str(event.get("startTime") or event.get("start_time") or "")
        if sample_start is None and start_time_raw:
            sample_start = start_time_raw
            print(f"[ghl] sample startTime={start_time_raw!r}", flush=True)

        event_cal = str(event.get("calendarId") or event.get("calendar_id") or "")
        if event_cal and event_cal != calendar_id:
            skipped_cal += 1
            continue

        if fecha is not None:
            if not _start_time_on_day(start_time_raw, fecha):
                skipped_range += 1
                continue
        elif month and not _start_time_in_month(start_time_raw, month):
            skipped_range += 1
            continue

        status = str(
            event.get("appointmentStatus") or event.get("status") or ""
        ).lower()
        if status in ("cancelled", "canceled"):
            skipped_cancelled += 1
            continue

        contact_id = str(event.get("contactId") or event.get("contact_id") or "").strip()
        if not contact_id:
            skipped_no_contact += 1
            continue

        contact = _get_contact_cached(client, token, contact_id, contact_cache)
        kept += 1
        name = _ghl_contact_display_name(contact)
        print(f"[ghl] appointment encontrado: {name or contact_id} {start_time_raw}", flush=True)
        yield {
            "contact": contact,
            "appointment": event,
        }

    after_calendar = raw_total - skipped_cal
    after_range = after_calendar - skipped_range
    print(
        f"[ghl] filtro rango: antes={after_calendar} después={after_range} "
        f"(skipped_range={skipped_range} skipped_cal={skipped_cal} "
        f"skipped_cancelled={skipped_cancelled} skipped_no_contact={skipped_no_contact})",
        flush=True,
    )
    print(f"[ghl] total appointments a importar: {kept}", flush=True)


def _fetch_contacts_with_appointments(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    month: str | None = None,
    fecha: date | None = None,
) -> list[dict[str, Any]]:
    return list(
        _iter_contacts_with_appointments(
            client, token, location_id, calendar_id, month=month, fecha=fecha
        )
    )

def _ghl_appointment_id(event: dict[str, Any] | None) -> str:
    if not isinstance(event, dict):
        return ""
    return str(
        event.get("id")
        or event.get("appointmentId")
        or event.get("appointment_id")
        or ""
    ).strip()


def _ghl_contact_display_name(data: dict[str, Any] | None) -> str:
    """Mismo orden que el webhook: full_name → name → firstName + lastName."""
    if not isinstance(data, dict):
        return ""
    full = str(
        data.get("full_name")
        or data.get("fullName")
        or data.get("name")
        or data.get("Nombre y apellido")
        or ""
    ).strip()
    if full:
        return full
    first = str(data.get("firstName") or data.get("first_name") or "").strip()
    last = str(data.get("lastName") or data.get("last_name") or "").strip()
    return f"{first} {last}".strip()


def _ghl_person_display_name(data: Any) -> str:
    """Nombre completo desde dict GHL (user/assigned) o string ya resuelto."""
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        return _ghl_contact_display_name(data)
    return ""


def _looks_like_ghl_id(value: str) -> bool:
    """IDs GHL suelen ser alfanuméricos sin espacios (ej. YlWd2wuCAZQzh2cH1fVZ)."""
    s = (value or "").strip()
    if not s or " " in s or "@" in s:
        return False
    return len(s) >= 8 and s.replace("-", "").replace("_", "").isalnum()


def _ghl_owner_from_webhook_body(body: dict[str, Any]) -> str:
    """Propietario de la cita en webhook workflow: body.user (objeto con name/firstName)."""
    candidates: list[Any] = [
        body.get("user"),
        body.get("Propietario de la cita"),
        body.get("assignedUser"),
        body.get("assigned_user"),
    ]
    calendar = body.get("calendar") if isinstance(body.get("calendar"), dict) else {}
    trigger = body.get("triggerData") if isinstance(body.get("triggerData"), dict) else {}
    appointment = body.get("appointment") if isinstance(body.get("appointment"), dict) else {}
    candidates.extend(
        [
            calendar.get("user"),
            calendar.get("assignedUser"),
            trigger.get("user"),
            appointment.get("user"),
            appointment.get("assignedUser"),
        ]
    )
    for cand in candidates:
        name = _ghl_person_display_name(cand)
        if name and not _looks_like_ghl_id(name):
            return name
        # A veces viene solo el id en string; sin lookup en webhook → ignorar
        if isinstance(cand, dict):
            # dict sin name usable ya lo cubre _ghl_person_display_name
            continue
    return ""


def _resolve_ghl_user_name(
    client: httpx.Client,
    token: str,
    user_ref: Any,
    cache: dict[str, str],
) -> str:
    """Resuelve assignedUserId / assignedTo → nombre completo (GET /users/{id})."""
    if isinstance(user_ref, dict):
        name = _ghl_person_display_name(user_ref)
        if name and not _looks_like_ghl_id(name):
            return name
        user_id = str(
            user_ref.get("id")
            or user_ref.get("userId")
            or user_ref.get("user_id")
            or ""
        ).strip()
    else:
        user_id = str(user_ref or "").strip()
        if user_id and not _looks_like_ghl_id(user_id):
            # Ya es un nombre legible
            return user_id

    if not user_id:
        return ""
    if user_id in cache:
        return cache[user_id]

    try:
        time.sleep(_REQUEST_DELAY_S)
        data = _ghl_get(client, token, f"/users/{user_id}")
        user_obj = data.get("user") if isinstance(data.get("user"), dict) else data
        name = _ghl_person_display_name(user_obj)
    except Exception as exc:
        print(f"[ghl] no se pudo resolver user {user_id}: {exc}", flush=True)
        name = ""
    cache[user_id] = name
    return name


def _ghl_owner_from_sync(
    client: httpx.Client,
    token: str,
    appointment: dict[str, Any],
    contact: dict[str, Any],
    cache: dict[str, str],
) -> str:
    """Propietario en sync: event.assignedUserId (cita) → contact.assignedTo."""
    # 1) Dueño de la cita (calendars/events)
    for key in ("assignedUser", "assigned_user", "user"):
        name = _ghl_person_display_name(appointment.get(key))
        if name and not _looks_like_ghl_id(name):
            return name
    assigned_user_id = str(
        appointment.get("assignedUserId")
        or appointment.get("assigned_user_id")
        or ""
    ).strip()
    if assigned_user_id:
        name = _resolve_ghl_user_name(client, token, assigned_user_id, cache)
        if name:
            return name

    # 2) Fallback: assignedTo del contacto (suele ser user id)
    assigned_to = contact.get("assignedTo") or contact.get("assigned_to")
    name = _resolve_ghl_user_name(client, token, assigned_to, cache)
    return name


def _call_day_bogota(dt: datetime | None) -> date | None:
    """Día calendario America/Bogota para un call UTC-naive (o aware)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        aware = dt.replace(tzinfo=timezone.utc)
    else:
        aware = dt
    return aware.astimezone(_GHL_NAIVE_TZ).date()


@db_session
def _apply_appointment_to_lead(
    user_id: int,
    *,
    name: str,
    email: str,
    phone: str,
    call_at: datetime | None,
    agendo_at: datetime | None,
    ghl_contact_id: str,
    ig: str = "",
    formulario: dict[str, str] | None = None,
    ghl_appointment_id: str = "",
    closer: str = "",
) -> str:
    """Upsert lead por `ghl_appointment_id` (event.id de /calendars/events).

    Match SOLO por appointment id (columna o notas). Nunca por contacto:
    un mismo ghl_contact_id con otra cita → lead nuevo.
    Si el appointment ya existe pero la fecha de call cambió de día (reagenda)
    → se desvincula el lead viejo y se crea uno nuevo para la nueva cita.
    `closer` solo se escribe si viene no vacío (no pisa con "").
    `status` en update solo se escribe si el lead todavía no fue trabajado
    (vacío / Agendado / Pendiente). El alta sí nace en Agendado + estado.
    """
    display_name = name.strip() or (email.split("@")[0] if email else "Lead GHL")
    appt_id = (ghl_appointment_id or "").strip()
    closer_name = normalize_closer((closer or "").strip()) if (closer or "").strip() else ""
    contact_marker = f"GHL contact_id: {ghl_contact_id}" if ghl_contact_id else ""

    row: Lead | None = None

    # 1) Columna ghl_appointment_id (fuente de verdad)
    if appt_id:
        row = Lead.get(user_id=user_id, ghl_appointment_id=appt_id)

    # 2) Fallback: id solo en notas (leads viejos sin columna). NUNCA matchear por contacto.
    if row is None and appt_id:
        appt_marker = f"GHL appointment_id: {appt_id}"
        for r in Lead.select(lambda l: l.user_id == user_id):
            if appt_marker in str(r.notas or ""):
                row = r
                break

    # Reagenda a otro día: conservar el lead viejo y crear uno nuevo.
    if row is not None and call_at is not None and row.call is not None:
        old_day = _call_day_bogota(row.call)
        new_day = _call_day_bogota(call_at)
        if old_day is not None and new_day is not None and old_day != new_day:
            row.ghl_appointment_id = None
            notas = str(row.notas or "")
            if appt_id:
                marker = f"GHL appointment_id: {appt_id}"
                if marker in notas:
                    row.notas = "\n".join(
                        line for line in notas.splitlines() if line.strip() != marker
                    ).strip()
            row = None

    if row is not None:
        if display_name:
            row.nombre = display_name
        if call_at is not None:
            row.call = call_at
        if appt_id:
            row.ghl_appointment_id = appt_id
        if ghl_contact_id:
            row.ghl_contact_id = ghl_contact_id
        if email:
            row.email = email
        if phone:
            row.telefono = phone
        if ig:
            row.ig = ig
        if closer_name:
            row.closer = closer_name
            row.closer_norm = closer_name
        if not (getattr(row, "triajer", None) or "").strip():
            assigned = pick_next_triajer(user_id)
            if assigned:
                row.triajer = assigned
        if agendo_at is not None:
            row.agendo = agendo_at
        prev_status = (row.status or "").strip()
        if status_is_unworked(prev_status):
            row.status = "Agendado"
            append_status_audit(row, prev_status, "Agendado", "ghl_sync")
        if status_is_unworked(getattr(row, "estado", None)):
            row.estado = (row.status or "").strip() or "Agendado"
        row.agendo_en = "GHL"
        row.origen = row.origen or "GHL"
        notas = (row.notas or "").strip()
        if contact_marker and contact_marker not in notas:
            notas = f"{notas}\n{contact_marker}".strip() if notas else contact_marker
        if email:
            email_line = f"ghl email: {email.strip().casefold()}"
            if email_line not in notas.casefold():
                notas = f"{notas}\n{email_line}".strip() if notas else email_line
        row.notas = notas
        if formulario:
            row.formulario = merge_formulario(row.formulario, formulario)
        touch_lead_updated_at(row)
        return "updated"

    notas_parts: list[str] = []
    if contact_marker:
        notas_parts.append(contact_marker)
    if email:
        notas_parts.append(f"ghl email: {email.strip().casefold()}")

    Lead(
        user_id=user_id,
        nombre=display_name,
        email=email or "",
        telefono=phone or "",
        ig=ig or "",
        origen="GHL",
        ghl_appointment_id=appt_id or None,
        ghl_contact_id=ghl_contact_id or None,
        closer=closer_name,
        closer_norm=closer_name or "",
        triajer=pick_next_triajer(user_id),
        triaje_hecho=False,
        notas="\n".join(notas_parts),
        call=call_at,
        agendo=agendo_at or call_at,
        status="Agendado",
        estado="Agendado",
        agendo_en="GHL",
        formulario=merge_formulario({}, formulario),
        updated_at=datetime.utcnow(),
    )
    return "created"

@router.post("/sync")
def sync_ghl(
    background_tasks: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
    body: GHLSyncRequest | None = None,
    month: str | None = Query(default=None, description="YYYY-MM opcional"),
    fecha: str | None = Query(default=None, description="YYYY-MM-DD: sync solo ese día"),
):
    uid = _uid_int(user_id)
    sync_fecha_raw = (body.fecha.strip() if body and body.fecha else None) or (
        fecha.strip() if fecha else None
    )
    sync_fecha = _parse_fecha(sync_fecha_raw) if sync_fecha_raw else None
    sync_month = None
    if sync_fecha is None:
        sync_month = (body.month.strip() if body and body.month else None) or (
            month.strip() if month else None
        )

    with db_session:
        try:
            conn = ApiConnection.get(user_id=uid, platform="ghl")
        except ObjectNotFound:
            raise HTTPException(status_code=400, detail="No hay conexión GHL.")
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        location_id = str(creds.get("location_id") or "").strip()
        calendar_id = str(creds.get("calendar_id") or "").strip()
        if not token or not location_id or not calendar_id:
            raise HTTPException(status_code=400, detail="Faltan credenciales GHL.")

    # Sync de un día: sincrónico (botón Actualizar del panel diario).
    if sync_fecha is not None:
        result = _run_ghl_sync(uid, token, location_id, calendar_id, month=None, fecha=sync_fecha)
        return {
            "status": "ok",
            "fecha": sync_fecha.isoformat(),
            "created": result["created"],
            "updated": result["updated"],
            "message": f"Sync del {sync_fecha.isoformat()} listo.",
        }

    background_tasks.add_task(
        _run_ghl_sync, uid, token, location_id, calendar_id, sync_month, None
    )
    return {
        "status": "started",
        "month": sync_month,
        "message": "Sync iniciado en background. Los leads aparecerán en minutos.",
    }


def _run_ghl_sync(
    uid: int,
    token: str,
    location_id: str,
    calendar_id: str,
    month: str | None = None,
    fecha: date | None = None,
    *,
    acquire_lock: bool = True,
) -> dict[str, int]:
    if acquire_lock and not _GHL_SYNC_LOCK.acquire(blocking=False):
        print("[ghl] sync skip: ya hay un sync en curso", flush=True)
        return {"created": 0, "updated": 0, "skipped": 1}

    range_label = fecha.isoformat() if fecha is not None else (month or "mes-actual")
    print(f"[ghl] sync iniciado user_id={uid} range={range_label}", flush=True)
    created = 0
    updated = 0
    try:
        with httpx.Client(timeout=300.0) as client:
            items = _fetch_contacts_with_appointments(
                client, token, location_id, calendar_id, month=month, fecha=fecha
            )
            print(f"[ghl] fetch completado: {len(items)} items", flush=True)
            user_name_cache: dict[str, str] = {}
            for item in items:
                contact = item["contact"]
                appointment = item["appointment"]
                name = _ghl_contact_display_name(contact)
                email = str(contact.get("email") or "").strip()
                phone = str(contact.get("phone") or "").strip()
                ghl_contact_id = str(contact.get("id") or "").strip()
                call_at = _parse_ghl_datetime(
                    appointment.get("startTime") or appointment.get("start_time")
                )
                agendo_at = _parse_ghl_datetime(
                    appointment.get("dateAdded") or appointment.get("date_added")
                )
                ghl_appointment_id = _ghl_appointment_id(appointment)
                closer = _ghl_owner_from_sync(
                    client, token, appointment, contact, user_name_cache
                )
                try:
                    result = _apply_appointment_to_lead(
                        uid,
                        name=name,
                        email=email,
                        phone=phone,
                        call_at=call_at,
                        agendo_at=agendo_at,
                        ghl_contact_id=ghl_contact_id,
                        ghl_appointment_id=ghl_appointment_id,
                        closer=closer,
                    )
                    print(f"[ghl] lead {result}: {name} closer={closer!r}", flush=True)
                    if result == "created":
                        created += 1
                    else:
                        updated += 1
                except Exception as exc:
                    print(f"[ghl] ERROR guardando lead {name}: {exc}", flush=True)
        _touch_ghl_last_sync(uid)
        print(f"[ghl] sync listo created={created} updated={updated}", flush=True)
    except Exception as exc:
        print(f"[ghl] ERROR en sync: {type(exc).__name__}: {exc}", flush=True)
        traceback.print_exc()
        if fecha is not None:
            raise
    finally:
        if acquire_lock:
            _GHL_SYNC_LOCK.release()
    return {"created": created, "updated": updated}


@router.post("/refrescar-closers", response_model=GHLRefrescarClosersOut)
def refrescar_closers_endpoint(
    user_id: Annotated[str, Depends(require_user_id)],
    desde: str | None = Query(default=None, description="YYYY-MM-DD inicio (default: hoy-6)"),
    hasta: str | None = Query(default=None, description="YYYY-MM-DD fin (default: hoy)"),
) -> GHLRefrescarClosersOut:
    """Actualiza solo closer/closer_norm desde GHL para leads con ghl_appointment_id."""
    uid = _uid_int(user_id)
    today = datetime.now(_GHL_NAIVE_TZ).date()
    end = _parse_fecha(hasta) if hasta else today
    start = _parse_fecha(desde) if desde else (end - timedelta(days=6))

    with db_session:
        try:
            conn = ApiConnection.get(user_id=uid, platform="ghl")
        except ObjectNotFound:
            raise HTTPException(status_code=400, detail="No hay conexión GHL.")
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        location_id = str(creds.get("location_id") or "").strip()
        calendar_id = str(creds.get("calendar_id") or "").strip()
        if not token or not location_id or not calendar_id:
            raise HTTPException(status_code=400, detail="Faltan credenciales GHL.")

    try:
        from src.services.ghl_refrescar_closers_service import refrescar_closers_from_ghl

        result = refrescar_closers_from_ghl(
            uid,
            token,
            location_id,
            calendar_id,
            desde=start,
            hasta=end,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[ghl] refrescar-closers ERROR: {exc}", flush=True)
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Error al refrescar closers: {exc}") from exc

    print(
        f"[ghl] refrescar-closers user={uid} "
        f"revisadas={result['revisadas']} actualizadas={result['actualizadas']}",
        flush=True,
    )
    return GHLRefrescarClosersOut(**result)


@db_session
def _list_ghl_creds() -> list[dict[str, Any]]:
    """Usuarios con conexión GHL completa (token + location + calendar)."""
    out: list[dict[str, Any]] = []
    for conn in ApiConnection.select(lambda c: c.platform == "ghl"):
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        token = str(creds.get("access_token") or "").strip()
        location_id = str(creds.get("location_id") or "").strip()
        calendar_id = str(creds.get("calendar_id") or "").strip()
        if token and location_id and calendar_id:
            out.append(
                {
                    "user_id": int(conn.user_id),
                    "token": token,
                    "location_id": location_id,
                    "calendar_id": calendar_id,
                }
            )
    return out


# PAUSADO 2026-08-17: el job pisaba status en leads ya trabajados.
# Reactivar a True cuando el overwrite esté verificado en producción.
GHL_AUTO_SYNC_ENABLED = False


def run_ghl_auto_sync_all_users() -> dict[str, int]:
    """Sync silencioso del mes actual para todos los users con GHL.

    Si ya hay un sync en curso → skip (no corre en paralelo).
    """
    if not GHL_AUTO_SYNC_ENABLED:
        print("[ghl] auto-sync PAUSADO (GHL_AUTO_SYNC_ENABLED=False)", flush=True)
        return {"created": 0, "updated": 0, "skipped": 1}

    if not _GHL_SYNC_LOCK.acquire(blocking=False):
        print("[ghl] auto-sync skip: ya hay un sync en curso", flush=True)
        return {"created": 0, "updated": 0, "skipped": 1}

    created = 0
    updated = 0
    try:
        print("[ghl] auto-sync iniciado", flush=True)
        creds_list = _list_ghl_creds()
        for creds in creds_list:
            try:
                result = _run_ghl_sync(
                    creds["user_id"],
                    creds["token"],
                    creds["location_id"],
                    creds["calendar_id"],
                    month=None,  # mes actual (mismo que POST /ghl/sync sin month)
                    fecha=None,
                    acquire_lock=False,
                )
                created += int(result.get("created") or 0)
                updated += int(result.get("updated") or 0)
            except Exception as exc:
                print(
                    f"[ghl] auto-sync FAILED user={creds['user_id']}: {exc}",
                    flush=True,
                )
        print(f"[ghl] auto-sync listo created={created} updated={updated}", flush=True)
    except Exception as exc:
        print(f"[ghl] auto-sync ERROR: {exc}", flush=True)
        traceback.print_exc()
    finally:
        _GHL_SYNC_LOCK.release()
    return {"created": created, "updated": updated}


@db_session
def _touch_ghl_last_sync(user_id: int) -> None:
    try:
        conn_row = ApiConnection.get(user_id=user_id, platform="ghl")
        now = datetime.utcnow()
        conn_row.last_sync_at = now
        conn_row.updated_at = now
    except ObjectNotFound:
        pass

@router.post("/webhook")
async def ghl_webhook(request: Request):
    """Recibe webhooks de GHL cuando se agenda una cita nueva."""
    try:
        body = await request.json()
    except Exception:
        body = {}

    print(f"[ghl webhook] keys: {list(body.keys())}", flush=True)

    trigger_data_raw = body.get("triggerData") or {}
    calendar_raw = body.get("calendar") or {}
    user_raw = body.get("user")
    print(f"[ghl webhook] triggerData={trigger_data_raw}", flush=True)
    print(f"[ghl webhook] calendar={calendar_raw}", flush=True)
    print(f"[ghl webhook] user={user_raw}", flush=True)

    # Datos del contacto → columnas existentes
    contact_id = str(body.get("contact_id") or body.get("contactId") or "").strip()
    name = _ghl_contact_display_name(body if isinstance(body, dict) else None)
    closer = _ghl_owner_from_webhook_body(body if isinstance(body, dict) else {})

    email = str(
        body.get("email")
        or body.get("Correo electrónico")
        or body.get("Correo electronico")
        or ""
    ).strip()
    phone = str(
        body.get("phone")
        or body.get("Número de celular (Solo sera utilizado para la confirmación OBLIGATORIA por WhatsApp).")
        or body.get("Número de celular")
        or body.get("Numero de celular")
        or ""
    ).strip()
    ig = str(
        body.get("Usuario de Instagram")
        or body.get("Cuenta de Instagram")
        or body.get("Tu cuenta de Instagram")
        or body.get("Déjame tu Instagram")
        or body.get("INSTAGRAM (Escríbelo igual que como aparece en IG, si no podemos confirmarlo cancelaremos la sesión) Ejemplo: @juano.yt")
        or body.get("INSTAGRAM")
        or ""
    ).strip()

    formulario = extract_formulario_from_ghl_body(body)

    # Datos de la cita
    trigger_data = body.get("triggerData") or {}
    if not isinstance(trigger_data, dict):
        trigger_data = {}
    calendar_data = body.get("calendar") or {}
    if not isinstance(calendar_data, dict):
        calendar_data = {}

    # startTime viene en calendar, no en triggerData
    start_time_raw = str(
        calendar_data.get("startTime") or
        trigger_data.get("startTime") or
        trigger_data.get("start_time") or
        ""
    ).strip()

    # Preferir calendarId: en muchos payloads `calendar.id` es el event/appointment id.
    calendar_id = str(
        calendar_data.get("calendarId")
        or calendar_data.get("calendar_id")
        or trigger_data.get("calendarId")
        or trigger_data.get("calendar_id")
        or ""
    ).strip()
    if not calendar_id:
        # Legacy: solo venía el id del calendario (sin appointment id separado).
        calendar_id = str(calendar_data.get("id") or "").strip()

    call_at = _parse_ghl_datetime(start_time_raw) if start_time_raw else None
    agendo_at = datetime.utcnow()

    print(
        f"[ghl webhook] name={name} email={email} phone={phone} ig={ig} "
        f"closer={closer!r} call={call_at} calendar={calendar_id} formulario={formulario}",
        flush=True,
    )

    if not name and not email:
        print("[ghl webhook] sin datos suficientes, ignorando", flush=True)
        return {"status": "ignored"}

    # Buscar user_id por calendar_id
    uid: int | None = None
    with db_session:
        conns = list(ApiConnection.select(lambda c: c.platform == "ghl"))
        for conn in conns:
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            if str(creds.get("calendar_id") or "") == calendar_id:
                uid = conn.user_id
                break
        if uid is None and conns:
            uid = conns[0].user_id

    if uid is None:
        print("[ghl webhook] no se encontró user con conexión GHL", flush=True)
        return {"status": "no_user"}

    appt_body = body.get("appointment") if isinstance(body.get("appointment"), dict) else {}
    # Nunca usar el calendar_id como appointment id (colisionaba todos los webhooks).
    ghl_appointment_id = (
        str(
            calendar_data.get("appointmentId")
            or calendar_data.get("appointment_id")
            or trigger_data.get("appointmentId")
            or trigger_data.get("appointment_id")
            or ""
        ).strip()
        or _ghl_appointment_id(appt_body)
        or str(body.get("appointmentId") or body.get("appointment_id") or "").strip()
    )
    for blob in (calendar_data, trigger_data):
        if ghl_appointment_id:
            break
        cand = str(blob.get("id") or "").strip()
        if cand and cand != calendar_id:
            ghl_appointment_id = cand

    try:
        result = _apply_appointment_to_lead(
            uid,
            name=name,
            email=email,
            phone=phone,
            call_at=call_at,
            agendo_at=agendo_at,
            ghl_contact_id=contact_id,
            ig=ig,
            formulario=formulario,
            ghl_appointment_id=ghl_appointment_id,
            closer=closer,
        )
        print(f"[ghl webhook] lead {result}: {name} ig={ig} closer={closer!r}", flush=True)
        return {"status": "ok", "action": result}
    except Exception as exc:
        print(f"[ghl webhook] ERROR: {exc}", flush=True)
        traceback.print_exc()
        return {"status": "error", "detail": str(exc)}
