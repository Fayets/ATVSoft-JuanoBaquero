"""Go High Level: sync manual de appointments vía API v2 (Private Integration Token)."""
from __future__ import annotations
import calendar
import time
import traceback
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pony.orm import ObjectNotFound, db_session
from pydantic import BaseModel, Field


from src.lead_formulario import extract_formulario_from_ghl_body, merge_formulario
from src.models import ApiConnection, Lead

router = APIRouter(prefix="/ghl", tags=["ghl"], redirect_slashes=False)

_GHL_API = "https://services.leadconnectorhq.com"
_GHL_VERSION = "2021-07-28"
_PAGE_SIZE = 100
_MAX_CONTACT_PAGES = 50
_REQUEST_DELAY_S = 0.2

class GHLSyncRequest(BaseModel):
    month: str | None = Field(default=None, description="YYYY-MM opcional para filtrar appointments")

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

def _month_bounds_iso(month: str) -> tuple[str, str]:
    """Devuelve (start_iso, end_iso) para filtrar por mes."""
    try:
        year, mon = int(month[:4]), int(month[5:7])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    last_day = calendar.monthrange(year, mon)[1]
    start = f"{year:04d}-{mon:02d}-01 00:00:00"
    end = f"{year:04d}-{mon:02d}-{last_day:02d} 23:59:59"
    return start, end

def _parse_ghl_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
    return None

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

def _iter_contacts_with_appointments(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    month: str | None,
) -> Iterator[dict[str, Any]]:
    """Pagina contactos, filtra por calendario y yield *todos* los appointments del mes.

    No hay break/return tras el primer appointment: cada event válido se emite
    para que `_apply_appointment_to_lead` cree/actualice un lead por cita.
    """
    month_start, month_end = _month_bounds_iso(month) if month else (None, None)
    start_after: str | None = None
    start_after_id: str | None = None
    page = 0
    total = 0

    while page < _MAX_CONTACT_PAGES:
        page += 1
        params: dict[str, Any] = {
            "locationId": location_id,
            "limit": _PAGE_SIZE,
        }
        if start_after:
            params["startAfter"] = start_after
        if start_after_id:
            params["startAfterId"] = start_after_id

        data = _ghl_get(client, token, "/contacts/", params=params)
        contacts = data.get("contacts") or []
        print(f"[ghl] página {page}: {len(contacts)} contactos", flush=True)

        for contact in contacts:
            contact_id = contact.get("id")
            if not contact_id:
                continue

            attributions = contact.get("attributions") or []
            came_from_calendar = any(
                str(a.get("mediumId") or "") == calendar_id
                for a in attributions
                if isinstance(a, dict)
            )
            if not came_from_calendar:
                continue

            time.sleep(_REQUEST_DELAY_S)
            appt_data = _ghl_get(client, token, f"/contacts/{contact_id}/appointments")
            # GHL a veces usa "events", a veces "appointments"
            events = appt_data.get("events") or appt_data.get("appointments") or []
            if isinstance(events, dict):
                events = events.get("events") or events.get("appointments") or []
            if not isinstance(events, list):
                events = []

            for event in events:
                if not isinstance(event, dict):
                    continue
                event_cal = str(event.get("calendarId") or event.get("calendar_id") or "")
                if event_cal and event_cal != calendar_id:
                    continue
                start_time_raw = str(event.get("startTime") or event.get("start_time") or "")
                if month_start and month_end:
                    if not (month_start <= start_time_raw <= month_end):
                        continue
                status = str(
                    event.get("appointmentStatus") or event.get("status") or ""
                ).lower()
                if status in ("cancelled", "canceled"):
                    continue
                total += 1
                print(
                    f"[ghl] appointment encontrado: {contact.get('contactName')} {start_time_raw}",
                    flush=True,
                )
                yield {
                    "contact": contact,
                    "appointment": event,
                }

        meta = data.get("meta") or {}
        next_page = meta.get("nextPage")
        if not next_page:
            print(f"[ghl] fin de paginación en página {page}", flush=True)
            break
        start_after = str(meta.get("startAfter") or "")
        start_after_id = str(meta.get("startAfterId") or "")

    print(f"[ghl] total appointments a importar: {total}", flush=True)


def _fetch_contacts_with_appointments(
    client: httpx.Client,
    token: str,
    location_id: str,
    calendar_id: str,
    month: str | None,
) -> list[dict[str, Any]]:
    return list(_iter_contacts_with_appointments(client, token, location_id, calendar_id, month))

