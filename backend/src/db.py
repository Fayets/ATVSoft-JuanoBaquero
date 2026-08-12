import re
from datetime import datetime

from decouple import config
from pony.orm import *

db = Database()

db.bind(
    provider=config("DB_PROVIDER"),
    user=config("DB_USER"),
    password=config("DB_PASS"),
    host=config("DB_HOST"),
    database=config("DB_NAME"),
)


def _migrate_postgres_lead_call_to_timestamp() -> None:
    """Postgres: columna `call` pasa de boolean a TIMESTAMP (fecha Calendly).

    Copia datos desde fecha_cita si existía; elimina fecha_cita al final.
    """
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical

            cur.execute(
                """
                SELECT data_type FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'call'
                """,
                (physical,),
            )
            cr = cur.fetchone()
            if not cr:
                return
            dtype = (cr[0] or "").lower()

            if dtype == "boolean":
                for ddl in (
                    f"ALTER TABLE {sql_table} ADD COLUMN fecha_cita TIMESTAMP NULL",
                    f"ALTER TABLE {sql_table} ADD COLUMN _call_slot_ts TIMESTAMP NULL",
                ):
                    try:
                        cur.execute(ddl)
                    except Exception:
                        pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _call_slot_ts = fecha_cita "
                        f"WHERE fecha_cita IS NOT NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN call")
                except Exception:
                    return
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} RENAME COLUMN _call_slot_ts TO call"
                    )
                except Exception:
                    return
            elif "timestamp" in dtype:
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET call = fecha_cita "
                        f"WHERE call IS NULL AND fecha_cita IS NOT NULL"
                    )
                except Exception:
                    pass

            try:
                cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS fecha_cita")
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_agendo_to_timestamp() -> None:
    """Postgres: columna `agendo` pasa de boolean a TIMESTAMP (momento del webhook / form completo)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical

            cur.execute(
                """
                SELECT data_type FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'agendo'
                """,
                (physical,),
            )
            ar = cur.fetchone()
            if not ar:
                return
            dtype = (ar[0] or "").lower()

            if dtype == "boolean":
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN _agendo_ts TIMESTAMP NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = call "
                        f"WHERE agendo IS TRUE AND call IS NOT NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = created_at "
                        f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET _agendo_ts = NOW() AT TIME ZONE 'utc' "
                        f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                    )
                except Exception:
                    try:
                        cur.execute(
                            f"UPDATE {sql_table} SET _agendo_ts = NOW() "
                            f"WHERE agendo IS TRUE AND _agendo_ts IS NULL"
                        )
                    except Exception:
                        pass
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN agendo")
                except Exception:
                    return
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} RENAME COLUMN _agendo_ts TO agendo"
                    )
                except Exception:
                    return
    finally:
        conn.close()


def _migrate_postgres_drop_pago_en_llamada() -> None:
    """Elimina `pago_en_llamada`; el importe queda unificado en `pago`."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = 'pago_en_llamada'
                """,
                (physical,),
            )
            if cur.fetchone():
                try:
                    cur.execute(
                        f"UPDATE {sql_table} SET pago = COALESCE(pago, 0) + COALESCE(pago_en_llamada, 0)"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS pago_en_llamada"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_drop_canal_agendo() -> None:
    """Elimina columna legada `canal_agendo` (no mapeada en el modelo; canal = agendo_en)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS canal_agendo")
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_setter_closer() -> None:
    """Añade columnas setter y closer (nombre del equipo) a la tabla lead."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for col in ("setter", "closer"):
                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
                    """,
                    (physical, col),
                )
                if not cur.fetchone():
                    try:
                        cur.execute(
                            f"ALTER TABLE {sql_table} ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"
                        )
                    except Exception:
                        pass
    finally:
        conn.close()


