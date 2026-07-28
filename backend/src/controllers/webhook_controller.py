import re
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from pony.orm import db_session

from src.env_public import manychat_webhook_token
from src.models import ApiConnection, Lead, ReelContent
from src.services.triajer_service import pick_next_triajer

router = APIRouter(prefix="/webhooks", tags=["webhooks"], redirect_slashes=False)


def _norm_kw(s: str) -> str:
    return (s or "").strip().casefold()


def _norm_ig(s: str) -> str:
    return (s or "").strip().lstrip("@").casefold()


def _sanitize_webhook_display_name(raw: str) -> str:
    """Quita etiquetas ManyChat sin sustituir ({{first_name}}, etc.) que a veces llegan como texto."""
    s = (raw or "").strip()
    if not s:
        return ""
    cleaned = re.sub(r"\{\{[^}]*\}\}", "", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _keyword_tokens_csv(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def _merge_keyword_csv(existing: str | None, new_token: str) -> str:
    """Una sola fila por contacto: varias keywords en el mismo campo, coma-separadas (igual que en reels/leads)."""
    t = (new_token or "").strip()
    parts = _keyword_tokens_csv(existing)
    seen = {p.casefold() for p in parts}
    if t and t.casefold() not in seen:
        parts.append(t)
    return ", ".join(parts)


def _find_lead_same_contact(user_id: int, ig_display: str) -> Lead | None:
    """Mismo dueño + mismo IG → un solo lead; se agregan keywords."""
    ig_key = _norm_ig(ig_display)
    if not ig_key:
        return None
    matches = [
        r
        for r in list(Lead.select(lambda r: r.user_id == user_id))
        if _norm_ig(r.ig or "") == ig_key
    ]
    if not matches:
        return None
    matches.sort(key=lambda r: (r.created_at.timestamp() if r.created_at else 0.0), reverse=True)
    return matches[0]


def _resolve_user_id_by_keyword(keyword: str) -> int | None:
    """Dueño del keyword: reel con ese keyword; si no hay reel, primer ApiConnection manychat (keyword de bio genérico)."""
    kw = _norm_kw(keyword)
    if not kw:
        return None

    with db_session:
        reel_uid: int | None = None
        for reel in list(ReelContent.select()):
            if _norm_kw(reel.keyword or "") != kw:
                continue
            uid = int(reel.user_id)
            if reel_uid is None:
                reel_uid = uid
            elif reel_uid != uid:
                raise HTTPException(
                    status_code=409,
                    detail="Hay más de un usuario con el mismo keyword en reels. Corregí keywords duplicados.",
                )
        if reel_uid is not None:
            return reel_uid

        manychat_conns = [
            c
            for c in list(ApiConnection.select())
            if str(c.platform).strip().lower() == "manychat"
        ]
        manychat_conns.sort(key=lambda c: int(c.id))
        if manychat_conns:
            return int(manychat_conns[0].user_id)

    return None


@router.post("/manychat")
async def manychat_webhook(request: Request) -> dict[str, str]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    payload = body if isinstance(body, dict) else {}
    query_token = str(request.query_params.get("token") or "").strip()
    header_token = str(request.headers.get("X-Webhook-Token") or "").strip()

    resolved_token = query_token or header_token or str(payload.get("webhook_token") or "").strip()
    if resolved_token:
        payload["webhook_token"] = resolved_token

    event = str(payload.get("event") or "").strip().lower()
    webhook_token = str(payload.get("webhook_token") or "").strip()

    expected = manychat_webhook_token()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="MANYCHAT_WEBHOOK_TOKEN no configurado en el servidor.",
        )
    if str(webhook_token) != expected:
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    if event == "respondio_auto":
        ig_key = _norm_ig(str(payload.get("contact_ig_username") or "").strip())
        if not ig_key:
            return {"status": "ok"}
        with db_session:
            matches = [
                r for r in list(Lead.select()) if _norm_ig(r.ig or "") == ig_key
            ]
            if not matches:
                return {"status": "ok"}
            matches.sort(
                key=lambda r: (r.created_at.timestamp() if r.created_at else 0.0),
                reverse=True,
            )
            matches[0].respondio_auto = True
        return {"status": "ok"}

    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="Missing keyword")

    user_id = _resolve_user_id_by_keyword(keyword)
    if user_id is None:
        raise HTTPException(
            status_code=404,
            detail="No se encontró un usuario para esta keyword (revisa reels o conexión ManyChat).",
        )

    contact_name = _sanitize_webhook_display_name(str(payload.get("contact_name") or ""))
    contact_lastname = _sanitize_webhook_display_name(str(payload.get("contact_lastname") or ""))
    nombre = " ".join(x for x in (contact_name, contact_lastname) if x).strip()
    # Mismo criterio: si en ManyChat el body tiene "{{ig_username}}" entre comillas, llega literal.
    ig = _sanitize_webhook_display_name(str(payload.get("contact_ig_username") or "")).lstrip("@")
    if not nombre and ig:
        nombre = ig
    content_url = str(payload.get("content_url") or "").strip()
    manychat_contact_id = _sanitize_webhook_display_name(str(payload.get("manychat_contact_id") or ""))

    now = datetime.utcnow()
    with db_session:
        existing = _find_lead_same_contact(user_id, ig)
        if existing is not None:
            existing.keyword = _merge_keyword_csv(existing.keyword, keyword)
            if not (existing.nombre or "").strip() and nombre:
                existing.nombre = nombre
            if ig:
                existing.ig = ig
            if content_url:
                existing.content_url = content_url
            if manychat_contact_id and not (existing.manychat_contact_id or "").strip():
                existing.manychat_contact_id = manychat_contact_id
            existing.fecha_bot = now
        else:
            Lead(
                user_id=user_id,
                nombre=nombre,
                ig=ig,
                keyword=keyword,
                content_url=content_url,
                manychat_contact_id=manychat_contact_id,
                fecha_bot=now,
                respondio_auto=False,
            )

    return {"status": "ok"}


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}


