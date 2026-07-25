"""Generación de PDF para el listado de reportes de equipo (setter + closer).

El paquete pip se llama `fpdf2` (`pip install fpdf2`); el import en código es `from fpdf import FPDF`.
Se importa de forma perezosa para que la app arranque aunque aún no esté instalado.
"""

from __future__ import annotations

import unicodedata
from typing import Any


def fecha_iso_a_dd_mm_yyyy(iso: str) -> str:
    """Convierte YYYY-MM-DD a dd-mm-aaaa (UI / PDF / nombres de archivo)."""
    s = str(iso).strip()
    parts = s.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        y, mo, d = parts
        if len(y) == 4 and len(mo) == 2 and len(d) == 2:
            return f"{d}-{mo}-{y}"
    return s


def _pdf_line(s: str, max_len: int = 8000) -> str:
    if not s:
        return ""
    t = s.strip()
    if len(t) > max_len:
        t = t[: max_len - 3] + "..."
    nfkd = unicodedata.normalize("NFKD", t)
    return "".join(c for c in nfkd if ord(c) < 128 or c in "\n\t ")


def _emit(pdf: Any, label: str, val: Any) -> None:
    if val is None:
        return
    if isinstance(val, str) and not val.strip():
        return
    s = f"  {label}: {val}"
    # Tras multi_cell, fpdf2 deja X al margen derecho; sin esto el siguiente multi_cell falla
    # ("Not enough horizontal space to render a single character").
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 4, _pdf_line(s))
    pdf.set_x(pdf.l_margin)


def build_team_reports_pdf(reports: list[dict]) -> bytes:
    from fpdf import FPDF

    class _TeamReportsPDF(FPDF):
        def __init__(self) -> None:
            super().__init__(orientation="P", unit="mm", format="A4")
            self.set_auto_page_break(auto=True, margin=14)
            self.set_margins(12, 12, 12)

    pdf = _TeamReportsPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _pdf_line("Reportes de equipo (setter, closer y seguimiento)"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(0, 5, _pdf_line(f"Total de registros: {len(reports)}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    for i, row in enumerate(reports):
        if pdf.get_y() > 270:
            pdf.add_page()
        kind = str(row.get("kind", ""))
        fecha = fecha_iso_a_dd_mm_yyyy(str(row.get("fecha", "")))
        member = str(row.get("member_nombre", ""))
        pdf.set_font("Helvetica", "B", 10)
        title = f"#{i + 1}  {fecha}  |  {kind.upper()}  |  {member}"
        pdf.multi_cell(0, 5, _pdf_line(title))
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "", 8)

        if kind == "setter":
            _emit(pdf, "Conversaciones", row.get("conversaciones"))
            _emit(pdf, "Agendas", row.get("agendas"))
            _emit(pdf, "Calendlys enviados", row.get("links_enviados"))
            _emit(pdf, "Leads nuevos", row.get("leads_nuevos"))
            _emit(pdf, "Seguimientos", row.get("seguimientos"))
            _emit(pdf, "Outbounds", row.get("outbounds"))
            _emit(pdf, "Notas", row.get("notas"))
            _emit(pdf, "Tipo de trafico", row.get("sentimiento_trafico"))
            _emit(pdf, "Avatar / agendas", row.get("avatar_tipo_agendas"))
            _emit(pdf, "Dia bueno o malo", row.get("dia_bueno_malo"))
            _emit(pdf, "Feedback a MKT", row.get("insights_marketing"))
        elif kind == "seguimiento":
            _emit(pdf, "Nombre lead", row.get("nombre_lead"))
            _emit(pdf, "Monto", row.get("monto"))
        elif kind == "closer":
            _emit(pdf, "Llamadas agendadas", row.get("llamadas_agendadas"))
            _emit(pdf, "Shows", row.get("shows"))
            _emit(pdf, "Cierres", row.get("cierres"))
            _emit(pdf, "Calificados", row.get("calificados"))
            _emit(pdf, "Descalificados", row.get("descalificados"))
            _emit(pdf, "Ingreso", row.get("ingreso"))
            _emit(pdf, "Notas", row.get("notas"))

        pdf.ln(3)
        pdf.set_draw_color(200, 200, 200)
        pdf.line(12, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)

    raw = pdf.output()
    if isinstance(raw, str):
        return raw.encode("latin-1", errors="replace")
    return bytes(raw)
