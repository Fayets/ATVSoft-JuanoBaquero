import os
import glob
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from decouple import config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pony.orm import db_session

from src.controllers.admin_panel_controller import router as admin_panel_router
from src.controllers.agent_controller import router as agent_router
from src.controllers.auth_controller import router as auth_router
from src.controllers.bio_controller import router as bio_router
from src.controllers.call_reports_controller import router as call_reports_router
from src.controllers.calendly_controller import router as calendly_router
from src.controllers.conexiones_controller import router as conexiones_router
from src.controllers.ghl_controller import router as ghl_router
# from src.controllers.health_controller import router as health_router
from src.controllers.master_lists_controller import router as master_lists_router
from src.controllers.programs_controller import router as programs_router
from src.controllers.avatars_controller import router as avatars_router
from src.controllers.keywords_controller import router as keywords_router
from src.controllers.leads_controller import router as leads_router
from src.controllers.hot_leads_controller import router as hot_leads_router
from src.controllers.reels_controller import router as reels_router
from src.controllers.stories_controller import router as stories_router
from src.controllers.sync_settings_controller import router as sync_settings_router
from src.controllers.team_controller import router as team_router
from src.controllers.youtube_controller import router as youtube_router
from src.controllers.weekly_reports_controller import router as weekly_reports_router
from src.controllers.webhook_controller import router as webhook_router
from src.db import db, init_db
from src.models import ApiConnection
from src.services.reels_services import ReelsServices
from src.services.sync_scheduler_service import (
    CALENDLY_JOB_ID,
    REELS_JOB_ID,
    STORIES_JOB_ID,
    apply_sync_schedules,
    bind_sync_scheduler,
)
from src.services.sync_settings_service import (
    DEFAULT_CALENDLY_INTERVAL_MINUTES,
    DEFAULT_REELS_INTERVAL_MINUTES,
    DEFAULT_STORIES_INTERVAL_MINUTES,
    get_calendly_interval_minutes,
    get_reels_interval_minutes,
    get_stories_interval_minutes,
)
from src.services.stories_service import StoriesService
from src.services.closer_report_auto_service import generate_daily_reports_all_users

AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
CLOSER_DAILY_REPORT_JOB_ID = "auto_closer_daily_reports"
scheduler = AsyncIOScheduler()


async def auto_sync_stories() -> None:
    """Sincroniza Instagram para todos los usuarios que tengan ApiConnection de instagram"""
    try:
        with db_session:
            _ = db
            connections = list(ApiConnection.select().filter(lambda c: c.platform == "instagram"))
            user_ids = [c.user_id for c in connections]

        service = StoriesService()
        for user_id in user_ids:
            try:
                result = await service.sync_instagram(str(user_id))
                print(f"[scheduler] Sync automático OK para {user_id}: {result}")
            except Exception as e:
                print(f"[scheduler] Sync automático FAILED para {user_id}: {e}")
    except Exception as e:
        print(f"[scheduler] Error general en auto_sync_stories: {e}")


async def auto_refresh_reels_metrics() -> None:
    """Actualiza métricas en BD de reels ya existentes (Graph API por instagram_id)."""
    try:
        with db_session:
            _ = db
            connections = list(ApiConnection.select().filter(lambda c: c.platform == "instagram"))
            user_ids = [c.user_id for c in connections]

        service = ReelsServices()
        for user_id in user_ids:
            try:
                result = await service.refresh_metrics(str(user_id))
                print(f"[scheduler] Reels refresh-metrics OK para {user_id}: {result}")
            except Exception as e:
                print(f"[scheduler] Reels refresh-metrics FAILED para {user_id}: {e}")
    except Exception as e:
        print(f"[scheduler] Error general en auto_refresh_reels_metrics: {e}")


