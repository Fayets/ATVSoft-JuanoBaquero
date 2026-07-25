"""Valores mostrados en UI cuando ManyChat envía solo placeholders y `nombre` queda vacío."""


def lead_display_nombre(nombre: str | None, ig: str | None) -> str:
    n = (nombre or "").strip()
    if n:
        return n
    return (ig or "").strip()