def _norm_name_for_match(raw: str) -> str:
    s = re.sub(r"\s+", " ", (raw or "").strip()).casefold()
    return s


def _phone_from_calendly_payload(payload: dict) -> str:
    for key in ("text_reminder_number", "phone_number", "new_phone"):
        v = str(payload.get(key) or "").strip()
        if v:
            return v
    for qa in payload.get("questions_and_answers") or []:
        if not isinstance(qa, dict):
            continue
        q = str(qa.get("question") or "").casefold()
        a = str(qa.get("answer") or "").strip()
        if not a:
            continue
        if "phone" in q or "tel" in q or "celular" in q or "whatsapp" in q:
            return a
        if re.match(r"^\+?[\d\s\-().]{8,}$", a):
            return a
    return ""


def _flatten_calendly_invitee_payload(body: dict) -> dict:
    """Unifica formas habituales del body (payload plano vs anidado tipo API v2)."""
    payload = body.get("payload")
    if not isinstance(payload, dict):
        payload = body
    inner = payload
    invitee = inner.get("invitee")
    if isinstance(invitee, dict):
        merged = {**inner, **invitee}
    else:
        merged = dict(inner)
    scheduled = merged.get("scheduled_event")
    if isinstance(scheduled, dict) and "start_time" not in merged:
        merged["start_time"] = scheduled.get("start_time")
    ev = merged.get("event")
    if isinstance(ev, dict) and not merged.get("start_time"):
        merged["start_time"] = ev.get("start_time")
    return merged


def _calendly_webhook_received_at(flat: dict, inner: dict) -> datetime:
    """Instante en que Calendly registró al invitee (completó el form / webhook invitee.created)."""
    raw = (
        flat.get("created_at")
        or inner.get("created_at")
        or flat.get("updated_at")
        or inner.get("updated_at")
    )
    if raw:
        dt = _parse_calendly_start_time(str(raw))
        if dt is not None:
            return dt
    return datetime.utcnow()