async def auto_sync_calendly() -> None:
    """Auto-check Calendly → sync solo si hay eventos nuevos."""
    from src.controllers.calendly_controller import (
        list_calendly_user_ids_with_token,
        run_calendly_auto_sync_for_user,
    )

    try:
        interval_m = get_calendly_interval_minutes()
        user_ids = list_calendly_user_ids_with_token()
        print(
            f"[scheduler] Calendly auto-check (cada {interval_m} min) "
            f"para {len(user_ids)} usuario(s)"
        )
        for user_id in user_ids:
            try:
                result = run_calendly_auto_sync_for_user(int(user_id))
                if result.get("skipped"):
                    print(
                        f"[scheduler] Calendly skip user={user_id} reason={result.get('reason')}"
                    )
                else:
                    sync = result.get("sync") or {}
                    print(
                        f"[scheduler] Calendly sync OK user={user_id} "
                        f"created={sync.get('created')} updated={sync.get('updated')}"
                    )
            except Exception as e:
                print(f"[scheduler] Calendly FAILED user={user_id}: {e}")
    except Exception as e:
        print(f"[scheduler] Error general en auto_sync_calendly: {e}")


async def auto_generate_closer_daily_reports() -> None:
    """Reporte de ventas del closer desde panel diario (23:00 Argentina)."""
    try:
        generate_daily_reports_all_users(send_discord=True)
    except Exception as e:
        print(f"[scheduler] Error en auto_generate_closer_daily_reports: {e}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    archivos = glob.glob(os.path.join(media_dir, "**/*.jpg"), recursive=True)
    print(f"[media] Archivos encontrados: {len(archivos)}")
    print(f"[media] Directorio: {media_dir}")
    scheduler.add_job(
        auto_sync_stories,
        trigger=IntervalTrigger(minutes=DEFAULT_STORIES_INTERVAL_MINUTES),
        id=STORIES_JOB_ID,
        replace_existing=True,
        next_run_time=datetime.now(AR_TZ),
    )
    scheduler.add_job(
        auto_refresh_reels_metrics,
        trigger=IntervalTrigger(minutes=DEFAULT_REELS_INTERVAL_MINUTES),
        id=REELS_JOB_ID,
        replace_existing=True,
    )
    scheduler.add_job(
        auto_sync_calendly,
        trigger=IntervalTrigger(minutes=DEFAULT_CALENDLY_INTERVAL_MINUTES),
        id=CALENDLY_JOB_ID,
        replace_existing=True,
    )
    scheduler.add_job(
        auto_generate_closer_daily_reports,
        trigger=CronTrigger(hour=23, minute=0, timezone=AR_TZ),
        id=CLOSER_DAILY_REPORT_JOB_ID,
        replace_existing=True,
    )
    bind_sync_scheduler(scheduler)
    apply_sync_schedules()
    scheduler.start()
    print(
        f"[scheduler] Auto-sync historias cada {get_stories_interval_minutes()} min "
        f"(próximo job según APScheduler)"
    )
    print(
        f"[scheduler] Auto refresh-metrics reels cada {get_reels_interval_minutes()} min"
    )
    print(
        f"[scheduler] Auto-sync Calendly cada {get_calendly_interval_minutes()} min "
        f"(check liviano → sync solo si hay novedades)"
    )
    print("[scheduler] Reporte closer ventas automático diario a las 23:00 (Argentina)")
    yield
    scheduler.shutdown()


app = FastAPI(title="ATVMkt Backend", version="0.1.0", lifespan=lifespan)
# Ruta absoluta desde la ubicación de main.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
media_dir = os.path.join(BASE_DIR, "media")
os.makedirs(media_dir, exist_ok=True)
app.mount("/media", StaticFiles(directory=media_dir), name="media")

_origins = config("CORS_ORIGINS", default="http://localhost:3000,http://127.0.0.1:3000")
_allow_origins = [o.strip() for o in _origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# app.include_router(health_router)
app.include_router(admin_panel_router)
app.include_router(auth_router)
app.include_router(agent_router)
app.include_router(conexiones_router)
app.include_router(ghl_router)
app.include_router(master_lists_router)
app.include_router(programs_router)
app.include_router(avatars_router)
app.include_router(leads_router)
app.include_router(call_reports_router)
app.include_router(hot_leads_router)
app.include_router(keywords_router)
app.include_router(reels_router)
app.include_router(bio_router)
app.include_router(stories_router)
app.include_router(sync_settings_router)
app.include_router(team_router)
app.include_router(weekly_reports_router)
app.include_router(youtube_router)
app.include_router(calendly_router)
app.include_router(webhook_router)
