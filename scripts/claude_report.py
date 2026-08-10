"""Utilidades para escribir reportes Markdown en docs/ (handoff Claude)."""
from __future__ import annotations

from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"


def docs_path(filename: str) -> Path:
    name = filename if filename.endswith(".md") else f"{filename}.md"
    if not name.upper().startswith("CLAUDE_"):
        name = f"CLAUDE_{name}"
    return DOCS_DIR / name


def write_claude_report(
    filename: str,
    body: str,
    *,
    title: str | None = None,
) -> Path:
    """Guarda reporte en docs/. Retorna la ruta escrita."""
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    path = docs_path(filename)
    text = body.strip()
    if not text.startswith("#"):
        heading = title or path.stem.replace("_", " ")
        text = f"# {heading}\n\n{text}"
    path.write_text(text + "\n", encoding="utf-8")
    return path


def report_footer(script: str, user_id: int = 1) -> str:
    today = date.today().isoformat()
    return (
        f"\n---\n\n"
        f"*Generado: {today} · tenant user_id={user_id} · `{script}`*\n"
    )
