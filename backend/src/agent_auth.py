from typing import Annotated

from decouple import config
from fastapi import Header, HTTPException

ADMIN_API_KEY = config("ADMIN_API_KEY", default="")
AGENT_USER_ID = config("AGENT_USER_ID", default="")


def get_agent_auth(
    x_agent_key: Annotated[str | None, Header(alias="X-Agent-Key")] = None,
) -> None:
    """Autenticación M2M para el bot (independiente de JWT / X-User-Id)."""
    expected = str(ADMIN_API_KEY or "").strip()
    if not expected:
        raise HTTPException(status_code=401, detail="API key inválida o faltante.")
    provided = str(x_agent_key or "").strip()
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="API key inválida o faltante.")


def get_agent_user_id() -> int:
    raw = str(AGENT_USER_ID or "").strip()
    if not raw:
        raise HTTPException(
            status_code=503,
            detail="AGENT_USER_ID no configurado en el servidor.",
        )
    try:
        return int(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail="AGENT_USER_ID inválido en el servidor.",
        ) from exc
