"""Export PDF de reportes de llamadas (estilo marca ATV)."""

from __future__ import annotations

import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

# Rojo ATVMkt (--accent / --red)
_ATV_RED = (230, 57, 70)
_ATV_RED_DARK = (183, 28, 28)
_INK = (24, 24, 27)
_MUTED = (82, 82, 91)
_LINE = (228, 228, 231)
_SOFT_BG = (250, 250, 250)

_LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "atv-logo.png"

_NEW_FIELDS = (
    ("nivel_dolor", "Nivel de dolor"),
    ("capacidad_decision", "Capacidad de decision"),
    ("capacidad_economica", "Capacidad economica"),
    ("fit_real", "Fit real"),
    ("objecion_diagnostico", "Objecion real vs superficie"),
    ("cambio_energia", "Momento de cambio de energia"),
    ("objecion_no_manejada", "Objecion no manejada"),
    ("razon_real_no_cerrar", "Razon real de no cerrar"),
    ("compromisos_prometidos", "Compromisos prometidos"),
    ("patrones_y_mejoras", "Patrones y puntos de mejora"),
)


def _pdf_safe(s: str, max_len: int = 8000) -> str:
    if not s:
        return ""
    t = s.strip()
    if len(t) > max_len:
        t = t[: max_len - 3] + "..."
    nfkd = unicodedata.normalize("NFKD", t)
    return "".join(c for c in nfkd if ord(c) < 128 or c in "\n\t ")


def format_report_fecha(iso: str | None) -> str:
    s = (iso or "").strip()
    if not s:
        return "-"
    date_part = s[:10]
    parts = date_part.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[0]) == 4:
        y, mo, d = parts
        return f"{d}-{mo}-{y}"
    return s


def safe_lead_filename(name: str) -> str:
    raw = (name or "").strip() or "Sin nombre"
    for ch in '<>:"/\\|?*':
        raw = raw.replace(ch, "")
    raw = " ".join(raw.split())
    return (raw[:80] or "Sin nombre")


def download_filename_for_reports(reports: list[dict[str, str]], fmt: str = "pdf") -> str:
    ext = (fmt or "pdf").strip().lower() or "pdf"
    if not reports:
        return f"reporte_(Sin nombre).{ext}"
    first = safe_lead_filename(reports[0].get("lead") or "")
    if len(reports) == 1:
        return f"reporte_({first}).{ext}"
    return f"reporte_({first})_y_{len(reports)}.{ext}"


def _g(row: Any, key: str) -> str:
    return (getattr(row, key, None) or "").strip()


def report_as_dict(row: Any, created_at_iso: str) -> dict[str, str]:
    data = {
        "fecha": format_report_fecha(created_at_iso),
        "lead": _g(row, "lead_nombre") or "Sin nombre",
        "link": _g(row, "fathom_url"),
        "participantes": _g(row, "participantes") or "-",
        "motivo": _g(row, "motivo_reunion") or "-",
    }
    for key, _label in _NEW_FIELDS:
        data[key] = _g(row, key) or "-"
    data["resumen"] = _g(row, "resumen") or _g(row, "closer_report") or "-"
    data["hubo_objeciones"] = _g(row, "hubo_objeciones") or "-"
    data["tipo_perfil"] = _g(row, "tipo_perfil") or "-"
    data["ingresos_estimados"] = _g(row, "ingresos_estimados") or "-"
    data["situacion_y_deseo"] = _g(row, "situacion_y_deseo") or "-"
    data["has_new"] = "1" if any(_g(row, k) for k, _ in _NEW_FIELDS) else ""
    return data


