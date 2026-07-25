from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pony.orm import db_session

from src.models import ApiConnection
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.anthropic_service import invalidate_claude_status_cache

_CALENDLY_CREDENTIAL_KEYS = frozenset({"api_key", "signing_key"})


def _sanitize_calendly_credentials(creds: dict) -> dict:
    """Solo persiste PAT y signing key; ignora q_* legacy."""
    return {k: str(v) if v is not None else "" for k, v in creds.items() if k in _CALENDLY_CREDENTIAL_KEYS}


class ConexionesServices:
    @staticmethod
    def _iso_utc(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat()

    def _to_response(self, row: ApiConnection) -> ApiConnectionResponse:
        creds = row.credentials if isinstance(row.credentials, dict) else {}
        return ApiConnectionResponse(
            id=str(row.id),
            user_id=str(row.user_id),
            platform=row.platform,
            credentials=creds,
            last_sync_at=row.last_sync_at,
            updated_at=row.updated_at,
        )

    def list_by_user(self, user_id: int) -> list[ApiConnectionResponse]:
        with db_session:
            rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            rows.sort(key=lambda r: r.platform)
            return [self._to_response(r) for r in rows]

    def _merge_previous_credentials(
        self,
        platform: str,
        incoming: dict,
        previous: dict,
    ) -> dict:
        merged = dict(incoming)
        pl = platform.lower()
        if pl == "instagram":
            previous_token = str(previous.get("access_token") or "").strip()
            incoming_token = str(merged.get("access_token") or "").strip()
            if not incoming_token and previous_token:
                merged["access_token"] = previous_token
        elif pl == "calendly":
            for key in _CALENDLY_CREDENTIAL_KEYS:
                if not str(merged.get(key) or "").strip() and str(previous.get(key) or "").strip():
                    merged[key] = previous[key]
        elif pl == "manychat":
            for key in ("api_key", "webhook_token", "bio_keyword"):
                if not str(merged.get(key) or "").strip() and str(previous.get(key) or "").strip():
                    merged[key] = previous[key]
            for key, val in previous.items():
                if key not in merged:
                    merged[key] = val
        else:
            for key, val in previous.items():
                if key not in merged or not str(merged.get(key) or "").strip():
                    if str(val or "").strip() and not str(merged.get(key) or "").strip():
                        merged[key] = val
        return merged

    def upsert(self, user_id: int, platform: str, body: ApiConnectionUpsertRequest) -> ApiConnectionResponse:
        if not platform.strip():
            raise HTTPException(status_code=400, detail="La plataforma no puede estar vacía.")
        platform = platform.strip()
        now = datetime.now(timezone.utc)
        with db_session:
            user_rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            matches = [c for c in user_rows if c.platform == platform]
            matches.sort(key=lambda c: c.id)
            existing = matches[0] if matches else None
            incoming_credentials = dict(body.credentials or {})
            if platform.lower() == "calendly":
                incoming_credentials = _sanitize_calendly_credentials(incoming_credentials)
            if existing:
                previous_credentials = existing.credentials if isinstance(existing.credentials, dict) else {}
                incoming_credentials = self._merge_previous_credentials(
                    platform, incoming_credentials, previous_credentials
                )
                if platform.lower() == "instagram":
                    previous_token = str(previous_credentials.get("access_token") or "").strip()
                    incoming_token = str(incoming_credentials.get("access_token") or "").strip()
                    if incoming_token and incoming_token != previous_token:
                        incoming_credentials["token_saved_at"] = self._iso_utc(now)
                        incoming_credentials["token_expires_at"] = self._iso_utc(now + timedelta(days=60))
                    elif incoming_token and incoming_token == previous_token:
                        for key in ("token_saved_at", "token_expires_at"):
                            if key not in incoming_credentials and key in previous_credentials:
                                incoming_credentials[key] = previous_credentials[key]
                existing.credentials = incoming_credentials
                existing.updated_at = now
                if platform.lower() == "claude":
                    invalidate_claude_status_cache(user_id)
                return self._to_response(existing)
            row = ApiConnection(
                user_id=user_id,
                platform=platform,
                credentials=(
                    {
                        **incoming_credentials,
                        **(
                            {
                                "token_saved_at": self._iso_utc(now),
                                "token_expires_at": self._iso_utc(now + timedelta(days=60)),
                            }
                            if platform.lower() == "instagram"
                            and str(incoming_credentials.get("access_token") or "").strip()
                            else {}
                        ),
                    }
                ),
                updated_at=now,
            )
            if platform.lower() == "claude":
                invalidate_claude_status_cache(user_id)
            return self._to_response(row)