def _ghl_appointment_id(event: dict[str, Any] | None) -> str:
    if not isinstance(event, dict):
        return ""
    return str(
        event.get("id")
        or event.get("appointmentId")
        or event.get("appointment_id")
        or ""
    ).strip()


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
) -> str:
    """Upsert lead *por appointment* (no por contacto).

    Un mismo contacto GHL con N citas del mes → N leads.
    Re-sync: matchea por `GHL appointment_id` o por (contact_id + mismo call).
    """
    display_name = name.strip() or (email.split("@")[0] if email else "Lead GHL")
    appt_id = (ghl_appointment_id or "").strip()
    contact_marker = f"GHL contact_id: {ghl_contact_id}" if ghl_contact_id else ""
    appt_marker = f"GHL appointment_id: {appt_id}" if appt_id else ""

    rows = list(Lead.select(lambda l: l.user_id == user_id))
    row: Lead | None = None

    # 1) Mismo appointment (re-sync idempotente)
    if appt_marker:
        for r in rows:
            if appt_marker in str(r.notas or ""):
                row = r
                break

    # 2) Mismo contacto + misma hora de call (sin appointment_id en datos viejos)
    if row is None and contact_marker and call_at is not None:
        for r in rows:
            notas = str(r.notas or "")
            if contact_marker not in notas:
                continue
            if r.call is not None and r.call.replace(tzinfo=None) == call_at.replace(tzinfo=None):
                row = r
                break

    if row is not None:
        if display_name:
            row.nombre = display_name
        if email:
            row.email = email
        if phone:
            row.telefono = phone
        if ig:
            row.ig = ig
        if call_at is not None:
            row.call = call_at
        if agendo_at is not None:
            row.agendo = agendo_at
        row.status = "Agendado"
        row.agendo_en = "GHL"
        # Asegurar markers en notas (migración suave)
        notas = (row.notas or "").strip()
        for marker in (contact_marker, appt_marker):
            if marker and marker not in notas:
                notas = f"{notas}\n{marker}".strip() if notas else marker
        if email:
            email_line = f"ghl email: {email.strip().casefold()}"
            if email_line not in notas.casefold():
                notas = f"{notas}\n{email_line}".strip() if notas else email_line
        row.notas = notas
        if formulario:
            row.formulario = merge_formulario(row.formulario, formulario)
        return "updated"

    # 3) Nueva cita → nuevo lead (aunque el contacto ya exista con otras calls)
    notas_parts: list[str] = []
    if contact_marker:
        notas_parts.append(contact_marker)
    if appt_marker:
        notas_parts.append(appt_marker)
    if email:
        notas_parts.append(f"ghl email: {email.strip().casefold()}")

    Lead(
        user_id=user_id,
        nombre=display_name,
        email=email or "",
        telefono=phone or "",
        ig=ig or "",
        origen="GHL",
        notas="\n".join(notas_parts),
        call=call_at,
        agendo=agendo_at or call_at,
        status="Agendado",
        agendo_en="GHL",
        formulario=merge_formulario({}, formulario),
    )
    return "created"

@router.post("/sync")
def sync_ghl(
    background_tasks: BackgroundTasks,
    user_id: Annotated[str, Depends(require_user_id)],
    body: GHLSyncRequest | None = None,
    month: str | None = Query(default=None, description="YYYY-MM opcional"),
):
    uid = _uid_int(user_id)
    sync_month = (body.month.strip() if body and body.month else None) or (month.strip() if month else None)

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

    background_tasks.add_task(_run_ghl_sync, uid, token, location_id, calendar_id, sync_month)
    return {"status": "started", "month": sync_month, "message": "Sync iniciado en background. Los leads aparecerán en minutos."}


def _run_ghl_sync(uid: int, token: str, location_id: str, calendar_id: str, sync_month: str | None) -> None:
    print(f"[ghl] sync background iniciado user_id={uid} month={sync_month}", flush=True)
    created = 0
    updated = 0
    try:
        with httpx.Client(timeout=300.0) as client:
            items = _fetch_contacts_with_appointments(client, token, location_id, calendar_id, sync_month)
            print(f"[ghl] fetch completado: {len(items)} items", flush=True)
            for item in items:
                contact = item["contact"]
                appointment = item["appointment"]
                name = str(contact.get("contactName") or contact.get("firstName") or "").strip()
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
                    )
                    print(f"[ghl] lead {result}: {name}", flush=True)
                    if result == "created":
                        created += 1
                    else:
                        updated += 1
                except Exception as exc:
                    print(f"[ghl] ERROR guardando lead {name}: {exc}", flush=True)
        _touch_ghl_last_sync(uid)
        print(f"[ghl] sync background listo created={created} updated={updated}", flush=True)
    except Exception as exc:
        print(f"[ghl] ERROR en sync background: {type(exc).__name__}: {exc}", flush=True)
        import traceback
        traceback.print_exc()

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
    print(f"[ghl webhook] triggerData={trigger_data_raw}", flush=True)
    print(f"[ghl webhook] calendar={calendar_raw}", flush=True)

    # Datos del contacto → columnas existentes
    contact_id = str(body.get("contact_id") or body.get("contactId") or "").strip()
    name = str(
        body.get("full_name")
        or body.get("name")
        or body.get("Nombre y apellido")
        or body.get("first_name")
        or ""
    ).strip()
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
    calendar_data = body.get("calendar") or {}

    # startTime viene en calendar, no en triggerData
    start_time_raw = str(
        calendar_data.get("startTime") or
        trigger_data.get("startTime") or
        trigger_data.get("start_time") or
        ""
    ).strip()

    calendar_id = str(
        calendar_data.get("id") or
        calendar_data.get("calendarId") or
        trigger_data.get("calendarId") or
        trigger_data.get("calendar_id") or
        ""
    ).strip()

    call_at = _parse_ghl_datetime(start_time_raw) if start_time_raw else None
    agendo_at = datetime.utcnow()

    print(
        f"[ghl webhook] name={name} email={email} phone={phone} ig={ig} "
        f"call={call_at} calendar={calendar_id} formulario={formulario}",
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
    ghl_appointment_id = (
        _ghl_appointment_id(calendar_data if isinstance(calendar_data, dict) else None)
        or _ghl_appointment_id(trigger_data if isinstance(trigger_data, dict) else None)
        or _ghl_appointment_id(appt_body)
        or str(body.get("appointmentId") or body.get("appointment_id") or "").strip()
    )

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
        )
        print(f"[ghl webhook] lead {result}: {name} ig={ig}", flush=True)
        return {"status": "ok", "action": result}
    except Exception as exc:
        print(f"[ghl webhook] ERROR: {exc}", flush=True)
        traceback.print_exc()
        return {"status": "error", "detail": str(exc)}