def _migrate_postgres_lead_closer_report() -> None:
    """Añade columna closer_report (texto libre del reporte en tabla leads)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
                """,
                (physical, "closer_report"),
            )
            if not cur.fetchone():
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN closer_report TEXT NOT NULL DEFAULT ''"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_lead_programada_ofrecido_llamada() -> None:
    """Añade columna programada_ofrecido_llamada (programa ofrecido en llamada; no facturación)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
                """,
                (physical, "programada_ofrecido_llamada"),
            )
            if not cur.fetchone():
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN programada_ofrecido_llamada TEXT NOT NULL DEFAULT ''"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_lead_recordatorio_enviado() -> None:
    """Añade columna recordatorio_enviado (bot WhatsApp / proximas-llamadas)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
                """,
                (physical, "recordatorio_enviado"),
            )
            if not cur.fetchone():
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN recordatorio_enviado BOOLEAN DEFAULT false"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_youtube_content() -> None:
    """Crea `youtubecontent` en Postgres (Pony no altera tablas ya mapeadas)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS youtubecontent (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    external_id VARCHAR(32) NOT NULL,
                    title TEXT,
                    description TEXT DEFAULT '',
                    thumbnail_url TEXT,
                    published_at TIMESTAMP NULL,
                    url TEXT,
                    duration_seconds INTEGER NULL,
                    views INTEGER NOT NULL DEFAULT 0,
                    likes INTEGER NOT NULL DEFAULT 0,
                    comments_count INTEGER NOT NULL DEFAULT 0,
                    ctr DOUBLE PRECISION NULL,
                    impressions INTEGER NULL,
                    retention DOUBLE PRECISION NULL,
                    avg_view_duration_seconds INTEGER NULL,
                    performance_history JSONB NOT NULL DEFAULT '[]'::jsonb,
                    classification JSONB NOT NULL DEFAULT '{}'::jsonb,
                    cash DOUBLE PRECISION NOT NULL DEFAULT 0,
                    chats INTEGER NOT NULL DEFAULT 0,
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                    updated_at TIMESTAMP NULL,
                    CONSTRAINT uq_youtubecontent_user_external UNIQUE (user_id, external_id)
                )
                """
            )
            try:
                cur.execute("CREATE INDEX IF NOT EXISTS idx_youtubecontent_user_id ON youtubecontent (user_id)")
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_storyslide_views_shares() -> None:
    """Añade `views` y `shares` a storyslide (Pony no altera tablas existentes en Postgres)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'storyslide'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for ddl in (
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS views INTEGER NULL",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS shares INTEGER NULL",
            ):
                try:
                    cur.execute(ddl)
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_setter_report_text_columns() -> None:
    """Añade textos cualitativos al reporte diario setter (Pony no altera tablas existentes)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'setter_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for ddl in (
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS sentimiento_trafico TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS avatar_tipo_agendas TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS insights_marketing TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS leads_nuevos integer NOT NULL DEFAULT 0",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS seguimientos integer NOT NULL DEFAULT 0",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS outbounds integer NOT NULL DEFAULT 0",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS dia_bueno_malo text NOT NULL DEFAULT ''",
            ):
                try:
                    cur.execute(ddl)
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_team_report_breakdown() -> None:
    """Desglose setter/closer para dashboard ventas (paridad Paula-lorena)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            for table, columns in (
                (
                    "setter_report",
                    (
                        ("conversaciones_stories", "integer NOT NULL DEFAULT 0"),
                        ("conversaciones_reels", "integer NOT NULL DEFAULT 0"),
                        ("agendas_stories", "integer NOT NULL DEFAULT 0"),
                        ("agendas_reels", "integer NOT NULL DEFAULT 0"),
                        ("agendas_ads", "integer NOT NULL DEFAULT 0"),
                        ("links_enviados_stories", "integer NOT NULL DEFAULT 0"),
                        ("links_enviados_reels", "integer NOT NULL DEFAULT 0"),
                    ),
                ),
                (
                    "closer_report",
                    (
                        ("shows_organico", "integer NOT NULL DEFAULT 0"),
                        ("shows_ads", "integer NOT NULL DEFAULT 0"),
                        ("cierres_organico", "integer NOT NULL DEFAULT 0"),
                        ("cierres_ads", "integer NOT NULL DEFAULT 0"),
                        ("reservas", "integer NOT NULL DEFAULT 0"),
                        ("seguimiento", "integer NOT NULL DEFAULT 0"),
                        ("facturacion", "DOUBLE PRECISION NOT NULL DEFAULT 0"),
                    ),
                ),
            ):
                cur.execute(
                    """
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'public' AND lower(table_name) = %s
                    """,
                    (table,),
                )
                tr = cur.fetchone()
                if not tr:
                    continue
                physical = tr[0]
                sql_table = f'"{physical}"' if physical != physical.lower() else physical
                for col, tipo in columns:
                    try:
                        cur.execute(
                            f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS {col} {tipo}"
                        )
                    except Exception:
                        pass
    finally:
        conn.close()


def _migrate_postgres_closer_report_tipo() -> None:
    """Añade reporte_tipo (ventas | marketing) para dos reportes diarios por closer."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'closer_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS reporte_tipo VARCHAR(32) NOT NULL DEFAULT 'ventas'"
                )
            except Exception:
                pass
            try:
                cur.execute(f"UPDATE {sql_table} SET reporte_tipo = 'ventas' WHERE reporte_tipo IS NULL OR reporte_tipo = ''")
            except Exception:
                pass
            for ddl in (
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS nombre_lead TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS estado_final_llamada TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS perfil_lead TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS objecion_miedo TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS dolores_llamada TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS razon_compra_final TEXT",
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS insights_marketing_llamada TEXT",
            ):
                try:
                    cur.execute(ddl)
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_closer_report_marketing_multiple_per_day() -> None:
    """Varios reportes marketing por día (una fila por llamada); un solo reporte ventas por closer/fecha."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'closer_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute("DROP INDEX IF EXISTS uq_closer_report_user_member_fecha_tipo")
            except Exception:
                pass
            try:
                cur.execute(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_closer_report_user_member_fecha_ventas "
                    f"ON {sql_table} (user_id, member_id, fecha) WHERE reporte_tipo = 'ventas'"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_remove_closer_marketing() -> None:
    """Elimina reportes marketing manuales del closer y columnas asociadas (Fathom los reemplaza)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'closer_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"DELETE FROM {sql_table} WHERE LOWER(COALESCE(reporte_tipo, 'ventas')) = 'marketing'"
                )
            except Exception:
                pass
            for ddl in (
                "DROP INDEX IF EXISTS uq_closer_report_user_member_fecha_ventas",
                "DROP INDEX IF EXISTS uq_closer_report_user_member_fecha_tipo",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS reporte_tipo",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS nombre_lead",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS estado_final_llamada",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS perfil_lead",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS objecion_miedo",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS dolores_llamada",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS razon_compra_final",
                f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS insights_marketing_llamada",
            ):
                try:
                    cur.execute(ddl)
                except Exception:
                    pass
            try:
                cur.execute(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_closer_report_user_member_fecha "
                    f"ON {sql_table} (user_id, member_id, fecha)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_agendo_en_iso_to_call() -> None:
    """ISO en agendo_en → call (fecha) y agendo_en=Chat (canal)."""
    iso_pat = re.compile(r"^\d{4}-\d{2}-\d{2}")
    try:
        import src.models  # noqa: F401
        from src.models import Lead
    except Exception:
        return

    def _parse(s: str) -> datetime | None:
        s = s.strip()
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            try:
                return datetime.fromisoformat(s[:10] + "T00:00:00")
            except ValueError:
                return None
        try:
            cleaned = s.replace("Z", "").split("+")[0]
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
            return dt
        except ValueError:
            return None

    try:
        with db_session:
            for row in list(Lead.select()):
                s = (row.agendo_en or "").strip()
                if not s or not iso_pat.match(s):
                    continue
                if row.call is not None:
                    continue
                dt = _parse(s)
                if dt is None:
                    continue
                row.call = dt
                row.agendo_en = "Chat"
    except Exception:
        return


def _migrate_agendo_en_default_chat_when_agendado() -> None:
    """Historial: tiene fecha agendo y agendo_en NULL/vacío. Canal por defecto Chat en BD."""
    try:
        import src.models  # noqa: F401
        from src.models import Lead
    except Exception:
        return
    try:
        with db_session:
            for row in list(Lead.select()):
                if row.agendo is None:
                    continue
                if (row.agendo_en or "").strip():
                    continue
                row.agendo_en = "Chat"
    except Exception:
        return


def _backfill_dias_para_agendar() -> None:
    """Obsoleto: columna dias_para_agendar eliminada."""
    return


def _migrate_postgres_lead_formulario_drop_embudo_fields() -> None:
    """Agrega `formulario` (JSON) y elimina via / ctas_respondidos / primer_contacto / dias_para_agendar."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS formulario JSONB DEFAULT '{{}}'::jsonb"
                )
            except Exception:
                pass
            for col in ("via", "ctas_respondidos", "primer_contacto", "dias_para_agendar"):
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS {col}")
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_drop_lead_ingresos() -> None:
    """Elimina columnas `ingresos_lead` e `ingresos_rango` de Lead (dato queda en formulario)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for col in ("ingresos_lead", "ingresos_rango"):
                try:
                    cur.execute(f"ALTER TABLE {sql_table} DROP COLUMN IF EXISTS {col}")
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_offered_program() -> None:
    """Crea `offered_program` en Postgres."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS offered_program (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_offered_program_user_id ON offered_program (user_id)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_avatar_type() -> None:
    """Crea `avatar_type` en Postgres."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS avatar_type (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    nombre TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#6B7280',
                    activo BOOLEAN NOT NULL DEFAULT TRUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_avatar_type_user_id ON avatar_type (user_id)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_seguimiento_report() -> None:
    """Crea `seguimiento_report` en Postgres (cash por formulario de seguimiento)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS seguimiento_report (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    member_id INTEGER NOT NULL,
                    fecha DATE NOT NULL,
                    nombre_lead TEXT NOT NULL,
                    monto DOUBLE PRECISION NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_seguimiento_report_user_fecha ON seguimiento_report (user_id, fecha)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_hot_lead() -> None:
    """Crea `hot_lead` en Postgres."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS hot_lead (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    nombre TEXT NOT NULL DEFAULT '',
                    ig TEXT NOT NULL DEFAULT '',
                    avatar TEXT NOT NULL DEFAULT '',
                    seguidores TEXT NOT NULL DEFAULT '',
                    calidad TEXT NOT NULL DEFAULT '',
                    fecha DATE,
                    status TEXT NOT NULL DEFAULT 'Prospectar',
                    notas TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_hot_lead_user_id ON hot_lead(user_id)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_calendly_fields() -> None:
    """Columnas Calendly en lead + intervalo auto-sync Calendly en app_sync_settings."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if tr:
                physical = tr[0]
                sql_table = f'"{physical}"' if physical != physical.lower() else physical
                for col, tipo in (
                    ("ingresos_rango", "VARCHAR DEFAULT ''"),
                    ("email", "VARCHAR DEFAULT ''"),
                ):
                    try:
                        cur.execute(
                            f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS {col} {tipo}"
                        )
                    except Exception:
                        pass
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'app_sync_settings'
                """
            )
            tr2 = cur.fetchone()
            if tr2:
                physical2 = tr2[0]
                sql_table2 = f'"{physical2}"' if physical2 != physical2.lower() else physical2
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table2} ADD COLUMN IF NOT EXISTS "
                        f"calendly_interval_minutes INTEGER NOT NULL DEFAULT 360"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_call_report_fields() -> None:
    """Columnas del formato nuevo (calificación/coaching) en call_report."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'call_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            for col in (
                "lead_nombre",
                "nivel_dolor",
                "capacidad_decision",
                "capacidad_economica",
                "fit_real",
                "objecion_diagnostico",
                "cambio_energia",
                "objecion_no_manejada",
                "razon_real_no_cerrar",
                "compromisos_prometidos",
                "patrones_y_mejoras",
            ):
                try:
                    cur.execute(
                        f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS {col} TEXT DEFAULT ''"
                    )
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_lead_calificacion_llamada() -> None:
    """Columna calificacion_llamada en lead (panel diario)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                f"calificacion_llamada TEXT DEFAULT ''"
            )
    finally:
        conn.close()


