from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from pony.orm import db_session

from src.models import ApiConnection

DEFAULT_BIO_TAG = "leads que ingresan por el perfil (DM INFO)"

MANYCHAT_TAGS_URL = "https://api.manychat.com/fb/page/getTags"


async def get_tag_counts(api_key: str) -> dict[str, int]:
    """Cuenta de suscriptores por nombre de tag (ManyChat getTags)."""
    try:
        print("[ManyChat getTags] Llamando endpoint...")
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                MANYCHAT_TAGS_URL,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
        print("[ManyChat getTags] Status:", response.status_code)
        print("[ManyChat getTags] Body:", response.text[:500])
        print("[ManyChat] getTags response:", response.status_code, response.text)
        if response.status_code != 200:
            return {}
        try:
            body = response.json()
        except Exception:
            print("[ManyChat] getTags invalid JSON, raw:", response.text)
            return {}
        tags = body.get("data", [])
        if not isinstance(tags, list):
            print("[ManyChat] getTags unexpected data shape, full JSON:", body)
            return {}
        out: dict[str, int] = {}
        for tag in tags:
            if not isinstance(tag, dict):
                continue
            name = tag.get("name")
            if name is None:
                continue
            try:
                cnt = int(tag.get("subscribers_count", 0) or 0)
            except (TypeError, ValueError):
                cnt = 0
            out[str(name)] = cnt
        return out
    except Exception as e:
        print("[ManyChat] get_tag_counts error:", e)
        return {}


def _norm_handle(raw: str | None) -> str:
    if not raw:
        return ""
    return str(raw).strip().lower().lstrip("@")


@dataclass
class ManychatCredentials:
    api_key: str
    tag: str
    tag_id: int | None = None


