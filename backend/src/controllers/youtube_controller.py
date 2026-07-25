"""YouTube: sync vía Data API v3 y listados por mes (mes calendario AR, como leads)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import ObjectNotFound, db_session

from src.db import db
from src.schemas import YoutubeVideoPatchRequest
from src.models import ApiConnection, Lead, YoutubeContent

router = APIRouter(prefix="/api/youtube", tags=["youtube"], redirect_slashes=False)

_AR = ZoneInfo("America/Argentina/Buenos_Aires")
_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
_DURATION_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _uid_int(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.")


def parse_iso8601_duration(s: str | None) -> int | None:
    if not s or not str(s).strip():
        return None
    m = _DURATION_RE.fullmatch(str(s).strip())
    if not m:
        return None
    h, mi, se = m.groups()
    total = 0
    if h:
        total += int(h) * 3600
    if mi:
        total += int(mi) * 60
    if se:
        total += int(se)
    return total


def _published_naive_utc(iso: str | None) -> datetime | None:
    if not iso:
        return None
    s = iso.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        return None


def _video_month_ar(published_at: datetime | None) -> tuple[int, int] | None:
    if published_at is None:
        return None
    dt = published_at
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    d_utc = dt.replace(tzinfo=timezone.utc)
    d_ar = d_utc.astimezone(_AR)
    return (d_ar.year, d_ar.month)


def _parse_month_query(month: str) -> tuple[int, int]:
    parts = str(month).strip().split("-", 1)
    if len(parts) != 2:
        raise ValueError("month")
    y, m = int(parts[0]), int(parts[1])
    if m < 1 or m > 12:
        raise ValueError("month")
    return y, m


def _parse_months_csv(months_csv: str) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    for part in str(months_csv).strip().split(","):
        p = part.strip()
        if not p:
            continue
        try:
            out.add(_parse_month_query(p))
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"months inválido (YYYY-MM separados por coma). Fragmento: {p!r}",
            ) from e
    if not out:
        raise HTTPException(status_code=400, detail="months vacío o inválido.")
    return out


def _append_perf(history: Any, views: int, likes: int, comments: int) -> list:
    if not isinstance(history, list):
        history = []
    today = datetime.utcnow().strftime("%Y-%m-%d")
    snap = {"date": f"{today}T00:00:00", "views": views, "likes": likes, "comments": comments}
    out = [x for x in history if isinstance(x, dict) and not str(x.get("date", "")).startswith(today)]
    out.append(snap)
    return out[-120:]


def _pick_thumbnail(snippet: dict) -> str | None:
    thumbs = (snippet or {}).get("thumbnails") or {}
    for key in ("maxres", "high", "medium", "standard", "default"):
        u = (thumbs.get(key) or {}).get("url")
        if u:
            return str(u)
    return None


def _stat_int(stats: dict, key: str) -> int:
    raw = (stats or {}).get(key)
    if raw is None or raw == "":
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _count_agendas_for_youtube_video(user_id: int, video_db_id: int) -> int:
    """Leads con punto_agenda = youtube:<id de fila YoutubeContent>."""
    tid = f"youtube:{video_db_id}"
    tbl = Lead._table_ or "lead"
    sql = f"""COUNT(*) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $tid"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "tid": tid})
    return int(rows[0]) if rows else 0


