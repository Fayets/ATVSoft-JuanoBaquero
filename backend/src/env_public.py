"""URLs públicas y secretos de webhooks (Conexiones + handlers externos)."""

from decouple import config


def public_site_url() -> str:
    """Dominio público del frontend (ManyChat/Calendly apuntan acá → /api/webhooks/*)."""
    for key in ("PUBLIC_SITE_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"):
        raw = (config(key, default="") or "").strip()
        if raw:
            return raw.rstrip("/")
    cors = (config("CORS_ORIGINS", default="http://localhost:3000") or "").split(",")[0].strip()
    return cors.rstrip("/") if cors else "http://localhost:3000"


def manychat_webhook_token() -> str:
    return (config("MANYCHAT_WEBHOOK_TOKEN", default="") or "").strip()