class ManychatService:
    base_url = "https://api.manychat.com"

    def get_credentials(self, user_id: str) -> ManychatCredentials:
        with db_session:
            rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            # Conexiones API usa platform="manychat"; mantenemos fallback por compatibilidad histórica.
            conn = next((c for c in rows if str(c.platform).strip() == "manychat"), None)
            if conn is None:
                conn = next(
                    (
                        c
                        for c in rows
                        if str(c.platform).strip().lower() in {"manychat", "many_chat"}
                    ),
                    None,
                )
            creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
        api_key = str(
            creds.get("api_key")
            or creds.get("token")
            or creds.get("access_token")
            or ""
        ).strip()
        tag = str(
            creds.get("bio_leads_tag")
            or creds.get("bio_tag_name")
            or creds.get("manychat_bio_tag_name")
            or DEFAULT_BIO_TAG
        ).strip()
        raw_tag_id = creds.get("bio_tag_id")
        try:
            tag_id = int(raw_tag_id) if raw_tag_id is not None and str(raw_tag_id).strip() else None
        except (TypeError, ValueError):
            tag_id = None
        return ManychatCredentials(api_key=api_key, tag=tag, tag_id=tag_id)

    def _headers(self, api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

    def _get(self, api_key: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(
                f"{self.base_url}{path}",
                headers=self._headers(api_key),
                params=params or {},
            )
            resp.raise_for_status()
            payload = resp.json()
            if not isinstance(payload, dict):
                return {}
            return payload

    def verify_connection(self, user_id: str) -> bool:
        creds = self.get_credentials(user_id)
        if not creds.api_key:
            return False
        headers = {"Authorization": f"Bearer {creds.api_key}"}
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.base_url}/fb/page/getInfo",
                headers=headers,
            )
        if response.status_code != 200:
            return False
        try:
            payload = response.json()
        except Exception:
            return False
        return isinstance(payload, dict) and str(payload.get("status") or "").lower() == "success"

    def _extract_list(self, data: Any) -> list[dict[str, Any]]:
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            for key in ("subscribers", "contacts", "items", "data"):
                nested = data.get(key)
                if isinstance(nested, list):
                    return [x for x in nested if isinstance(x, dict)]
        return []

    def _map_custom_fields(self, subscriber: dict[str, Any]) -> dict[str, str]:
        custom_map: dict[str, str] = {}
        raw = subscriber.get("custom_fields")
        if not isinstance(raw, list):
            return custom_map
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            value = item.get("value")
            if not name or value is None:
                continue
            custom_map[name] = str(value).strip()
        return custom_map

    def _normalize_subscriber(self, subscriber: dict[str, Any]) -> dict[str, Any]:
        custom_fields = self._map_custom_fields(subscriber)
        username = (
            str(
                subscriber.get("instagram_username")
                or subscriber.get("ig_username")
                or custom_fields.get("UsuarioIg")
                or ""
            ).strip()
        )
        current_cta_tag = (
            custom_fields.get("current_cta_tag")
            or custom_fields.get("Current CTA Tag")
            or custom_fields.get("Current Cta Tag")
            or ""
        ).strip() or None

        return {
            "subscriber_id": str(subscriber.get("id") or subscriber.get("subscriber_id") or "").strip() or None,
            "instagram_username": username or None,
            "nombre": str(subscriber.get("first_name") or subscriber.get("name") or "").strip() or None,
            "avatar_url": str(subscriber.get("avatar_url") or subscriber.get("avatar") or "").strip() or None,
            "subscribed_at": str(subscriber.get("subscribed") or subscriber.get("subscribed_at") or "").strip() or None,
            "custom_fields": {
                "current_cta_tag": current_cta_tag,
                "UsuarioIg": custom_fields.get("UsuarioIg"),
            },
            "current_cta_tag": current_cta_tag,
            "UsuarioIg": custom_fields.get("UsuarioIg"),
            "chat_url": str(subscriber.get("chat_url") or "").strip() or None,
        }

    def _get_tags(self, api_key: str) -> list[dict[str, Any]]:
        payload = self._get(api_key, "/fb/page/getTags")
        data = payload.get("data")
        return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []

    def _resolve_tag_id(self, api_key: str, tag: str) -> int | None:
        target = tag.strip().lower()
        if not target:
            return None
        for item in self._get_tags(api_key):
            name = str(item.get("name") or "").strip().lower()
            if name == target:
                raw_id = item.get("id")
                try:
                    return int(raw_id)
                except (TypeError, ValueError):
                    return None
        return None

    def get_subscribers_by_tag(self, user_id: str, tag: str | None = None) -> list[dict[str, Any]]:
        creds = self.get_credentials(user_id)
        if not creds.api_key:
            return []
        effective_tag = (tag or creds.tag).strip()
        tag_id = creds.tag_id or self._resolve_tag_id(creds.api_key, effective_tag)
        if tag_id is None:
            return []

        subscribers: list[dict[str, Any]] = []
        try:
            payload = self._get(
                creds.api_key,
                "/fb/subscriber/getInfoByTag",
                {"tag_id": tag_id, "limit": 500, "offset": 0},
            )
            items = self._extract_list(payload.get("data"))
            subscribers.extend(self._normalize_subscriber(item) for item in items)
            if items:
                # Si la API soporta paginación por offset, seguimos pidiendo hasta vaciar.
                offset = len(items)
                while True:
                    next_payload = self._get(
                        creds.api_key,
                        "/fb/subscriber/getInfoByTag",
                        {"tag_id": tag_id, "limit": 500, "offset": offset},
                    )
                    next_items = self._extract_list(next_payload.get("data"))
                    if not next_items:
                        break
                    subscribers.extend(self._normalize_subscriber(item) for item in next_items)
                    if len(next_items) < 500:
                        break
                    offset += len(next_items)
                    if offset > 100000:
                        break
            return subscribers
        except Exception:
            # Fallback: algunas cuentas/devices solo aceptan tag_id sin paginación explícita.
            payload = self._get(
                creds.api_key,
                "/fb/subscriber/getInfoByTag",
                {"tag_id": tag_id},
            )
            items = self._extract_list(payload.get("data"))
            return [self._normalize_subscriber(item) for item in items]

    def get_subscriber_by_instagram(self, user_id: str, handle: str) -> dict[str, Any] | None:
        creds = self.get_credentials(user_id)
        if not creds.api_key:
            return None
        target = _norm_handle(handle)
        if not target:
            return None

        try:
            payload = self._get(
                creds.api_key,
                "/fb/subscriber/findByName",
                {"name": target},
            )
            items = self._extract_list(payload.get("data"))
            for item in items:
                normalized = self._normalize_subscriber(item)
                username = _norm_handle(normalized.get("instagram_username"))
                usuario_ig = _norm_handle(normalized.get("UsuarioIg"))
                if username == target or usuario_ig == target:
                    return {
                        "instagram_username": normalized.get("instagram_username"),
                        "current_cta_tag": normalized.get("current_cta_tag"),
                        "UsuarioIg": normalized.get("UsuarioIg"),
                        "subscribed_at": normalized.get("subscribed_at"),
                        "avatar_url": normalized.get("avatar_url"),
                    }
        except Exception:
            return None

        return None
