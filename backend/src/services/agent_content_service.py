"""Desempeño de contenido/marketing del mes para el agente externo."""

from __future__ import annotations

from typing import Any

from pony.orm import db_session

from src.controllers.bio_controller import _is_cerrado, _parse_month as bio_parse_month, _rows_for_user_month
from src.controllers.keywords_controller import (
    _build_reel_options,
    _norm_key,
    _reel_label_for_option,
    _staged_rows,
)
from src.controllers.youtube_controller import _aggregate_from_rows, _parse_month_query, _video_month_ar
from src.models import Lead, ReelContent, YoutubeContent
from src.services.agent_analytics_service import _lead_month_ar, _parse_month
from src.services.reels_services import ReelsServices
from src.services.stories_service import StoriesService


def _reel_pub_date_iso(row: ReelContent) -> str:
    pub = row.fecha_publicacion
    if pub is None:
        return ""
    if pub.tzinfo is not None:
        pub = pub.replace(tzinfo=None)
    return pub.date().isoformat()


def _reel_label(row: ReelContent) -> str:
    return _reel_label_for_option(row)


def _reels_block(user_id: int, month: str) -> dict[str, Any]:
    uid_str = str(user_id)
    svc = ReelsServices()
    metrics = svc.get_metrics(uid_str, month)
    month_key = _parse_month(month)

    with db_session:
        rows = [r for r in list(ReelContent.select()) if int(r.user_id) == user_id]

    mk_str = f"{month_key[0]:04d}-{month_key[1]:02d}"
    month_rows = [
        r
        for r in rows
        if r.fecha_publicacion is not None
        and (mk := svc._month_key_ar(r.fecha_publicacion)) is not None
        and mk == mk_str
    ]

    top_candidates: list[dict[str, Any]] = []
    for row in month_rows:
        resp = svc._to_response(row)
        final = svc._finalize_reel_response(user_id=uid_str, reel=resp, refresh=False)
        cash = float(final.cash_total or final.cash or 0)
        chats = int(final.chats or 0)
        top_candidates.append(
            {
                "label": _reel_label(row),
                "fecha": _reel_pub_date_iso(row),
                "plays": int(row.plays or 0),
                "reach": int(row.reach or 0),
                "chats": chats,
                "cash": round(cash, 2),
                "_sort_cash": cash,
                "_sort_chats": chats,
            }
        )

    top_candidates.sort(key=lambda x: (x["_sort_cash"], x["_sort_chats"]), reverse=True)
    top = [
        {k: v for k, v in item.items() if not k.startswith("_sort_")}
        for item in top_candidates[:5]
    ]

    return {
        "piezas_publicadas": int(metrics.get("piezas_publicadas") or 0),
        "chats_generados": int(metrics.get("chats_del_mes") or 0),
        "reels_con_cta": int(metrics.get("reels_con_cta") or 0),
        "reels_sin_cta": int(metrics.get("reels_sin_cta") or 0),
        "top": top,
    }


def _historias_block(user_id: int, month: str) -> dict[str, Any]:
    uid_str = str(user_id)
    stories_svc = StoriesService()
    metrics = stories_svc.get_metrics(uid_str, month)
    sequences = stories_svc.get_sequences(uid_str, month)

    cash_total = sum(int(seq.get("cash_generado") or 0) for seq in sequences)
    secuencias = len(sequences)

    return {
        "secuencias": secuencias,
        "chats_generados": int(metrics.get("chats_del_mes") or 0),
        "secuencias_con_cta": int(metrics.get("secuencias_con_cta") or 0),
        "cash": round(float(cash_total), 2),
    }


def _youtube_block(user_id: int, month: str) -> dict[str, Any]:
    month_key = _parse_month_query(month)
    with db_session:
        rows = [r for r in list(YoutubeContent.select()) if int(r.user_id) == user_id]

    filtered = [
        r
        for r in rows
        if (mb := _video_month_ar(r.published_at)) is not None and mb == month_key
    ]
    agg = _aggregate_from_rows(filtered)

    return {
        "videos": int(agg.get("video_count") or 0),
        "views": int(agg.get("total_views") or 0),
        "chats_generados": int(agg.get("total_chats") or 0),
        "cash": round(float(agg.get("total_cash") or 0), 2),
    }


def _bio_block(user_id: int, month: str) -> dict[str, Any]:
    month_key = bio_parse_month(month)
    rows = _rows_for_user_month(user_id, month_key)

    total = len(rows)
    agendaron = sum(1 for r in rows if r.agendo is not None)
    cerrados = sum(1 for r in rows if _is_cerrado(r))
    cash = sum(float(r.pago or 0) for r in rows)

    tasa_agenda = (agendaron / total * 100.0) if total else 0.0

    return {
        "total_leads": total,
        "agendaron": agendaron,
        "cerrados": cerrados,
        "tasa_agenda": round(tasa_agenda, 2),
        "tasa_conversion": round(tasa_agenda, 2),
        "cash": round(cash, 2),
    }


def _keywords_top_block(user_id: int, month: str) -> list[dict[str, Any]]:
    month_key = _parse_month(month)
    with db_session:
        reels = [r for r in list(ReelContent.select()) if int(r.user_id) == user_id]
        all_leads = [r for r in list(Lead.select()) if int(r.user_id) == user_id]

    leads = [
        r
        for r in all_leads
        if (mb := _lead_month_ar(r)) is not None and mb == month_key
    ]

    reel_opts = _build_reel_options(reels)
    label_by_id = {o.id: o.label for o in reel_opts}

    staged = _staged_rows(reels=reels, leads=leads, reel_filter_id=None)
    all_rows = [s[3] for s in staged]

    kw_leads: dict[str, set[str]] = {}
    kw_display: dict[str, str] = {}
    kw_reel_label: dict[str, str] = {}

    for row in all_rows:
        k = (row.keyword or "").strip()
        if not k:
            continue
        nk = _norm_key(k)
        kw_leads.setdefault(nk, set()).add(str(row.lead_id))
        kw_display.setdefault(nk, k)
        if nk not in kw_reel_label and row.reel_id:
            kw_reel_label[nk] = label_by_id.get(str(row.reel_id), f"REEL {row.reel_id}")

    ranked = sorted(kw_leads.items(), key=lambda x: len(x[1]), reverse=True)[:8]
    return [
        {
            "keyword": kw_display.get(nk, nk),
            "leads": len(lead_ids),
            "reel_label": kw_reel_label.get(nk, ""),
        }
        for nk, lead_ids in ranked
    ]


def build_contenido(user_id: int, month: str) -> dict[str, Any]:
    ym = month.strip()
    return {
        "month": ym,
        "reels": _reels_block(user_id, ym),
        "historias": _historias_block(user_id, ym),
        "youtube": _youtube_block(user_id, ym),
        "bio": _bio_block(user_id, ym),
        "keywords_top": _keywords_top_block(user_id, ym),
    }
