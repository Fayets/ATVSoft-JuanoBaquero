import asyncio
import json
import ssl
import threading
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, time as dt_time, timezone
from zoneinfo import ZoneInfo

import certifi
from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session, rollback

from src.db import db
from src.models import ApiConnection, Lead, ReelContent
from src.schemas import ReelKeywordPatchRequest, ReelPatchRequest, ReelResponse, ReelsListResponse

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
_sync_lock = threading.Lock()
_sync_states: dict[str, dict[str, int | str]] = {}
_sync_tasks: dict[str, asyncio.Task] = {}
_refresh_metrics_tasks: dict[str, asyncio.Task] = {}
_range_preview_lock = threading.Lock()
_range_preview_media: dict[str, list[dict]] = {}
QUICK_REELS_SYNC_LIMIT = 10

# Opciones de lista maestra que significan "sin CTA" (no cuentan en reels_con_cta).
_CTA_NEGATIVE_FOR_METRICS = frozenset(
    {
        "no",
        "ninguno",
        "ninguna",
        "sin cta",
        "sin_cta",
        "sin-cta",
        "n/a",
        "na",
        "none",
        "false",
        "0",
        "-",
    }
)


def _cta_counts_as_reel_con_cta(cta: str | None) -> bool:
    """True si el reel debe figurar en métricas como 'con CTA' (tiene CTA real o 'Sí')."""
    s = (cta or "").strip().casefold().rstrip(".!¡?")
    if not s:
        return False
    s = (
        s.replace("í", "i")
        .replace("á", "a")
        .replace("é", "e")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    return s not in _CTA_NEGATIVE_FOR_METRICS


class ReelsServices:
    @staticmethod
    def _normalize_graph_timestamp_string(ts: str) -> str:
        """Graph API suele enviar offset como +0000; fromisoformat requiere +00:00."""
        s = ts.strip().replace("Z", "+00:00")
        if re.search(r"[+-]\d{4}$", s) and not re.search(r"[+-]\d{2}:\d{2}$", s):
            return s[:-2] + ":" + s[-2:]
        return s

    @classmethod
    def _parse_graph_timestamp(cls, ts: str) -> datetime:
        s = cls._normalize_graph_timestamp_string(ts)
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    @staticmethod
    def _as_utc(dt: datetime) -> datetime:
        """Naive desde BD se interpreta como UTC (timestamptz de Postgres)."""
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    @classmethod
    def _month_key_ar(cls, dt: datetime | None) -> str | None:
        if dt is None:
            return None
        return cls._as_utc(dt).astimezone(AR_TZ).strftime("%Y-%m")

    def _store_publication_utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=AR_TZ)
        return value.astimezone(timezone.utc)

    def _is_user_sync_running(self, user_id: str) -> bool:
        task = _sync_tasks.get(user_id)
        return task is not None and not task.done()

    def _is_user_refresh_metrics_running(self, user_id: str) -> bool:
        task = _refresh_metrics_tasks.get(user_id)
        return task is not None and not task.done()

    def trigger_sync(self, user_id: str) -> None:
        if self._is_user_refresh_metrics_running(user_id):
            raise HTTPException(
                status_code=409,
                detail="Ya hay una actualizacion de metricas en curso. Espera a que termine.",
            )
        if self._is_user_sync_running(user_id):
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")

        async def _runner() -> None:
            await self.sync_instagram(user_id)

        task = asyncio.create_task(_runner())
        task.add_done_callback(lambda _: _sync_tasks.pop(user_id, None))
        _sync_tasks[user_id] = task

    def trigger_discover_range(self, user_id: str) -> None:
        if self._is_user_refresh_metrics_running(user_id):
            raise HTTPException(
                status_code=409,
                detail="Ya hay una actualizacion de metricas en curso. Espera a que termine.",
            )
        if self._is_user_sync_running(user_id):
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")

        async def _runner() -> None:
            await self.discover_instagram_range(user_id)

        task = asyncio.create_task(_runner())
        task.add_done_callback(lambda _: _sync_tasks.pop(user_id, None))
        _sync_tasks[user_id] = task

    def trigger_import_range(self, user_id: str, take: int) -> None:
        if self._is_user_refresh_metrics_running(user_id):
            raise HTTPException(
                status_code=409,
                detail="Ya hay una actualizacion de metricas en curso. Espera a que termine.",
            )
        if self._is_user_sync_running(user_id):
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")

        async def _runner() -> None:
            await self.import_instagram_range_preview(user_id, take)

        task = asyncio.create_task(_runner())
        task.add_done_callback(lambda _: _sync_tasks.pop(user_id, None))
        _sync_tasks[user_id] = task

    def trigger_refresh_metrics(self, user_id: str) -> None:
        if self._is_user_sync_running(user_id):
            raise HTTPException(status_code=409, detail="Ya hay una sincronizacion de reels en curso.")
        if self._is_user_refresh_metrics_running(user_id):
            raise HTTPException(
                status_code=409,
                detail="Ya hay una actualizacion de metricas en curso.",
            )

        async def _runner() -> None:
            await self.refresh_metrics(user_id)

        task = asyncio.create_task(_runner())
        task.add_done_callback(lambda _: _refresh_metrics_tasks.pop(user_id, None))
        _refresh_metrics_tasks[user_id] = task

    def _set_sync_state(
        self,
        user_id: str,
        *,
        total: int,
        processed: int,
        status: str,
        phase: str = "idle",
        discovered: int = 0,
    ) -> None:
        _sync_states[user_id] = {
            "total": max(0, int(total)),
            "processed": max(0, int(processed)),
            "status": status,
            "phase": phase,
            "discovered": max(0, int(discovered)),
        }

    @staticmethod
    def _count_agendas_for_reel(user_id: int, reel_db_id: int) -> int:
        """Leads con punto_agenda = id del reel (trim); SQL nativo para no romper el traductor de Pony."""
        tid = str(reel_db_id)
        tbl = Lead._table_ or "lead"
        sql = f"""COUNT(*) FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) = $tid"""
        with db_session:
            rows = db.select(sql, globals(), {"user_id": user_id, "tid": tid})
        return int(rows[0]) if rows else 0

    @staticmethod
    def _sum_pago_agenda_for_reel(user_id: int, reel_db_id: int) -> float:
        """Suma `pago` de leads con punto_agenda = id interno del reel (mismo criterio que agendas)."""
        tid = str(reel_db_id)
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

    def _to_response(self, row: ReelContent) -> ReelResponse:
        metrics = {
            "plays": row.plays,
            "reach": row.reach,
            "likes": row.likes,
            "comments": row.comentarios,
            "comentarios": row.comentarios,
            "shares": row.shares,
            "guardados": row.guardados,
            "thumbnail": row.thumbnail_url or "",
        }
        classification: dict = {}
        if row.dolor:
            classification["dolor"] = row.dolor
        if row.angulos:
            classification["angulos"] = row.angulos
        if row.cta:
            classification["cta"] = row.cta
        pub = row.fecha_publicacion
        published_at_api = self._as_utc(pub) if pub else None
        chats_manuales = int(row.chats_manuales or 0)
        chats_leads = self._chats_leads_for_reel(row)
        chats_total = chats_manuales + chats_leads
        agendas_n = self._count_agendas_for_reel(int(row.user_id), int(row.id))
        uid = int(row.user_id)
        rid = int(row.id)
        cash_leads = self._sum_pago_agenda_for_reel(uid, rid)
        manual_cash_db = float(row.cash or 0)
        return ReelResponse(
            id=str(row.id),
            title=row.title,
            content_type="reel",
            platform="instagram",
            metrics=metrics,
            classification=classification,
            cash=float(cash_leads),
            chats=chats_total,
            published_at=published_at_api,
            url=row.permalink,
            notes=None,
            external_id=row.instagram_id,
            keyword=row.keyword,
            content_url=row.permalink,
            chats_count=0,
            manual_cash=manual_cash_db,
            manual_chats=chats_manuales,
            cash_total=float(cash_leads),
            cpc=(float(cash_leads) / chats_total) if chats_total > 0 else 0,
            agendas=int(agendas_n),
        )

    @staticmethod
    def _count_leads_matching_reel_keyword(user_id: int, reel_keyword: str | None) -> int:
        """Cuenta leads del usuario cuyo campo keyword (coma-separado) incluye el keyword del reel (case-insensitive, por token)."""
        kw = (reel_keyword or "").strip()
        if not kw:
            return 0
        tbl = Lead._table_ or "lead"
        sql = f"""COUNT(*) FROM {tbl} l
WHERE l.user_id = $user_id
AND EXISTS (
    SELECT 1
    FROM unnest(string_to_array(coalesce(l.keyword, ''), ',')) AS t(part)
    WHERE lower(trim(both from t.part)) = lower($kw)
)"""
        with db_session:
            rows = db.select(sql, globals(), {"user_id": user_id, "kw": kw})
        return int(rows[0]) if rows else 0

    def _chats_leads_for_reel(self, row: ReelContent) -> int:
        return self._count_leads_matching_reel_keyword(int(row.user_id), row.keyword)

    def _chats_leads_for_response(self, user_id: str, reel: ReelResponse) -> int:
        return self._count_leads_matching_reel_keyword(int(user_id), reel.keyword)

    def _finalize_reel_response(
        self,
        *,
        user_id: str,
        reel: ReelResponse,
        refresh: bool = False,
    ) -> ReelResponse:
        """Ajusta chats y cash por chat; `cash` ya es suma de pagos por agenda (no se mezcla con manual_cash)."""
        _ = refresh
        manual_chats = int(reel.manual_chats if reel.manual_chats is not None else 0)
        leads_chats = self._chats_leads_for_response(user_id, reel)
        base_chats = manual_chats + leads_chats
        cash_leads = float(reel.cash or 0)
        reel.chats_count = 0
        reel.chats = base_chats
        reel.cash_total = cash_leads
        reel.cpc = (cash_leads / reel.chats) if reel.chats > 0 else 0
        return reel

    @db_session
    def _upsert_reel_content(
        self,
        *,
        user_id: str,
        instagram_id: str,
        title: str | None,
        thumbnail_url: str | None,
        permalink: str | None,
        fecha_publicacion: datetime,
        plays: int,
        reach: int,
        likes: int,
        comentarios: int,
        shares: int,
        guardados: int,
    ) -> bool:
        uid = int(user_id)
        now = datetime.now(timezone.utc)
        fecha_utc = self._store_publication_utc(fecha_publicacion)
        existing = ReelContent.get(instagram_id=instagram_id)
        if existing:
            if existing.user_id != uid:
                return False
            if title:
                existing.title = title
            if thumbnail_url:
                existing.thumbnail_url = thumbnail_url
            if permalink:
                existing.permalink = permalink
            existing.fecha_publicacion = fecha_utc
            existing.plays = plays
            existing.reach = reach
            existing.likes = likes
            existing.comentarios = comentarios
            existing.shares = shares
            existing.guardados = guardados
            existing.updated_at = now
            return False

        insert_kw: dict = {
            "user_id": uid,
            "instagram_id": instagram_id,
            "fecha_publicacion": fecha_utc,
            "plays": plays,
            "reach": reach,
            "likes": likes,
            "comentarios": comentarios,
            "shares": shares,
            "guardados": guardados,
            "cash": 0,
            "created_at": now,
            "updated_at": now,
        }
        if title:
            insert_kw["title"] = title
        if thumbnail_url:
            insert_kw["thumbnail_url"] = thumbnail_url
        if permalink:
            insert_kw["permalink"] = permalink
        ReelContent(**insert_kw)
        return True

    def _month_filter_set(self, month: str | None, months_csv: str | None) -> set[str] | None:
        """None = sin filtro; set de claves YYYY-MM."""
        if months_csv is not None and str(months_csv).strip():
            raw = [p.strip() for p in str(months_csv).split(",") if p.strip()]
            if not raw:
                return None
            out: set[str] = set()
            for p in raw:
                parts = p.split("-", 1)
                if len(parts) != 2:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Mes inválido: {p!r}. Usá formato YYYY-MM separados por coma.",
                    )
                try:
                    y, mnum = int(parts[0]), int(parts[1])
                except ValueError as e:
                    raise HTTPException(
                        status_code=400,
                        detail="Cada mes debe tener formato YYYY-MM.",
                    ) from e
                if mnum < 1 or mnum > 12:
                    raise HTTPException(status_code=400, detail="Mes inválido (1–12).")
                out.add(f"{y:04d}-{mnum:02d}")
            return out
        if month is not None and str(month).strip():
            m = str(month).strip()
            parts = m.split("-", 1)
            if len(parts) != 2:
                raise HTTPException(status_code=400, detail="El parámetro month debe tener formato YYYY-MM.")
            try:
                y, mnum = int(parts[0]), int(parts[1])
            except ValueError as e:
                raise HTTPException(status_code=400, detail="El parámetro month debe tener formato YYYY-MM.") from e
            if mnum < 1 or mnum > 12:
                raise HTTPException(status_code=400, detail="Mes inválido (1–12).")
            return {f"{y:04d}-{mnum:02d}"}
        return None

    def list_reels(
        self,
        user_id: str,
        month: str | None,
        page: int,
        page_size: int,
        months_csv: str | None = None,
        *,
        skip_agg: bool = False,
    ) -> ReelsListResponse:
        uid = int(user_id)
        month_set = self._month_filter_set(month, months_csv)
        with db_session:
            rows = [r for r in list(ReelContent.select()) if r.user_id == uid]
            available_months = sorted(
                {mk for r in rows if r.fecha_publicacion and (mk := self._month_key_ar(r.fecha_publicacion))},
                reverse=True,
            )
            if month_set is not None:
                rows = [r for r in rows if self._month_key_ar(r.fecha_publicacion) in month_set]
            rows.sort(
                key=lambda r: self._as_utc(r.fecha_publicacion) if r.fecha_publicacion else datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
            total = len(rows)
            page_size = max(1, min(page_size, 50))
            page = max(1, page)
            total_pages = (total + page_size - 1) // page_size if total else 0
            start = (page - 1) * page_size
            end = start + page_size
            page_rows = rows[start:end]

            if skip_agg:
                total_cash_raw = 0.0
                total_chats_raw = 0
            else:
                total_cash_raw = sum(self._sum_pago_agenda_for_reel(uid, int(r.id)) for r in rows)
                total_chats_raw = 0
                for r in rows:
                    total_chats_raw += int(r.chats_manuales or 0) + self._chats_leads_for_reel(r)

            page_responses = [self._to_response(r) for r in page_rows]

        for reel in page_responses:
            self._finalize_reel_response(user_id=str(uid), reel=reel, refresh=False)

        return ReelsListResponse(
            reels=page_responses,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            available_months=available_months,
            total_cash=float(total_cash_raw),
            total_chats=int(total_chats_raw),
        )

    def get_reel(self, user_id: str, reel_id: str, refresh: bool = False) -> ReelResponse:
        uid = int(user_id)
        with db_session:
            try:
                row = ReelContent.get(id=int(reel_id), user_id=uid)
            except (ObjectNotFound, ValueError) as e:
                raise HTTPException(status_code=404, detail="Reel no encontrado.") from e
            response = self._to_response(row)

        return self._finalize_reel_response(user_id=user_id, reel=response, refresh=refresh)

    def patch_reel(self, user_id: str, reel_id: str, body: ReelPatchRequest) -> ReelResponse:
        patch = body.model_dump(exclude_unset=True)
        if not patch:
            raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
        now = datetime.now(timezone.utc)
        uid = int(user_id)
        with db_session:
            try:
                row = ReelContent.get(id=int(reel_id), user_id=uid)
            except (ObjectNotFound, ValueError) as e:
                raise HTTPException(status_code=404, detail="Reel no encontrado.") from e
            if "cash" in patch and patch["cash"] is not None:
                row.cash = float(patch["cash"])
            if "chats_manuales" in patch:
                row.chats_manuales = max(0, int(patch["chats_manuales"]))
            elif "chats" in patch:
                row.chats_manuales = max(0, int(patch["chats"]))
            for key in ("dolor", "angulos", "cta"):
                if key not in patch:
                    continue
                raw = patch[key]
                s = (raw or "").strip() if isinstance(raw, str) else ("" if raw is None else str(raw).strip())
                setattr(row, key, s or None)
            row.updated_at = now
            response = self._to_response(row)
        return self._finalize_reel_response(user_id=str(uid), reel=response, refresh=False)

    def patch_reel_keyword(self, user_id: str, reel_id: str, body: ReelKeywordPatchRequest) -> ReelResponse:
        normalized_keyword = (body.keyword or "").strip()
        now = datetime.now(timezone.utc)
        uid = int(user_id)
        rid = int(reel_id)
        with db_session:
            try:
                row = ReelContent.get(id=rid, user_id=uid)
            except (ObjectNotFound, ValueError) as e:
                raise HTTPException(status_code=404, detail="Reel no encontrado.") from e

            if normalized_keyword:
                duplicated = next(
                    (
                        r
                        for r in list(ReelContent.select())
                        if r.user_id == uid
                        and r.id != rid
                        and (r.keyword or "").strip().lower() == normalized_keyword.lower()
                    ),
                    None,
                )
                if duplicated is not None:
                    raise HTTPException(status_code=409, detail="Ya existe otro reel con ese keyword.")

            row.keyword = normalized_keyword
            row.updated_at = now
            return self._to_response(row)

    def increment_chats_count_by_keyword(self, user_id: str, keyword: str) -> bool:
        """Sin columna chats_count en ReelContent; reservado para integraciones futuras."""
        return False

    def _resolve_instagram_conn(self, user_id: str) -> tuple[str, str]:
        uid = int(user_id)
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == uid and c.platform == "instagram"
                ),
                None,
            )
            if conn is None:
                raise HTTPException(
                    status_code=400,
                    detail="No hay conexión de Instagram configurada. Configúrala en Conexiones API.",
                )
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            token = str(creds.get("access_token") or "").strip()
            ig_user_id = str(creds.get("instagram_user_id") or "").strip()
            if not token or not ig_user_id:
                raise HTTPException(
                    status_code=400,
                    detail="Faltan access_token o instagram_user_id en la conexión de Instagram.",
                )
            return token, ig_user_id

    def _http_json(
        self,
        url: str,
        method: str = "GET",
        body: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict:
        data = None
        req_headers = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err_raw = e.read().decode("utf-8")
            except Exception:
                err_raw = ""
            raise HTTPException(
                status_code=502,
                detail=f"Error HTTP en proveedor externo ({e.code}): {err_raw[:220]}",
            ) from e
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"Error al llamar proveedor externo: {str(e)}") from e

    def get_sync_status(self, user_id: str) -> dict[str, int | str]:
        state = _sync_states.get(user_id)
        base: dict[str, int | str] = (
            dict(state)
            if state is not None
            else {"total": 0, "processed": 0, "status": "idle", "phase": "idle", "discovered": 0}
        )
        with _range_preview_lock:
            preview_n = len(_range_preview_media.get(user_id, []))
        if preview_n > 0:
            base["range_preview_count"] = preview_n
        from src.services.instagram_token_utils import resolve_instagram_token_dates

        try:
            with db_session:
                conn = ApiConnection.get(user_id=int(user_id), platform="instagram")
            token_dates = resolve_instagram_token_dates(conn)
            if token_dates.get("token_expires_at"):
                base["token_expires_at"] = str(token_dates["token_expires_at"])
            if token_dates.get("token_saved_at"):
                base["token_saved_at"] = str(token_dates["token_saved_at"])
        except ObjectNotFound:
            pass
        return base

    def get_metrics(self, user_id: str, month: str | None, months_csv: str | None = None) -> dict[str, int]:
        uid = int(user_id)
        uid_str = str(uid)
        month_set = self._month_filter_set(month, months_csv)
        with db_session:
            rows = [r for r in list(ReelContent.select()) if r.user_id == uid]
            if month_set is not None:
                rows = [r for r in rows if self._month_key_ar(r.fecha_publicacion) in month_set]
            payloads = [{"cta": (r.cta or "").strip(), "reel": self._to_response(r)} for r in rows]

        chats_del_mes = 0
        reels_con_cta = 0
        reels_sin_cta = 0
        for p in payloads:
            reel = self._finalize_reel_response(user_id=uid_str, reel=p["reel"], refresh=False)
            chats_del_mes += int(reel.chats or 0)
            if _cta_counts_as_reel_con_cta(p["cta"]):
                reels_con_cta += 1
            else:
                reels_sin_cta += 1

        return {
            "chats_del_mes": chats_del_mes,
            "piezas_publicadas": len(payloads),
            "reels_con_cta": reels_con_cta,
            "reels_sin_cta": reels_sin_cta,
        }

    def _ig_fetch_reel_metrics(
        self,
        access_token: str,
        media_id: str,
        *,
        like_count: int | None = None,
        comments_count: int | None = None,
    ) -> dict[str, int]:
        """Métricas de un reel vía Graph API (plays, reach, likes, comentarios, shares, guardados)."""
        headers = {"Accept": "application/json"}
        insights = {
            "ig_reels_avg_watch_time": 0,
            "reach": 0,
            "saved": 0,
            "shares": 0,
            "likes": 0,
            "comments": 0,
            "total_interactions": 0,
        }
        plays_result = 0
        for plays_metric in ["video_views", "views"]:
            plays_url = (
                f"https://graph.facebook.com/v25.0/{urllib.parse.quote(media_id)}/insights"
                f"?metric={urllib.parse.quote(plays_metric)}"
                f"&access_token={urllib.parse.quote(access_token)}"
            )
            try:
                plays_payload = self._http_json(plays_url, headers=headers)
                plays_data = plays_payload.get("data")
                metrics_rows = plays_data if isinstance(plays_data, list) else []
                for m in metrics_rows:
                    if not isinstance(m, dict):
                        continue
                    values = m.get("values")
                    if isinstance(values, list) and values and isinstance(values[0], dict):
                        plays_result = int(values[0].get("value") or 0)
                        break
                break
            except Exception:
                continue

        for metric_name in [
            "ig_reels_avg_watch_time",
            "reach",
            "saved",
            "shares",
            "likes",
            "comments",
            "total_interactions",
        ]:
            insights_url = (
                f"https://graph.facebook.com/v25.0/{urllib.parse.quote(media_id)}/insights"
                f"?metric={urllib.parse.quote(metric_name)}"
                f"&access_token={urllib.parse.quote(access_token)}"
            )
            try:
                insights_payload = self._http_json(insights_url, headers=headers)
                metrics_rows = insights_payload.get("data") if isinstance(insights_payload.get("data"), list) else []
                for m in metrics_rows:
                    if not isinstance(m, dict):
                        continue
                    name = str(m.get("name") or "").strip()
                    values = m.get("values")
                    value = 0
                    if isinstance(values, list) and values and isinstance(values[0], dict):
                        value = int(values[0].get("value") or 0)
                    if name in insights:
                        insights[name] = value
            except Exception:
                continue

        likes_base = 0 if like_count is None else int(like_count)
        comments_base = 0 if comments_count is None else int(comments_count)
        if like_count is None or comments_count is None:
            try:
                mf_url = (
                    f"https://graph.facebook.com/v25.0/{urllib.parse.quote(media_id)}"
                    "?fields=like_count,comments_count"
                    f"&access_token={urllib.parse.quote(access_token)}"
                )
                mf = self._http_json(mf_url, headers=headers)
                if like_count is None:
                    likes_base = int(mf.get("like_count") or 0)
                if comments_count is None:
                    comments_base = int(mf.get("comments_count") or 0)
            except Exception:
                pass

        likes_out = max(likes_base, int(insights.get("likes", 0)))
        comments_out = max(comments_base, int(insights.get("comments", 0)))
        return {
            "plays": int(plays_result),
            "reach": int(insights.get("reach", 0)),
            "likes": likes_out,
            "comentarios": comments_out,
            "shares": int(insights.get("shares", 0)),
            "guardados": int(insights.get("saved", 0)),
        }

    def refresh_metrics_blocking(self, user_id: str) -> dict[str, int]:
        uid = int(user_id)
        access_token, _ = self._resolve_instagram_conn(user_id)
        with db_session:
            reel_rows = [(r.id, r.instagram_id) for r in list(ReelContent.select()) if r.user_id == uid]

        total = len(reel_rows)
        self._set_sync_state(user_id, total=total, processed=0, status="running", phase="processing", discovered=total)
        updated = 0
        errors = 0
        processed = 0
        try:
            for rid, instagram_id in reel_rows:
                try:
                    m = self._ig_fetch_reel_metrics(access_token, instagram_id)
                    now = datetime.now(timezone.utc)
                    with db_session:
                        row = ReelContent.get(id=rid)
                        if row is None or row.user_id != uid:
                            continue
                        row.plays = m["plays"]
                        row.reach = m["reach"]
                        row.likes = m["likes"]
                        row.comentarios = m["comentarios"]
                        row.shares = m["shares"]
                        row.guardados = m["guardados"]
                        row.updated_at = now
                        updated += 1
                except Exception as e:
                    try:
                        rollback()
                    except Exception:
                        pass
                    errors += 1
                    print(f"[reels refresh-metrics] ERROR reel id={rid} ig={instagram_id}: {e}")
                finally:
                    processed += 1
                    self._set_sync_state(
                        user_id,
                        total=total,
                        processed=processed,
                        status="running",
                        phase="processing",
                        discovered=total,
                    )

            self._set_sync_state(user_id, total=total, processed=processed, status="done", phase="done", discovered=total)
            return {"updated": updated, "errors": errors, "total": total}
        except Exception:
            current = _sync_states.get(user_id, {"total": 0, "processed": 0, "discovered": 0})
            self._set_sync_state(
                user_id,
                total=int(current.get("total", 0)),
                processed=int(current.get("processed", 0)),
                status="error",
                phase="error",
                discovered=int(current.get("discovered", 0)),
            )
            raise

    def _ig_media_item_fields_brief(self) -> str:
        """Campos para listar / importar un reel antes de pedir insights."""
        return "id,media_type,thumbnail_url,permalink,timestamp,caption,like_count,comments_count"

    def _fetch_ig_media_item_brief(self, access_token: str, media_id: str) -> dict:
        """Un GET por media_id con los mismos campos que el listado (sin insights)."""
        headers = {"Accept": "application/json"}
        q_fields = urllib.parse.quote(self._ig_media_item_fields_brief(), safe=",")
        url = (
            f"https://graph.facebook.com/v25.0/{urllib.parse.quote(media_id)}"
            f"?fields={q_fields}"
            f"&access_token={urllib.parse.quote(access_token)}"
        )
        return self._http_json(url, headers=headers)

    def _collect_instagram_reel_media_items(
        self,
        user_id: str,
        date_from: datetime | None,
        date_to: datetime | None,
        *,
        quick_max: int | None,
        update_state: bool = True,
        minimal_preview: bool = False,
    ) -> list[dict]:
        """Recolecta items de media REELS/VIDEO. Si no hay date_from, corta en quick_max (p. ej. 10). Con rango de fechas, recorre todo el rango.

        minimal_preview: solo id y timestamp (y tipo ya filtrado), para contar rápido en discover.
        """
        access_token, ig_user_id = self._resolve_instagram_conn(user_id)
        headers = {"Accept": "application/json"}
        list_fields = "id,media_type,timestamp" if minimal_preview else self._ig_media_item_fields_brief()
        q_fields = urllib.parse.quote(list_fields, safe=",")
        media_url = (
            f"https://graph.facebook.com/v25.0/{urllib.parse.quote(ig_user_id)}/media"
            f"?fields={q_fields}"
            f"&access_token={urllib.parse.quote(access_token)}"
        )
        media_items: list[dict] = []
        pages_fetched = 0
        max_pages = 100
        next_url = media_url
        stop_pagination = False
        sync_by_date = date_from is not None

        while next_url and pages_fetched < max_pages and not stop_pagination:
            payload = self._http_json(next_url, headers=headers)
            rows = payload.get("data")
            if isinstance(rows, list):
                for item in rows:
                    if not isinstance(item, dict):
                        continue
                    media_type = str(item.get("media_type") or "").upper()
                    if media_type not in ("REELS", "VIDEO"):
                        continue
                    timestamp_raw = str(item.get("timestamp") or "").strip()
                    if not timestamp_raw:
                        continue
                    try:
                        published_at = self._parse_graph_timestamp(timestamp_raw)
                    except Exception:
                        continue

                    pub_ar = published_at.astimezone(AR_TZ)
                    if sync_by_date and date_from is not None:
                        lower = date_from.astimezone(AR_TZ) if date_from.tzinfo else date_from.replace(tzinfo=AR_TZ)
                        if pub_ar < lower:
                            stop_pagination = True
                            break
                        if date_to is not None:
                            upper = date_to.astimezone(AR_TZ) if date_to.tzinfo else date_to.replace(tzinfo=AR_TZ)
                            if pub_ar > upper:
                                continue
                    elif date_to is not None:
                        upper = date_to.astimezone(AR_TZ) if date_to.tzinfo else date_to.replace(tzinfo=AR_TZ)
                        if pub_ar > upper:
                            continue

                    if minimal_preview:
                        media_items.append(
                            {
                                "id": item.get("id"),
                                "timestamp": item.get("timestamp"),
                            }
                        )
                    else:
                        media_items.append(item)
                    if not sync_by_date and quick_max is not None and len(media_items) >= quick_max:
                        stop_pagination = True
                        break

            paging = payload.get("paging") if isinstance(payload, dict) else None
            next_from_api = paging.get("next") if isinstance(paging, dict) else None
            next_url = str(next_from_api).strip() if next_from_api else ""
            pages_fetched += 1
            if update_state:
                discovered_reels = len(media_items)
                self._set_sync_state(
                    user_id,
                    total=discovered_reels,
                    processed=0,
                    status="running",
                    phase="collecting",
                    discovered=discovered_reels,
                )

        return media_items

    def _process_reel_media_items(self, user_id: str, reels: list[dict]) -> dict[str, int]:
        access_token, _ig_user_id = self._resolve_instagram_conn(user_id)
        synced = 0
        created = 0
        errors = 0
        processed = 0
        total = len(reels)
        self._set_sync_state(user_id, total=total, processed=0, status="running", phase="processing", discovered=total)

        for item in reels:
            try:
                media_id = str(item.get("id") or "").strip()
                if not media_id:
                    continue
                caption = str(item.get("caption") or "").strip()
                title = caption[:100] if caption else None
                permalink = str(item.get("permalink") or "").strip() or None
                thumbnail_url = str(item.get("thumbnail_url") or "").strip() or None
                likes = int(item.get("like_count") or 0)
                comments = int(item.get("comments_count") or 0)
                timestamp = str(item.get("timestamp") or "").strip()
                published_at = datetime.now(timezone.utc)
                if timestamp:
                    try:
                        published_at = self._parse_graph_timestamp(timestamp)
                    except Exception:
                        pass

                m = self._ig_fetch_reel_metrics(
                    access_token,
                    media_id,
                    like_count=likes,
                    comments_count=comments,
                )

                created_this_reel = self._upsert_reel_content(
                    user_id=user_id,
                    instagram_id=media_id,
                    title=title,
                    thumbnail_url=thumbnail_url,
                    permalink=permalink,
                    fecha_publicacion=published_at,
                    plays=m["plays"],
                    reach=m["reach"],
                    likes=m["likes"],
                    comentarios=m["comentarios"],
                    shares=m["shares"],
                    guardados=m["guardados"],
                )
                if created_this_reel:
                    created += 1
                synced += 1
            except Exception as e:
                try:
                    rollback()
                except Exception:
                    pass
                errors += 1
                print(f"[reels sync] ERROR en media {item.get('id')}: {e}")
            finally:
                processed += 1
                self._set_sync_state(
                    user_id, total=total, processed=processed, status="running", phase="processing", discovered=total
                )

        self._set_sync_state(user_id, total=total, processed=processed, status="done", phase="done", discovered=total)
        return {"synced": synced, "created": created, "errors": errors}

    def _sync_instagram_blocking(
        self,
        user_id: str,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        *,
        quick_max: int | None = None,
    ) -> dict[str, int]:
        if quick_max is None:
            quick_max = QUICK_REELS_SYNC_LIMIT
        self._set_sync_state(user_id, total=0, processed=0, status="running", phase="collecting", discovered=0)
        try:
            items = self._collect_instagram_reel_media_items(
                user_id, date_from, date_to, quick_max=quick_max, update_state=True
            )
            return self._process_reel_media_items(user_id, items)
        except Exception:
            current = _sync_states.get(user_id, {"total": 0, "processed": 0, "discovered": 0})
            self._set_sync_state(
                user_id,
                total=int(current.get("total", 0)),
                processed=int(current.get("processed", 0)),
                status="error",
                phase="error",
                discovered=int(current.get("discovered", 0)),
            )
            raise

    def discover_range_blocking(self, user_id: str) -> dict[str, int]:
        self._set_sync_state(user_id, total=0, processed=0, status="running", phase="collecting", discovered=0)
        try:
            items = self._collect_instagram_reel_media_items(
                user_id, None, None, quick_max=None, update_state=True, minimal_preview=True
            )
            with _range_preview_lock:
                _range_preview_media[user_id] = items
            n = len(items)
            self._set_sync_state(
                user_id, total=0, processed=0, status="idle", phase="preview_ready", discovered=n
            )
            return {"count": n}
        except Exception:
            current = _sync_states.get(user_id, {"total": 0, "processed": 0, "discovered": 0})
            self._set_sync_state(
                user_id,
                total=int(current.get("total", 0)),
                processed=int(current.get("processed", 0)),
                status="error",
                phase="error",
                discovered=int(current.get("discovered", 0)),
            )
            raise

    def import_range_blocking(self, user_id: str, take: int) -> dict[str, int]:
        with _range_preview_lock:
            items = _range_preview_media.get(user_id)
        if not items:
            raise HTTPException(
                status_code=400,
                detail="No hay reels listos para importar. Ejecutá primero la búsqueda en la cuenta.",
            )
        if take < 1 or take > len(items):
            raise HTTPException(
                status_code=400,
                detail=f"Indicá un número entre 1 y {len(items)} (reels encontrados).",
            )
        subset = items[:take]
        access_token, _ = self._resolve_instagram_conn(user_id)
        enriched: list[dict] = []
        for it in subset:
            if not isinstance(it, dict):
                continue
            if str(it.get("permalink") or "").strip():
                enriched.append(it)
                continue
            mid = str(it.get("id") or "").strip()
            if not mid:
                continue
            enriched.append(self._fetch_ig_media_item_brief(access_token, mid))
        try:
            result = self._process_reel_media_items(user_id, enriched)
            with _range_preview_lock:
                _range_preview_media.pop(user_id, None)
            return result
        except Exception:
            current = _sync_states.get(user_id, {"total": 0, "processed": 0, "discovered": 0})
            self._set_sync_state(
                user_id,
                total=int(current.get("total", 0)),
                processed=int(current.get("processed", 0)),
                status="error",
                phase="error",
                discovered=int(current.get("discovered", 0)),
            )
            raise

    async def sync_instagram(self, user_id: str) -> dict[str, int]:
        acquired = _sync_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(status_code=409, detail="Ya hay una operacion de reels en curso.")
        try:
            return await asyncio.to_thread(
                self._sync_instagram_blocking, user_id, None, None, quick_max=QUICK_REELS_SYNC_LIMIT
            )
        finally:
            _sync_lock.release()

    async def discover_instagram_range(self, user_id: str) -> dict[str, int]:
        acquired = _sync_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(status_code=409, detail="Ya hay una operacion de reels en curso.")
        try:
            return await asyncio.to_thread(self.discover_range_blocking, user_id)
        finally:
            _sync_lock.release()

    async def import_instagram_range_preview(self, user_id: str, take: int) -> dict[str, int]:
        acquired = _sync_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(status_code=409, detail="Ya hay una operacion de reels en curso.")
        try:
            return await asyncio.to_thread(self.import_range_blocking, user_id, take)
        finally:
            _sync_lock.release()

    async def refresh_metrics(self, user_id: str) -> dict[str, int]:
        acquired = _sync_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(status_code=409, detail="Ya hay una operacion de reels en curso.")
        try:
            return await asyncio.to_thread(self.refresh_metrics_blocking, user_id)
        finally:
            _sync_lock.release()
