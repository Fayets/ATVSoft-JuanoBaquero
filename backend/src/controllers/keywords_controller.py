"""Vista Keyword: leads con nombre, IG, reel vinculado por keyword y la keyword."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session

from src.lead_display_utils import lead_display_nombre
from src.models import Lead as LeadEntity
from src.models import ReelContent
from src.schemas import (
    KeywordClientRow,
    KeywordsListResponse,
    KeywordsMetrics,
    KeywordsMetricsResponse,
    KeywordsReelOption,
    KeywordsSeriesDay,
    KeywordsTopKeyword,
    KeywordsTopReel,
)

router = APIRouter(prefix="/api/keywords", tags=["keywords"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _norm_key(s: str) -> str:
    return s.strip().lower()


def _lead_tokens(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def _reel_published_date_iso(matched: ReelContent | None) -> str | None:
    if matched is None or matched.fecha_publicacion is None:
        return None
    d = matched.fecha_publicacion
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    return d.date().isoformat()


def _lead_sort_ts(lead: LeadEntity) -> float:
    c = lead.created_at
    if c is None:
        return 0.0
    if c.tzinfo is not None:
        c = c.replace(tzinfo=None)
    return float(c.timestamp())


def _reel_sort_ts(r: ReelContent) -> float:
    d = r.fecha_publicacion
    if d is None:
        return 0.0
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    return float(d.timestamp())


def _reel_label_for_option(r: ReelContent) -> str:
    pub_iso = _reel_published_date_iso(r)
    label = "REEL"
    if pub_iso:
        parts = pub_iso.split("-", 2)
        if len(parts) == 3:
            y, m, d = parts
            label = f"REEL {d}/{m}/{y}"
        else:
            label = f"REEL {pub_iso}"
    kw = (r.keyword or "").strip()
    if kw:
        label = f"{label} — {kw}"
    return label


def _build_reel_options(reels: list[ReelContent]) -> list[KeywordsReelOption]:
    reels_with_kw = [r for r in reels if (r.keyword or "").strip()]
    reels_with_kw.sort(key=lambda r: _reel_sort_ts(r), reverse=True)
    return [KeywordsReelOption(id=str(r.id), label=_reel_label_for_option(r)) for r in reels_with_kw]


def _staged_rows(
    *,
    reels: list[ReelContent],
    leads: list[LeadEntity],
    reel_filter_id: str | None,
) -> list[tuple[float, int, str, KeywordClientRow]]:
    reel_by_kw: dict[str, ReelContent] = {}
    for reel in reels:
        kw = (reel.keyword or "").strip()
        if not kw:
            continue
        k = _norm_key(kw)
        if k not in reel_by_kw:
            reel_by_kw[k] = reel

    staged: list[tuple[float, int, str, KeywordClientRow]] = []
    for lead in leads:
        tokens = _lead_tokens(lead.keyword)
        if not tokens:
            continue
        ts = _lead_sort_ts(lead)
        lid = int(lead.id)
        for tok in tokens:
            k = _norm_key(tok)
            matched = reel_by_kw.get(k)
            if reel_filter_id is not None:
                if matched is None or str(matched.id) != reel_filter_id:
                    continue
            permalink = None
            pub_iso: str | None = None
            if matched is not None:
                p = (matched.permalink or "").strip()
                permalink = p or None
                pub_iso = _reel_published_date_iso(matched)
            staged.append(
                (
                    -ts,
                    lid,
                    tok.lower(),
                    KeywordClientRow(
                        lead_id=str(lead.id),
                        nombre=lead_display_nombre(lead.nombre, lead.ig),
                        instagram=(lead.ig or "").strip(),
                        reel_id=str(matched.id) if matched is not None else None,
                        reel_permalink=permalink,
                        reel_published_at=pub_iso,
                        keyword=tok,
                    ),
                )
            )

    staged.sort(key=lambda x: (x[0], x[1], x[2]))
    return staged


@router.get("", response_model=KeywordsListResponse)
def list_keywords(
    user_id: Annotated[str, Depends(require_user_id)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    reel_id: str | None = Query(default=None, description="Filtrar por reel (ID interno en BD)."),
    q: str | None = Query(default=None, description="Búsqueda global (nombre, IG, reel, keyword)."),
) -> KeywordsListResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    with db_session:
        reels = [r for r in list(ReelContent.select()) if int(r.user_id) == uid]
        leads = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]

    reel_opts = _build_reel_options(reels)

    reel_filter_id = reel_id.strip() if reel_id and reel_id.strip() else None
    staged = _staged_rows(reels=reels, leads=leads, reel_filter_id=reel_filter_id)
    all_rows = [s[3] for s in staged]

    # Búsqueda global antes de paginar.
    q_norm = (q or "").strip().lower()
    if q_norm:
        def _matches(row: KeywordClientRow) -> bool:
            reel_bit = ""
            if row.reel_published_at:
                reel_bit += f" {row.reel_published_at}"
            if row.reel_id:
                reel_bit += f" {row.reel_id}"
            blob = f"{row.nombre} {row.instagram} {reel_bit} {row.keyword}".lower()
            return q_norm in blob

        all_rows = [r for r in all_rows if _matches(r)]

    total = len(all_rows)

    unique_leads = len({r.lead_id for r in all_rows})
    unique_keywords = len({_norm_key(r.keyword) for r in all_rows if r.keyword and str(r.keyword).strip()})
    rows_with_reel = sum(1 for r in all_rows if r.reel_id is not None and str(r.reel_id).strip())
    unique_reels = len({str(r.reel_id) for r in all_rows if r.reel_id is not None and str(r.reel_id).strip()})

    start = (page - 1) * page_size
    end = start + page_size
    rows = all_rows[start:end]
    return KeywordsListResponse(
        rows=rows,
        total=total,
        reels=reel_opts,
        metrics=KeywordsMetrics(
            total_rows=total,
            unique_leads=unique_leads,
            unique_keywords=unique_keywords,
            rows_with_reel=rows_with_reel,
            unique_reels=unique_reels,
        ),
    )


@router.get("/metrics", response_model=KeywordsMetricsResponse)
def keywords_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    reel_id: str | None = Query(default=None, description="Filtrar por reel (ID interno en BD)."),
    days: int = Query(default=30, ge=7, le=180, description="Ventana de días para serie temporal."),
) -> KeywordsMetricsResponse:
    try:
        uid = int(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="user_id inválido") from e

    with db_session:
        reels = [r for r in list(ReelContent.select()) if int(r.user_id) == uid]
        leads = [r for r in list(LeadEntity.select()) if int(r.user_id) == uid]

    reel_opts = _build_reel_options(reels)
    reel_filter_id = reel_id.strip() if reel_id and reel_id.strip() else None
    staged = _staged_rows(reels=reels, leads=leads, reel_filter_id=reel_filter_id)
    all_rows = [s[3] for s in staged]

    unique_leads = len({r.lead_id for r in all_rows})
    unique_keywords = len({_norm_key(r.keyword) for r in all_rows if r.keyword and str(r.keyword).strip()})
    rows_with_reel = sum(1 for r in all_rows if r.reel_id is not None and str(r.reel_id).strip())
    unique_reels = len({str(r.reel_id) for r in all_rows if r.reel_id is not None and str(r.reel_id).strip()})

    from datetime import datetime, timedelta

    today = datetime.utcnow().date()
    start_day = today - timedelta(days=max(1, int(days)) - 1)
    day_keys = [(start_day + timedelta(days=i)).isoformat() for i in range((today - start_day).days + 1)]
    rows_by_day: dict[str, int] = {d: 0 for d in day_keys}
    leads_by_day: dict[str, set[str]] = {d: set() for d in day_keys}

    lead_created_by_id: dict[str, str] = {}
    for lead in leads:
        lid = str(lead.id)
        c = lead.created_at
        if c is None:
            continue
        if c.tzinfo is not None:
            c = c.replace(tzinfo=None)
        lead_created_by_id[lid] = c.date().isoformat()

    for r in all_rows:
        d = lead_created_by_id.get(str(r.lead_id))
        if not d or d not in rows_by_day:
            continue
        rows_by_day[d] += 1
        leads_by_day[d].add(str(r.lead_id))

    series_days = [KeywordsSeriesDay(day=d, rows=int(rows_by_day[d]), leads=len(leads_by_day[d])) for d in day_keys]

    kw_rows: dict[str, int] = {}
    kw_leads: dict[str, set[str]] = {}
    for r in all_rows:
        k = (r.keyword or "").strip()
        if not k:
            continue
        nk = _norm_key(k)
        kw_rows[nk] = kw_rows.get(nk, 0) + 1
        kw_leads.setdefault(nk, set()).add(str(r.lead_id))
    top_keywords = sorted(kw_rows.items(), key=lambda x: x[1], reverse=True)[:20]
    top_keywords_out = [
        KeywordsTopKeyword(keyword=k, rows=int(cnt), leads=len(kw_leads.get(k, set()))) for k, cnt in top_keywords
    ]

    reel_rows: dict[str, int] = {}
    reel_label_by_id: dict[str, str] = {o.id: o.label for o in reel_opts}
    for r in all_rows:
        rid = str(r.reel_id) if r.reel_id is not None else ""
        if not rid:
            continue
        reel_rows[rid] = reel_rows.get(rid, 0) + 1
    top_reels = sorted(reel_rows.items(), key=lambda x: x[1], reverse=True)[:12]
    top_reels_out = [
        KeywordsTopReel(reel_id=rid, label=reel_label_by_id.get(rid, f"REEL {rid}"), rows=int(cnt))
        for rid, cnt in top_reels
    ]

    return KeywordsMetricsResponse(
        metrics=KeywordsMetrics(
            total_rows=len(all_rows),
            unique_leads=unique_leads,
            unique_keywords=unique_keywords,
            rows_with_reel=rows_with_reel,
            unique_reels=unique_reels,
        ),
        series_days=series_days,
        top_keywords=top_keywords_out,
        top_reels=top_reels_out,
        reels=reel_opts,
    )