def build_call_reports_pdf(reports: list[dict[str, str]]) -> bytes:
    from fpdf import FPDF

    class _AtvCallReportPDF(FPDF):
        def header(self) -> None:
            # Barra superior marca ATV
            self.set_fill_color(*_ATV_RED)
            self.rect(0, 0, self.w, 18, "F")
            self.set_fill_color(*_ATV_RED_DARK)
            self.rect(0, 18, self.w, 1.2, "F")

            x0 = self.l_margin
            if _LOGO_PATH.is_file():
                try:
                    self.image(str(_LOGO_PATH), x=x0, y=3.5, h=11)
                    x0 = x0 + 16
                except Exception:
                    pass

            self.set_xy(x0, 5)
            self.set_text_color(255, 255, 255)
            self.set_font("Helvetica", "B", 13)
            self.cell(0, 6, _pdf_safe("ATV Soft"), new_x="LMARGIN", new_y="NEXT")
            self.set_x(x0)
            self.set_font("Helvetica", "", 8)
            self.cell(0, 4, _pdf_safe("Reporte de llamadas"), new_x="LMARGIN", new_y="NEXT")
            self.set_text_color(*_INK)
            self.set_y(24)

        def footer(self) -> None:
            self.set_y(-12)
            self.set_draw_color(*_LINE)
            self.set_line_width(0.2)
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

    pdf = _AtvCallReportPDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(14, 14, 14)
    pdf.add_page()

    # Meta
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*_MUTED)
    pdf.cell(
        0,
        5,
        _pdf_safe(
            f"Generado: {datetime.utcnow().strftime('%d-%m-%Y %H:%M')} UTC  |  "
            f"Total: {len(reports)} reporte(s)"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(*_INK)
    pdf.ln(3)

    def _section(title: str) -> None:
        pdf.ln(2)
        y = pdf.get_y()
        pdf.set_fill_color(*_SOFT_BG)
        pdf.rect(pdf.l_margin, y, pdf.epw, 7, "F")
        pdf.set_draw_color(*_ATV_RED)
        pdf.set_line_width(0.8)
        pdf.line(pdf.l_margin, y, pdf.l_margin, y + 7)
        pdf.set_xy(pdf.l_margin + 3, y + 1.2)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*_ATV_RED_DARK)
        pdf.cell(0, 5, _pdf_safe(title.upper()), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(*_INK)
        pdf.ln(1.5)

    def _meta_row(label: str, value: str) -> None:
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*_MUTED)
        pdf.cell(42, 5, _pdf_safe(label))
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*_INK)
        pdf.multi_cell(0, 5, _pdf_safe(value))
        pdf.set_x(pdf.l_margin)

    def _field(label: str, value: str) -> None:
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*_ATV_RED)
        pdf.multi_cell(0, 4.5, _pdf_safe(label))
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*_INK)
        pdf.multi_cell(0, 4.8, _pdf_safe(value))
        pdf.set_x(pdf.l_margin)
        pdf.ln(1.5)

    for i, r in enumerate(reports, start=1):
        if i > 1:
            pdf.add_page()

        # Título del reporte
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(*_INK)
        pdf.multi_cell(0, 6, _pdf_safe(f"Reporte #{i}  ·  {r.get('lead') or 'Sin nombre'}"))
        pdf.set_x(pdf.l_margin)
        pdf.set_draw_color(*_ATV_RED)
        pdf.set_line_width(0.6)
        y = pdf.get_y()
        pdf.line(pdf.l_margin, y, pdf.l_margin + 36, y)
        pdf.ln(4)

        _section("Datos de la llamada")
        _meta_row("Fecha", r.get("fecha") or "-")
        _meta_row("Lead", r.get("lead") or "-")
        _meta_row("Link", r.get("link") or "-")
        _meta_row("Participantes", r.get("participantes") or "-")
        _meta_row("Motivo", r.get("motivo") or "-")

        if r.get("has_new"):
            _section("Calificacion del lead")
            for key, label in _NEW_FIELDS[:5]:
                _field(label, r.get(key) or "-")
            _section("Coaching de la llamada")
            for key, label in _NEW_FIELDS[5:8]:
                _field(label, r.get(key) or "-")
            _section("Trazabilidad y mejora")
            for key, label in _NEW_FIELDS[8:]:
                _field(label, r.get(key) or "-")
        else:
            _section("Analisis (formato anterior)")
            _field("Resumen de la reunion", r.get("resumen") or "-")
            _field("Hubo objeciones?", r.get("hubo_objeciones") or "-")
            _field("Tipo de perfil", r.get("tipo_perfil") or "-")
            _field("Ingresos estimados", r.get("ingresos_estimados") or "-")
            _field("Situacion y deseo", r.get("situacion_y_deseo") or "-")

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1", errors="replace")
