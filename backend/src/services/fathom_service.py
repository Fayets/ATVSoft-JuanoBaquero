"""Obtener transcripción de links públicos de Fathom (sin API key)."""

from __future__ import annotations

import html as html_lib
import re

import httpx

_SHARE_TOKEN_RE = re.compile(r"fathom\.video/share/([A-Za-z0-9_-]+)", re.I)
_COPY_TRANSCRIPT_RE = re.compile(r"copyTranscriptUrl&quot;:&quot;([^&]+)&quot;")
_CALL_ID_RE = re.compile(r"&quot;call&quot;:\{&quot;id&quot;:(\d+)")
_CALL_TITLE_RE = re.compile(r"&quot;title&quot;:&quot;([^&]+)&quot;")
_PLAIN_SPEAKER_RE = re.compile(r"^\s*\d+:\d+\s*-\s*(.+?)\s*$")
_USER_AGENT = "Mozilla/5.0 (compatible; ATVSoft/1.0)"


def _norm_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _extract_share_token(share_url: str) -> str:
    m = _SHARE_TOKEN_RE.search(share_url)
    if not m:
        raise ValueError("URL inválida: usá un link de fathom.video/share/...")
    return m.group(1)


def _fetch_share_page_html(token: str) -> str:
    url = f"https://fathom.video/share/{token}"
    with httpx.Client(follow_redirects=True, timeout=30.0, headers={"User-Agent": _USER_AGENT}) as client:
        resp = client.get(url)
    final = str(resp.url).lower()
    if resp.status_code in (401, 403) or "sign-in" in final or "login" in final:
        raise ValueError(
            "El link de Fathom no es público. Compartilo con acceso externo (sin pedir login)."
        )
    resp.raise_for_status()
    return resp.text


def _copy_transcript_url_from_html(html: str, token: str) -> str:
    m = _COPY_TRANSCRIPT_RE.search(html)
    if m:
        return html_lib.unescape(m.group(1))
    call_m = _CALL_ID_RE.search(html)
    if call_m:
        return f"https://fathom.video/calls/{call_m.group(1)}/copy_transcript?token={token}"
    raise ValueError("No se pudo leer la transcripción desde el link de Fathom.")


def _title_from_html(html: str) -> str:
    m = _CALL_TITLE_RE.search(html)
    if m:
        return html_lib.unescape(m.group(1)).strip()
    return ""


def _plain_text_to_speaker_lines(plain_text: str) -> str:
    lines: list[str] = []
    current_speaker = ""
    current_parts: list[str] = []

    def flush() -> None:
        nonlocal current_speaker, current_parts
        if current_speaker and current_parts:
            lines.append(f"{current_speaker}: {' '.join(current_parts)}")
        current_parts = []

    for raw in plain_text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped == "---":
            flush()
            current_speaker = ""
            continue
        sm = _PLAIN_SPEAKER_RE.match(line)
        if sm:
            flush()
            current_speaker = sm.group(1).strip()
            continue
        if current_speaker:
            current_parts.append(stripped)
    flush()
    return "\n".join(lines)


def _participants_from_plain(plain_text: str) -> str:
    names: list[str] = []
    seen: set[str] = set()
    for raw in plain_text.splitlines():
        sm = _PLAIN_SPEAKER_RE.match(raw.rstrip())
        if not sm:
            continue
        name = sm.group(1).strip()
        if "(" in name:
            name = name.split("(", 1)[0].strip()
        key = name.lower()
        if name and key not in seen:
            seen.add(key)
            names.append(name)
    return ", ".join(names)


def _fetch_from_public_share(share_url: str) -> dict[str, str]:
    token = _extract_share_token(share_url)
    page_html = _fetch_share_page_html(token)
    copy_url = _copy_transcript_url_from_html(page_html, token)
    title = _title_from_html(page_html)

    with httpx.Client(
        timeout=60.0,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
    ) as client:
        resp = client.get(copy_url)
        resp.raise_for_status()
        payload = resp.json()

    plain = str(payload.get("plain_text") or "").strip()
    if not plain:
        raise ValueError("Transcripción vacía en Fathom.")

    transcript = _plain_text_to_speaker_lines(plain)
    if not transcript.strip():
        raise ValueError("No se pudo extraer la transcripción del link de Fathom.")

    motivo = title
    if not motivo:
        first = plain.split("\n", 1)[0].strip()
        motivo = first.split(" - ", 1)[0].strip() if first else ""

    return {
        "transcript": transcript,
        "participantes": _participants_from_plain(plain),
        "motivo_reunion": motivo,
    }


def fetch_fathom_meeting(share_url: str, user_id: int) -> dict[str, str]:
    """Devuelve transcript + participantes + motivo_reunion desde el link público."""
    _ = user_id
    return _fetch_from_public_share(_norm_url(share_url))


def fetch_fathom_transcript(share_url: str, user_id: int) -> str:
    return fetch_fathom_meeting(share_url, user_id)["transcript"]


def get_fathom_status_for_user(user_id: int, *, use_cache: bool = True) -> dict:
    _ = user_id, use_cache
    return {
        "status": "ok",
        "message": "Las transcripciones se leen del link público de Fathom (no hace falta API key).",
        "api_key_masked": None,
    }


def invalidate_fathom_status_cache(user_id: int) -> None:
    _ = user_id
