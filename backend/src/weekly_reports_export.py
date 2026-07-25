"""Export PDF de reportes semanales (estilo marca ATV)."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime

from src.call_reports_export import (
    _ATV_RED,
    _ATV_RED_DARK,
    _INK,
    _LINE,
    _LOGO_PATH,
    _MUTED,
    _pdf_safe,
)

_SECTION_RE = re.compile(r"^#{1,6}\s+(.+)$")
_TABLE_ROW_RE = re.compile(r"^\|.+\|$")
_TABLE_SEP_RE = re.compile(r"^:?-+:?$")
_TABLE_HEADER_LABELS = {"METRICA", "METRIC", "VALOR", "VALUE", "INDICADOR"}
_HRULE_RE = re.compile(r"^-{3,}$")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_BACKTICK_RE = re.compile(r"`(.+?)`")
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0001F600-\U0001F64F"
    "]+",
    flags=re.UNICODE,
)

_MAIN_SECTIONS = {
    "RESUMEN EJECUTIVO",
    "METRICAS CONSOLIDADAS",
    "ANALISIS POR LLAMADA",
    "PATRONES DETECTADOS",
    "REPORTE CLOSER — CONSISTENCIA",
    "REPORTE CLOSER - CONSISTENCIA",
    "RECOMENDACIONES",
    "ALERTAS",
    "CONCLUSION",
    "FEEDBACK MARKETING",
}


def _normalize_key(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", (text or "").strip().upper())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _parse_table_row(line: str) -> str | None:
    t = line.strip()
    if not _TABLE_ROW_RE.match(t):
        return None
    cells = [c.strip() for c in t.strip("|").split("|")]
    cells = [c for c in cells if c]
    if len(cells) < 2:
        return None
    if all(_TABLE_SEP_RE.match(c) for c in cells):
        return None
    head = _normalize_key(cells[0])
    if head in _TABLE_HEADER_LABELS or _normalize_key(cells[1]) in _TABLE_HEADER_LABELS:
        return None
    return f"{cells[0]}: {' '.join(cells[1:])}"


def _looks_like_metric(line: str) -> bool:
    if ":" not in line or line.startswith("http"):
        return False
    label, _, value = line.partition(":")
    return bool(label.strip() and value.strip() and len(label.strip()) < 50)


def sanitize_weekly_content(raw: str) -> str:
    """Quita markdown residual para texto plano legible en PDF."""
    if not raw:
        return ""
    lines: list[str] = []
    for line in raw.splitlines():
        t = line.strip()
        if not t:
            lines.append("")
            continue
        if _HRULE_RE.match(t):
            continue
        table_metric = _parse_table_row(t)
        if table_metric:
            lines.append(table_metric)
            continue
        if _TABLE_ROW_RE.match(t):
            continue
        if t.startswith("|") or t.endswith("|"):
            continue
        m = _SECTION_RE.match(t)
        if m:
            t = m.group(1).strip()
        t = _BACKTICK_RE.sub(r"\1", t)
        t = _BOLD_RE.sub(r"\1", t)
        t = _ITALIC_RE.sub(r"\1", t)
        t = _EMOJI_RE.sub("", t)
        t = re.sub(r"^>\s+", "", t)
        t = re.sub(r"^[-*]\s+", "- ", t) if t.startswith(("* ", "- ")) else t
        t = re.sub(r"\s{2,}", " ", t).strip()
        if t and not any(_normalize_key(t).startswith(p) for p in _SKIP_PREFIXES):
            lines.append(t)
    return "\n".join(lines).strip()


_METRICS_SECTION = "METRICAS CONSOLIDADAS"
_SKIP_PREFIXES = ("REPORTE SEMANAL DE VENTAS", "SEMANA ")


def weekly_report_filename(semana_inicio: str, semana_fin: str) -> str:
    def fmt(iso: str) -> str:
        parts = (iso or "").split("-")
        if len(parts) == 3:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"
        return iso or "semana"

    return f"reporte_semanal_{fmt(semana_inicio)}_{fmt(semana_fin)}.pdf"


def _is_main_section(title: str) -> bool:
    key = _normalize_key(title)
    return key in _MAIN_SECTIONS


def _is_subsection(title: str) -> bool:
    t = title.strip()
    if not t or t.startswith("- "):
        return False
    if _is_main_section(t):
        return False
    if _looks_like_metric(t):
        return False
    if t.endswith(":") and len(t) < 80:
        return True
    if t.isupper() and len(t) > 4 and " " in t:
        return True
    return False


def build_weekly_report_pdf(
    contenido: str,
    *,
    semana_label: str,
) -> bytes:
    from fpdf import FPDF

    class _AtvWeeklyPDF(FPDF):
        def header(self) -> None:
            self.set_fill_color(*_ATV_RED)
            self.rect(0, 0, self.w, 16, "F")
            self.set_fill_color(*_ATV_RED_DARK)
            self.rect(0, 16, self.w, 0.8, "F")

            x0 = self.l_margin
            if _LOGO_PATH.is_file():
                try:
                    self.image(str(_LOGO_PATH), x=x0, y=3, h=10)
                    x0 = x0 + 14
                except Exception:
                    pass

            self.set_xy(x0, 4.5)
            self.set_text_color(255, 255, 255)
            self.set_font("Helvetica", "B", 12)
            self.cell(0, 5, _pdf_safe("ATV Soft"), new_x="LMARGIN", new_y="NEXT")
            self.set_x(x0)
            self.set_font("Helvetica", "", 7.5)
            self.cell(0, 4, _pdf_safe("Reporte semanal de ventas"), new_x="LMARGIN", new_y="NEXT")
            self.set_text_color(*_INK)
            self.set_y(22)

        def footer(self) -> None:
            self.set_y(-12)
            self.set_draw_color(*_LINE)
            self.set_line_width(0.15)
            self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
            self.set_y(-10)
            self.set_font("Helvetica", "", 7)
            self.set_text_color(*_MUTED)
            self.cell(
                0,
                5,
                _pdf_safe(f"ATV Soft  ·  Pagina {self.page_no()}  ·  Confidencial"),
                align="C",
            )
            self.set_text_color(*_INK)

    pdf = _AtvWeeklyPDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 16, 16)
    pdf.add_page()

    # Portada compacta
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*_INK)
    pdf.cell(0, 9, _pdf_safe("Reporte Semanal de Ventas"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*_MUTED)
    pdf.cell(0, 6, _pdf_safe(f"Semana {semana_label}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*_ATV_RED)
    pdf.set_line_width(0.5)
    y = pdf.get_y() + 1
    pdf.line(pdf.l_margin, y, pdf.l_margin + 42, y)
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(
        0,
        4,
        _pdf_safe(f"Generado {datetime.utcnow().strftime('%d/%m/%Y %H:%M')} UTC"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(*_INK)
    pdf.ln(4)

    def _main_section(title: str) -> None:
        pdf.ln(5)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*_INK)
        pdf.multi_cell(0, 5.5, _pdf_safe(title.strip()))
        pdf.set_x(pdf.l_margin)
        pdf.set_draw_color(*_ATV_RED)
        pdf.set_line_width(0.35)
        y = pdf.get_y() + 0.5
        pdf.line(pdf.l_margin, y, pdf.l_margin + 28, y)
        pdf.ln(3)

    def _subsection(title: str) -> None:
        pdf.ln(2.5)
        pdf.set_font("Helvetica", "B", 9.5)
        pdf.set_text_color(*_ATV_RED_DARK)
        t = title.rstrip(":").strip()
        pdf.multi_cell(0, 5, _pdf_safe(t))
        pdf.set_x(pdf.l_margin)
        pdf.set_text_color(*_INK)
        pdf.ln(1)

    def _metric_line(text: str) -> None:
        label, sep, value = text.partition(":")
        if sep and len(label) < 48:
            pdf.set_x(pdf.l_margin)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*_MUTED)
            pdf.cell(52, 5, _pdf_safe(label.strip() + ":"))
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*_INK)
            pdf.multi_cell(0, 5, _pdf_safe(value.strip()))
            pdf.set_x(pdf.l_margin)
            pdf.ln(0.3)
            return
        _body(text)

    def _body(text: str, *, bullet: bool = False) -> None:
        line = text.strip()
        if not line:
            return
        indent = 5 if bullet else 0
        pdf.set_x(pdf.l_margin + indent)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*_INK)
        prefix = "·  " if bullet else ""
        pdf.multi_cell(0, 5, _pdf_safe(prefix + line))
        pdf.set_x(pdf.l_margin)
        pdf.ln(0.4)

    raw = sanitize_weekly_content(contenido or "")
    if not raw:
        _body("Sin contenido.")
    else:
        section_key: str | None = None
        for line in raw.splitlines():
            trimmed = line.strip()
            if not trimmed:
                pdf.ln(1.5)
                continue

            if _is_main_section(trimmed):
                section_key = _normalize_key(trimmed)
                _main_section(trimmed)
                continue

            if section_key == _METRICS_SECTION:
                if _looks_like_metric(trimmed):
                    _metric_line(trimmed)
                elif trimmed.startswith("- "):
                    _body(trimmed[2:], bullet=True)
                else:
                    _body(trimmed)
                continue

            if trimmed.startswith("- "):
                _body(trimmed[2:], bullet=True)
                continue

            num = re.match(r"^(\d+)\.\s+(.+)$", trimmed)
            if num:
                _body(f"{num.group(1)}. {num.group(2)}")
                continue

            if _is_subsection(trimmed):
                _subsection(trimmed)
                continue

            _body(trimmed)

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1", errors="replace")