def _migrate_postgres_weekly_report_feedback_marketing() -> None:
    """Columna feedback_marketing en weekly_report."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'weekly_report'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                f"feedback_marketing TEXT DEFAULT ''"
            )
    finally:
        conn.close()


def _migrate_postgres_authuser_timezone() -> None:
    """Columna timezone en authuser (default America/Bogota)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'authuser'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"timezone VARCHAR(64) DEFAULT 'America/Bogota'"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"UPDATE {sql_table} SET timezone = 'America/Bogota' "
                    f"WHERE timezone IS NULL OR TRIM(timezone) = ''"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_ghl_appointment_id() -> None:
    """Columna ghl_appointment_id en lead (+ índice único parcial por user)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"ghl_appointment_id VARCHAR"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS lead_user_ghl_appointment_id_uidx "
                    f"ON {sql_table} (user_id, ghl_appointment_id) "
                    f"WHERE ghl_appointment_id IS NOT NULL AND TRIM(ghl_appointment_id) <> ''"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_ghl_contact_id() -> None:
    """Columna ghl_contact_id en lead + índice NO único + backfill desde notas."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"ghl_contact_id VARCHAR"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"CREATE INDEX IF NOT EXISTS lead_user_ghl_contact_id_idx "
                    f"ON {sql_table} (user_id, ghl_contact_id) "
                    f"WHERE ghl_contact_id IS NOT NULL AND TRIM(ghl_contact_id) <> ''"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"""
                    UPDATE {sql_table}
                    SET ghl_contact_id = (regexp_match(notas, 'GHL contact_id:\\s*(\\S+)', 'i'))[1]
                    WHERE (ghl_contact_id IS NULL OR TRIM(ghl_contact_id) = '')
                      AND notas ILIKE '%GHL contact_id:%'
                    """
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_lead_triajer() -> None:
    """Columnas triajer + triaje_hecho en lead (asignación y checklist del panel diario)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'lead'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"triajer VARCHAR DEFAULT ''"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"triaje_hecho BOOLEAN DEFAULT FALSE"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS "
                    f"outbound BOOLEAN NOT NULL DEFAULT FALSE"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_comprobante_url() -> None:
    """Agrega comprobante_url en lead y lead_payment."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            for sql in (
                "ALTER TABLE lead ADD COLUMN IF NOT EXISTS comprobante_url TEXT DEFAULT ''",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS comprobante_url TEXT DEFAULT ''",
            ):
                try:
                    cur.execute(sql)
                except Exception:
                    pass
    finally:
        conn.close()