def _parse_calendly_start_time(raw: str | None) -> datetime | None:
    """Parsea ISO Calendly → UTC naive."""
    if not raw or not str(raw).strip():
        return None
    from datetime import timezone

    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _ig_from_calendly_qa(payload: dict) -> str:
    for qa in payload.get("questions_and_answers") or []:
        if not isinstance(qa, dict):
            continue
        q = str(qa.get("question") or "").casefold()
        if "instagram" in q or q in ("ig", "tu ig", "usuario ig"):
            return str(qa.get("answer") or "").strip().lstrip("@")
    return ""


def _calendly_inner_payload(body: dict) -> dict:
    p = body.get("payload")
    return p if isinstance(p, dict) else {}


def _calendly_qna_list(inner: dict) -> list:
    qna = inner.get("questions_and_answers") or []
    return qna if isinstance(qna, list) else []


def _qna_position_matches(item: dict, position: int) -> bool:
    p = item.get("position")
    if p is None:
        return False
    try:
        return int(p) == position
    except (TypeError, ValueError):
        return False


def _qna_answer_at_position(qna: list, position: int) -> str | None:
    for item in qna:
        if not isinstance(item, dict):
            continue
        if not _qna_position_matches(item, position):
            continue
        ans = item.get("answer")
        if ans is None:
            return None
        t = str(ans).strip()
        return t if t else None
    return None


def _merge_calendly_email_notas(existing: str | None, email: str) -> str:
    line = f"Calendly email: {email}"
    base = (existing or "").strip()
    if not base:
        return line
    if line in base:
        return base
    return f"{base}\n{line}"


def _calendly_questions(flat: dict, inner: dict | None = None) -> list[dict]:
    sources = [flat]
    if isinstance(inner, dict):
        sources.append(inner)
    for src in sources:
        qa = src.get("questions_and_answers")
        if isinstance(qa, list):
            return [item for item in qa if isinstance(item, dict)]
    return []


def _find_calendly_answer(questions: list[dict], *keywords: str) -> str:
    """Busca respuesta por substring en el texto de la pregunta (casefold)."""
    kws = [k.casefold() for k in keywords if k]
    for item in questions:
        q = str(item.get("question") or "").casefold()
        if not q:
            continue
        if any(kw in q for kw in kws):
            return str(item.get("answer") or "").strip()
    return ""


def _extract_calendly_form_fields(flat: dict, inner: dict | None = None) -> dict[str, str]:
    """Mapea Q&A del formulario Calendly → campos Lead."""
    qa = _calendly_questions(flat, inner)
    phone = (
        _find_calendly_answer(qa, "número de teléfono", "numero de telefono", "teléfono", "telefono", "phone")
        or str(flat.get("text_reminder_number") or (inner or {}).get("text_reminder_number") or "").strip()
    )
    return {
        "phone": phone,
        "compromiso": _find_calendly_answer(qa, "comprometidas", "realmente comprometidas"),
    }


def _apply_calendly_form_fields(row: Lead, fields: dict[str, str]) -> None:
    phone = (fields.get("phone") or "").strip()
    if phone:
        row.telefono = phone
    compromiso = (fields.get("compromiso") or "").strip()
    if compromiso:
        marker = f"Compromiso Calendly: {compromiso}"
        base = (row.notas or "").strip()
        if marker not in base:
            row.notas = f"{base}\n{marker}".strip() if base else marker


def _find_lead_for_calendly(user_id: int, display_name: str, ig_hint: str) -> Lead | None:
    """Misma cuenta: prioriza coincidencia por IG, luego por nombre (normalizado)."""
    nkey = _norm_name_for_match(display_name)
    ig_key = _norm_ig(ig_hint)
    rows = list(Lead.select(lambda r: r.user_id == user_id))

    def _ts(row: Lead) -> float:
        return row.created_at.timestamp() if row.created_at else 0.0

    if ig_key:
        ig_matches = [r for r in rows if _norm_ig(r.ig or "") == ig_key]
        if ig_matches:
            ig_matches.sort(key=_ts, reverse=True)
            return ig_matches[0]
    if nkey:
        name_matches = [r for r in rows if _norm_name_for_match(r.nombre or "") == nkey]
        if name_matches:
            name_matches.sort(key=_ts, reverse=True)
            return name_matches[0]
    return None


