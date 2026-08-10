"""Utilidad: guardar reportes de migración legacy en docs/*.md."""
from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"


def report_path(slug: str, *, dated: bool = True) -> Path:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    if dated:
        return DOCS_DIR / f"{slug}_{date.today().isoformat()}.md"
    return DOCS_DIR / f"{slug}.md"


def write_report(
    slug: str,
    body: str,
    *,
    title: str | None = None,
    dated: bool = True,
    meta: dict[str, str] | None = None,
) -> Path:
    path = report_path(slug, dated=dated)
    heading = title or slug.replace("_", " ").replace("-", " ").title()
    ts = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    lines = [f"# {heading}", "", f"**Generado:** {ts} UTC"]
    if meta:
        for k, v in meta.items():
            lines.append(f"**{k}:** {v}")
    lines.extend(["", "---", "", body.rstrip(), ""])
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def md_table(headers: list[str], rows: list[list[str]], *, aligns: list[str] | None = None) -> str:
    if not rows:
        return "_(ninguno)_\n"
    aligns = aligns or ["---"] * len(headers)
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(aligns) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(c) for c in row) + " |")
    return "\n".join(lines) + "\n"