def _sum_pago_agenda_for_youtube(user_id: int, video_db_id: int) -> float:
    """Suma `pago` de leads con punto_agenda = youtube:<id de fila YoutubeContent>."""
    tid = f"youtube:{video_db_id}"
    tbl = Lead._table_ or "lead"
    sql = f"""coalesce(sum(coalesce(l.pago, 0)), 0) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $tid"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "tid": tid})
    if not rows:
        return 0.0
    v = rows[0]
    return float(v) if v is not None else 0.0


def _cash_parts_for_youtube_row(
    row: YoutubeContent,
    *,
    user_id: int,
    skip_agg: bool = False,
) -> tuple[float, float, float, int]:
    """(cash_manual, cash_leads, cash_total, agendas)."""
    vid = int(row.id)
    cash_manual_f = float(row.cash or 0)
    if skip_agg:
        return cash_manual_f, 0.0, cash_manual_f, 0
    cash_leads_f = _sum_pago_agenda_for_youtube(user_id, vid)
    agendas_n = _count_agendas_for_youtube_video(user_id, vid)
    cash_total_f = cash_manual_f + cash_leads_f
    return cash_manual_f, cash_leads_f, cash_total_f, agendas_n


def _row_to_video(row: YoutubeContent, *, user_id: int, skip_agg: bool = False) -> dict:
    ph = row.performance_history if isinstance(row.performance_history, list) else []
    cls = dict(row.classification) if isinstance(row.classification, dict) else {}
    raw_desc = (row.description or "").strip()
    if raw_desc and not (cls.get("description") or "").strip():
        cls["description"] = raw_desc
    pub = row.published_at
    published_iso = pub.isoformat() if pub is not None else None
    cash_manual_f, cash_leads_f, cash_total_f, agendas_n = _cash_parts_for_youtube_row(
        row, user_id=user_id, skip_agg=skip_agg
    )
    cash_manual_i = int(round(cash_manual_f))
    cash_leads_i = int(round(cash_leads_f))
    cash_total_i = int(round(cash_total_f))
    cpc = (cash_total_f / agendas_n) if agendas_n > 0 else 0.0
    return {
        "id": str(row.id),
        "title": row.title,
        "metrics": {
            "thumbnail": row.thumbnail_url,
            "views": row.views,
            "likes": row.likes,
            "comments": row.comments_count,
            "ctr": row.ctr,
            "retention": row.retention,
            "impressions": row.impressions,
            "avgViewDuration": row.avg_view_duration_seconds,
            "performanceHistory": ph,
        },
        "classification": cls,
        "cash": float(cash_total_i),
        "cash_manual": cash_manual_i,
        "cash_leads": cash_leads_i,
        "cash_total": cash_total_i,
        "cpc": cpc,
        "chats": int(row.chats or 0),
        "published_at": published_iso,
        "url": row.url,
        "notes": (row.notes or "").strip() or None,
        "external_id": row.external_id,
        "agendas": agendas_n,
    }


def _aggregate_from_rows(
    video_rows: list[YoutubeContent],
    *,
    user_id: int,
    skip_agg: bool = False,
) -> dict[str, Any]:
    n = len(video_rows)
    if n == 0:
        return {
            "video_count": 0,
            "total_views": 0,
            "total_likes": 0,
            "total_comments": 0,
            "total_cash": 0.0,
            "total_chats": 0,
            "avg_views": 0.0,
            "avg_ctr": 0.0,
        }
    total_views = sum(int(r.views or 0) for r in video_rows)
    total_likes = sum(int(r.likes or 0) for r in video_rows)
    total_comments = sum(int(r.comments_count or 0) for r in video_rows)
    total_cash = sum(
        _cash_parts_for_youtube_row(r, user_id=user_id, skip_agg=skip_agg)[2]
        for r in video_rows
    )
    total_chats = sum(int(r.chats or 0) for r in video_rows)
    ctr_vals = [float(r.ctr) for r in video_rows if r.ctr is not None and float(r.ctr) > 0]
    avg_ctr = sum(ctr_vals) / len(ctr_vals) if ctr_vals else 0.0
    return {
        "video_count": n,
        "total_views": total_views,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_cash": total_cash,
        "total_chats": total_chats,
        "avg_views": (total_views / n) if n else 0.0,
        "avg_ctr": avg_ctr,
    }


@router.post("/sync")
def sync_youtube(user_id: Annotated[str, Depends(require_user_id)]) -> dict[str, Any]:
    uid = _uid_int(user_id)
    with db_session:
        try:
            conn = ApiConnection.get(user_id=uid, platform="youtube")
        except ObjectNotFound:
            raise HTTPException(
                status_code=400,
                detail='No hay conexión YouTube. Configurá la plataforma "youtube" en Conexiones API.',
            )
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        api_key = (creds.get("api_key") or creds.get("apiKey") or "").strip()
        channel_id = (creds.get("channel_id") or creds.get("channelId") or "").strip()
        if not api_key or not channel_id:
            raise HTTPException(
                status_code=400,
                detail="Faltan api_key o channel_id en las credenciales de YouTube.",
            )

    params_search = {
        "part": "snippet",
        "channelId": channel_id,
        "maxResults": 50,
        "order": "date",
        "type": "video",
        "key": api_key,
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            r = client.get(_SEARCH_URL, params=params_search)
            r.raise_for_status()
            search_data = r.json()
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text[:500]
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"YouTube search error: {e.response.status_code} {detail}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar a YouTube: {e!s}")

    items = search_data.get("items") or []
    video_ids: list[str] = []
    for it in items:
        vid = ((it.get("id") or {}).get("videoId")) or ""
        if vid:
            video_ids.append(vid)
    if not video_ids:
        with db_session:
            c = ApiConnection.get(user_id=uid, platform="youtube")
            c.last_sync_at = datetime.utcnow()
            c.updated_at = datetime.utcnow()
        return {"total": 0, "new": 0, "updated": 0, "months": []}

    params_videos = {
        "part": "snippet,statistics,contentDetails",
        "id": ",".join(video_ids[:50]),
        "key": api_key,
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            r2 = client.get(_VIDEOS_URL, params=params_videos)
            r2.raise_for_status()
            videos_data = r2.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"YouTube videos error: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar a YouTube: {e!s}")

    vitems = videos_data.get("items") or []
    total = len(vitems)
    new_c = 0
    updated_c = 0
    now = datetime.utcnow()
    months_in_batch: set[str] = set()

    with db_session:
        # Python 3.13: no usar `select(lambda …)` / `select(r for …)` — el decompilador de Pony falla.
        by_eid = {r.external_id: r for r in list(YoutubeContent.select()) if r.user_id == uid}
        for it in vitems:
            eid = it.get("id") or ""
            if not eid:
                continue
            snippet = it.get("snippet") or {}
            stats = it.get("statistics") or {}
            details = it.get("contentDetails") or {}
            title = (snippet.get("title") or "") or None
            description = snippet.get("description") or ""
            thumb = _pick_thumbnail(snippet)
            published_at = _published_naive_utc(snippet.get("publishedAt"))
            mb_pub = _video_month_ar(published_at)
            if mb_pub:
                months_in_batch.add(f"{mb_pub[0]}-{mb_pub[1]:02d}")
            duration_s = parse_iso8601_duration(details.get("duration"))
            views = _stat_int(stats, "viewCount")
            likes = _stat_int(stats, "likeCount")
            comments = _stat_int(stats, "commentCount")
            url = f"https://www.youtube.com/watch?v={eid}"

            row = by_eid.get(eid)
            if row is not None:
                prior = row.performance_history
                if not isinstance(prior, list):
                    prior = []
                hist = _append_perf(prior, views, likes, comments)
                row.title = title
                row.description = description or ""
                row.thumbnail_url = thumb
                row.published_at = published_at
                row.url = url
                row.duration_seconds = duration_s
                row.views = views
                row.likes = likes
                row.comments_count = comments
                row.performance_history = hist
                row.updated_at = now
                updated_c += 1
            else:
                hist = _append_perf([], views, likes, comments)
                row = YoutubeContent(
                    user_id=uid,
                    external_id=eid,
                    title=title,
                    description=description or "",
                    thumbnail_url=thumb,
                    published_at=published_at,
                    url=url,
                    duration_seconds=duration_s,
                    views=views,
                    likes=likes,
                    comments_count=comments,
                    performance_history=hist,
                )
                by_eid[eid] = row
                new_c += 1

        try:
            c = ApiConnection.get(user_id=uid, platform="youtube")
            c.last_sync_at = now
            c.updated_at = now
        except ObjectNotFound:
            pass

    months_list = sorted(months_in_batch, reverse=True)
    return {"total": total, "new": new_c, "updated": updated_c, "months": months_list}


@router.get("/videos")
def list_youtube_videos(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(
        default=None,
        description="YYYY-MM (mes Argentina según published_at). Omitir = todos los videos.",
    ),
    months: str | None = Query(
        default=None,
        description="Varios YYYY-MM separados por coma (unión de meses).",
    ),
    page: int = Query(default=1, ge=1, description="Página (1-based)."),
    page_size: int = Query(default=12, ge=1, le=50, description="Videos por página."),
    skip_agg: bool = Query(
        default=False,
        description="Si true, no cuenta agendas por video (listados rápidos / pickers).",
    ),
) -> dict[str, Any]:
    uid = _uid_int(user_id)
    filter_set: set[tuple[int, int]] | None = None
    scope = "all"
    if months and str(months).strip():
        filter_set = _parse_months_csv(months)
        scope = "months"
    elif month and str(month).strip():
        try:
            filter_set = {_parse_month_query(month.strip())}
        except ValueError:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
        scope = "month"

    with db_session:
        rows = [r for r in list(YoutubeContent.select()) if r.user_id == uid]

    avail: set[str] = set()
    for row in rows:
        mb = _video_month_ar(row.published_at)
        if mb:
            avail.add(f"{mb[0]}-{mb[1]:02d}")
    available_months = sorted(avail, reverse=True)

    filtered_rows: list[YoutubeContent] = []
    for row in rows:
        mb = _video_month_ar(row.published_at)
        if filter_set is not None:
            if mb is None or mb not in filter_set:
                continue
        filtered_rows.append(row)
    def _row_pub_sort(r: YoutubeContent) -> str:
        p = r.published_at
        return p.isoformat() if p is not None else ""

    filtered_rows.sort(key=_row_pub_sort, reverse=True)

    aggregates = _aggregate_from_rows(filtered_rows, user_id=uid, skip_agg=skip_agg)
    total_count = len(filtered_rows)
    total_pages = (total_count + page_size - 1) // page_size if total_count else 0
    page_eff = page
    if total_pages > 0 and page_eff > total_pages:
        page_eff = total_pages
    start = (page_eff - 1) * page_size
    page_rows = filtered_rows[start : start + page_size]
    page_videos = [
        _row_to_video(r, user_id=uid, skip_agg=skip_agg) for r in page_rows
    ]

    return {
        "scope": scope,
        "month": month.strip() if month and str(month).strip() else None,
        "months": months.strip() if months and str(months).strip() else None,
        "videos": page_videos,
        "total": total_count,
        "page": page_eff,
        "page_size": page_size,
        "total_pages": total_pages,
        "aggregates": aggregates,
        "available_months": available_months,
    }


@router.get("/metrics")
def youtube_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str | None = Query(default=None, description="YYYY-MM"),
    months: str | None = Query(default=None, description="CSV YYYY-MM"),
) -> dict[str, Any]:
    uid = _uid_int(user_id)
    filter_set: set[tuple[int, int]] | None = None
    scope = "all"
    if months and str(months).strip():
        filter_set = _parse_months_csv(months)
        scope = "months"
    elif month and str(month).strip():
        try:
            filter_set = {_parse_month_query(month.strip())}
        except ValueError:
            raise HTTPException(status_code=400, detail="Parámetro month inválido (usar YYYY-MM).")
        scope = "month"

    with db_session:
        rows = [r for r in list(YoutubeContent.select()) if r.user_id == uid]

    month_rows: list[YoutubeContent] = []
    for r in rows:
        if filter_set is None:
            month_rows.append(r)
            continue
        mb = _video_month_ar(r.published_at)
        if mb is not None and mb in filter_set:
            month_rows.append(r)
    n = len(month_rows)
    total_views = sum(int(r.views or 0) for r in month_rows)
    total_likes = sum(int(r.likes or 0) for r in month_rows)
    total_comments = sum(int(r.comments_count or 0) for r in month_rows)
    total_cash = sum(_cash_parts_for_youtube_row(r, user_id=uid, skip_agg=False)[2] for r in month_rows)
    total_chats = sum(int(r.chats or 0) for r in month_rows)
    ctr_vals = [float(r.ctr) for r in month_rows if r.ctr is not None and float(r.ctr) > 0]
    avg_ctr = sum(ctr_vals) / len(ctr_vals) if ctr_vals else 0.0
    return {
        "scope": scope,
        "month": month.strip() if month and str(month).strip() else None,
        "months": months.strip() if months and str(months).strip() else None,
        "video_count": n,
        "total_views": total_views,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_cash": total_cash,
        "total_chats": total_chats,
        "avg_views": (total_views / n) if n else 0.0,
        "avg_ctr": avg_ctr,
    }


@router.patch("/videos/{video_id}")
def patch_youtube_video(
    video_id: int,
    body: YoutubeVideoPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, Any]:
    uid = _uid_int(user_id)
    payload: dict[str, Any] = (
        body.model_dump(exclude_unset=True)
        if hasattr(body, "model_dump")
        else body.dict(exclude_unset=True)
    )
    if not payload:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
    now = datetime.utcnow()
    with db_session:
        try:
            row = YoutubeContent.get(id=video_id, user_id=uid)
        except ObjectNotFound:
            raise HTTPException(status_code=404, detail="Video no encontrado.")
        if "cash_manual" in payload and payload["cash_manual"] is not None:
            row.cash = float(max(0, int(payload["cash_manual"])))
        row.updated_at = now
        return _row_to_video(row, user_id=uid, skip_agg=False)