@router.post("/calendly")
async def calendly_webhook(request: Request) -> dict[str, str]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    payload = body
    print(f"[calendly webhook] payload: {payload}")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    event = str(body.get("event") or "").strip()
    if event != "invitee.created":
        return {"status": "ok"}

    inner_payload = _calendly_inner_payload(body)
    flat = _flatten_calendly_invitee_payload(body)
    qna = _calendly_qna_list(inner_payload)

    telefono_q = _qna_answer_at_position(qna, 0)
    ig_q = _qna_answer_at_position(qna, 1)
    avatar_q = _qna_answer_at_position(qna, 2)

    display_name = _sanitize_webhook_display_name(
        str(inner_payload.get("name") or flat.get("name") or ""),
    )
    email = str(inner_payload.get("email") or flat.get("email") or "").strip()

    start_raw = flat.get("start_time")
    if not start_raw and isinstance(flat.get("scheduled_event"), dict):
        start_raw = flat["scheduled_event"].get("start_time")
    if isinstance(start_raw, dict):
        start_raw = start_raw.get("start_time")
    start_dt = _parse_calendly_start_time(str(start_raw) if start_raw else None)

    telefono = (telefono_q or "") or _phone_from_calendly_payload(flat)
    ig_hint = (ig_q or "").lstrip("@") or _ig_from_calendly_qa(flat)
    if not ig_hint and "@" in display_name:
        for p in display_name.split():
            p = p.strip().lstrip("@")
            if p and "@" not in p and len(p) > 1:
                ig_hint = p
                break
    avatar_val = (avatar_q or "").strip()

    if not display_name and email:
        display_name = email.split("@")[0]

    start_raw_label = str(start_raw) if start_raw is not None else ""
    form_completed_at = _calendly_webhook_received_at(flat, inner_payload)
    form_fields = _extract_calendly_form_fields(flat, inner_payload)

    with db_session:
        calendly_conns = [
            c
            for c in list(ApiConnection.select())
            if str(c.platform or "").strip().casefold() == "calendly"
        ]
        calendly_conns.sort(key=lambda c: int(c.id))
        if not calendly_conns:
            raise HTTPException(
                status_code=404,
                detail="No hay conexión ApiConnection con platform=calendly.",
            )
        user_id = int(calendly_conns[0].user_id)

        row = _find_lead_for_calendly(user_id, display_name, ig_hint)
        if row is not None:
            row.agendo = form_completed_at
            if start_dt is not None:
                row.call = start_dt
            row.agendo_en = "Chat"
            if display_name:
                row.nombre = display_name
            if email:
                row.email = email
                row.notas = _merge_calendly_email_notas(row.notas, email)
            if telefono:
                row.telefono = telefono
            if ig_hint:
                row.ig = ig_hint
            if avatar_val:
                row.avatar = avatar_val
            _apply_calendly_form_fields(row, form_fields)
        else:
            notas_parts = []
            if email:
                notas_parts.append(f"Calendly email: {email}")
            if start_raw_label:
                notas_parts.append(f"Cita: {start_raw_label}")
            row = Lead(
                user_id=user_id,
                nombre=display_name or (email.split("@")[0] if email else "Invitado Calendly"),
                ig=ig_hint or "",
                telefono=telefono or "",
                avatar=avatar_val or "",
                email=email or "",
                agendo=form_completed_at,
                call=start_dt,
                agendo_en="Chat",
                notas="\n".join(notas_parts),
                triajer=pick_next_triajer(user_id),
                triaje_hecho=False,
            )
            _apply_calendly_form_fields(row, form_fields)

    return {"status": "ok"}


@router.get("/calendly")
def calendly_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "calendly-webhook"}