def _migrate_postgres_lead_payment() -> None:
    """Crea `lead_payment` (historial de pagos; no modifica Lead.pago/debe)."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS lead_payment (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    lead_id INTEGER NOT NULL,
                    monto DOUBLE PRECISION NOT NULL DEFAULT 0,
                    fecha DATE NOT NULL,
                    nota TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_lead_payment_user_lead "
                    "ON lead_payment (user_id, lead_id)"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_lead_payment_lead_fecha "
                    "ON lead_payment (lead_id, fecha)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_offered_program_duration() -> None:
    """Añade duration_months al catálogo de programas."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'offered_program'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            try:
                cur.execute(
                    f"ALTER TABLE {sql_table} ADD COLUMN IF NOT EXISTS duration_months INTEGER NULL"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _migrate_postgres_crm_client() -> None:
    """Crea o migra `crm_client` vinculado a `lead`."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'crm_client'
                """
            )
            cols = {r[0] for r in cur.fetchall()}
            if cols and "lead_id" not in cols:
                cur.execute("DROP TABLE IF EXISTS crm_client")
                cols = set()
            if not cols:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS crm_client (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        lead_id INTEGER NOT NULL,
                        program_duration_months INTEGER NULL,
                        start_date DATE NULL,
                        sale_status TEXT NULL,
                        wins JSONB NOT NULL DEFAULT '[]'::jsonb,
                        notes TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                        updated_at TIMESTAMP NULL,
                        CONSTRAINT uq_crm_client_user_lead UNIQUE (user_id, lead_id)
                    )
                    """
                )
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_crm_client_user_id ON crm_client (user_id)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_crm_client_lead_id ON crm_client (lead_id)"
                )
            except Exception:
                pass
    finally:
        conn.close()


def _seed_offered_program_durations() -> None:
    """Premium / VIP → 6 meses en catálogo si aún no tienen duración."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND lower(table_name) = 'offered_program'
                """
            )
            tr = cur.fetchone()
            if not tr:
                return
            physical = tr[0]
            sql_table = f'"{physical}"' if physical != physical.lower() else physical
            cur.execute(
                f"""
                UPDATE {sql_table}
                SET duration_months = 6
                WHERE duration_months IS NULL
                  AND (
                    lower(name) LIKE '%premium%'
                    OR lower(name) LIKE '%vip%'
                  )
                """
            )
    finally:
        conn.close()


def _migrate_postgres_legacy_juano() -> None:
    """Trazabilidad migración CRM juano: source, legacy_id, columnas de negocio, legacy_cuota_ref."""
    if (config("DB_PROVIDER", default="") or "").strip().lower() != "postgres":
        return
    try:
        import psycopg2
    except ImportError:
        return
    try:
        conn = psycopg2.connect(
            user=config("DB_USER"),
            password=config("DB_PASS"),
            host=config("DB_HOST"),
            dbname=config("DB_NAME"),
        )
    except Exception:
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            lead_alters = [
                "ALTER TABLE lead ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'atv'",
                "ALTER TABLE lead ADD COLUMN IF NOT EXISTS legacy_id TEXT NULL",
                "ALTER TABLE lead ADD COLUMN IF NOT EXISTS closer_norm TEXT DEFAULT ''",
                "ALTER TABLE lead ADD COLUMN IF NOT EXISTS legacy_meta JSONB DEFAULT '{}'::jsonb",
            ]
            for sql in lead_alters:
                try:
                    cur.execute(sql)
                except Exception:
                    pass
            try:
                cur.execute("DROP INDEX IF EXISTS idx_lead_legacy_id")
            except Exception:
                pass
            pay_alters = [
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'atv'",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS legacy_id TEXT NULL",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS concepto TEXT DEFAULT ''",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS producto TEXT DEFAULT ''",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS metodo TEXT DEFAULT ''",
                "ALTER TABLE lead_payment ADD COLUMN IF NOT EXISTS legacy_meta JSONB DEFAULT '{}'::jsonb",
            ]
            for sql in pay_alters:
                try:
                    cur.execute(sql)
                except Exception:
                    pass
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS legacy_lead_ref (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    legacy_id TEXT NOT NULL,
                    lead_id INTEGER NULL,
                    rol TEXT NOT NULL,
                    motivo TEXT DEFAULT '',
                    payload JSONB DEFAULT '{}'::jsonb,
                    payload_history JSONB DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            ref_alters = [
                "ALTER TABLE legacy_lead_ref ADD COLUMN IF NOT EXISTS payload_history JSONB DEFAULT '[]'::jsonb",
            ]
            for sql in ref_alters:
                try:
                    cur.execute(sql)
                except Exception:
                    pass
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS legacy_cuota_ref (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    source TEXT DEFAULT 'atv',
                    legacy_id TEXT NULL,
                    lead_id INTEGER NULL,
                    alumno_raw TEXT DEFAULT '',
                    programa_raw TEXT DEFAULT '',
                    monto_total DOUBLE PRECISION NULL,
                    abonado DOUBLE PRECISION NULL,
                    saldo DOUBLE PRECISION NULL,
                    ultimo_cobro DATE NULL,
                    siguiente_cobro DATE NULL,
                    closer_raw TEXT DEFAULT '',
                    closer_norm TEXT DEFAULT '',
                    situacion_raw TEXT DEFAULT '',
                    cuota_label TEXT DEFAULT '',
                    match_score DOUBLE PRECISION NULL,
                    match_method TEXT DEFAULT '',
                    legacy_meta JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
                )
                """
            )
            indexes = [
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_legacy_id ON lead (legacy_id) WHERE legacy_id IS NOT NULL AND legacy_id <> ''",
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_payment_legacy_id ON lead_payment (legacy_id) WHERE legacy_id IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_lead_ref_legacy_id ON legacy_lead_ref (legacy_id)",
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_cuota_ref_legacy_id ON legacy_cuota_ref (legacy_id) WHERE legacy_id IS NOT NULL",
                "CREATE INDEX IF NOT EXISTS idx_lead_payment_user_source ON lead_payment (user_id, source)",
                "CREATE INDEX IF NOT EXISTS idx_lead_user_source ON lead (user_id, source)",
            ]
            for sql in indexes:
                try:
                    cur.execute(sql)
                except Exception:
                    pass
    finally:
        conn.close()


def init_db() -> None:
    import src.models  # noqa: F401 — registrar entidades Pony antes del mapping

    _migrate_postgres_authuser_timezone()
    _migrate_postgres_lead_call_to_timestamp()
    _migrate_postgres_lead_agendo_to_timestamp()
    _migrate_postgres_drop_pago_en_llamada()
    _migrate_postgres_drop_canal_agendo()
    _migrate_postgres_lead_setter_closer()
    _migrate_postgres_lead_closer_report()
    _migrate_postgres_lead_programada_ofrecido_llamada()
    _migrate_postgres_lead_recordatorio_enviado()
    _migrate_postgres_youtube_content()
    _migrate_postgres_storyslide_views_shares()
    _migrate_postgres_setter_report_text_columns()
    _migrate_postgres_team_report_breakdown()
    _migrate_postgres_closer_report_tipo()
    _migrate_postgres_closer_report_marketing_multiple_per_day()
    _migrate_postgres_remove_closer_marketing()
    _migrate_postgres_offered_program()
    _migrate_postgres_avatar_type()
    _migrate_postgres_seguimiento_report()
    _migrate_postgres_hot_lead()
    _migrate_postgres_lead_calendly_fields()
    _migrate_postgres_call_report_fields()
    _migrate_postgres_lead_calificacion_llamada()
    _migrate_postgres_weekly_report_feedback_marketing()
    _migrate_postgres_lead_formulario_drop_embudo_fields()
    _migrate_postgres_drop_lead_ingresos()
    _migrate_postgres_lead_ghl_appointment_id()
    _migrate_postgres_lead_ghl_contact_id()
    _migrate_postgres_lead_triajer()
    _migrate_postgres_lead_payment()
    _migrate_postgres_comprobante_url()
    _migrate_postgres_offered_program_duration()
    _seed_offered_program_durations()
    _migrate_postgres_crm_client()
    _migrate_postgres_legacy_juano()
    db.generate_mapping(create_tables=True)
    _migrate_agendo_en_iso_to_call()
    _migrate_agendo_en_default_chat_when_agendado()
