from datetime import date, datetime
from pony.orm import Json, Optional, PrimaryKey, Required, Set, composite_key
from src.db import db


class AuthUser(db.Entity):
    id = PrimaryKey(int, auto=True)
    username = Required(str, unique=True)
    password_hash = Required(str)
    timezone = Optional(str, default="America/Bogota")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class ApiConnection(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    platform = Required(str)
    credentials = Required(Json, default=lambda: {})
    last_sync_at = Optional(datetime)
    updated_at = Optional(datetime)

    composite_key(user_id, platform)


class StorySequence(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    sequence_date = Required(date)
    title = Optional(str, default="")
    dolor = Optional(str, default="")
    angulo = Optional(str, default="")
    cta = Optional(str, default="")
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    has_cta = Required(bool, default=False)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)
    slides = Set("StorySlide")


class StorySlide(db.Entity):
    id = PrimaryKey(int, auto=True)
    sequence = Required(StorySequence, column="sequence_id")
    order_index = Required(int)
    instagram_media_id = Optional(str)
    image_url = Optional(str)
    # views = reproducciones/impresiones (Graph `views`); reach = cuentas únicas (Graph `reach`)
    views = Optional(int)
    reach = Optional(int)
    shares = Optional(int)
    replies = Optional(int)
    navigation = Optional(int)
    profile_visits = Optional(int)
    synced_at = Optional(datetime)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class ReelContent(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    instagram_id = Required(str, unique=True)
    title = Optional(str)
    thumbnail_url = Optional(str)
    permalink = Optional(str)
    fecha_publicacion = Optional(datetime)
    # Métricas Instagram
    plays = Required(int, default=0)
    reach = Required(int, default=0)
    likes = Required(int, default=0)
    comentarios = Required(int, default=0)
    shares = Required(int, default=0)
    guardados = Required(int, default=0)
    # Campos negocio
    keyword = Optional(str)
    cash = Required(float, default=0)
    chats_manuales = Required(int, default=0)
    dolor = Optional(str)
    angulos = Optional(str)
    cta = Optional(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class YoutubeContent(db.Entity):
    """Videos de YouTube sincronizados (Data API v3) por usuario."""

    _table_ = "youtubecontent"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    external_id = Required(str)  # id del video en YouTube
    title = Optional(str)
    description = Optional(str, default="")
    thumbnail_url = Optional(str)
    published_at = Optional(datetime)
    url = Optional(str)
    duration_seconds = Optional(int)
    views = Required(int, default=0)
    likes = Required(int, default=0)
    comments_count = Required(int, default=0)
    # Analytics (YouTube Studio) no están en Data API v3 estándar; quedan para futuro / manual
    ctr = Optional(float)
    impressions = Optional(int)
    retention = Optional(float)
    avg_view_duration_seconds = Optional(int)
    performance_history = Required(Json, default=lambda: [])
    classification = Required(Json, default=lambda: {})
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    notes = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, external_id)


class MasterList(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    category = Required(str)
    items = Required(Json, default=lambda: [])
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, category)


class OfferedProgram(db.Entity):
    """Programas ofrecibles en leads (nombre + precio USD para facturación)."""

    _table_ = "offered_program"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    name = Required(str)
    price_usd = Required(float, default=0)
    duration_months = Optional(int)
    sort_order = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class AvatarType(db.Entity):
    """Tipos de avatar/perfil de lead (nombre + color para badges en la grilla)."""

    _table_ = "avatar_type"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    nombre = Required(str)
    color = Required(str, default="#6B7280")
    activo = Required(bool, default=True)
    sort_order = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class Lead(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    source = Optional(str, default="atv")
    legacy_id = Optional(str)
    # Identificación (Optional(str) con default="" para evitar None al instanciar en Pony)
    nombre = Optional(str, default="")
    ig = Optional(str, default="")
    telefono = Optional(str, default="")
    email = Optional(str, default="")
    avatar = Optional(str, default="")
    origen = Optional(str, default="")
    keyword = Optional(str, default="")
    content_url = Optional(str, default="")
    fecha_bot = Optional(datetime)
    respondio_auto = Optional(bool, default=False)
    manychat_contact_id = Optional(str, default="")
    # Calificación
    status = Optional(str, default="")
    # Legacy CRM / panel: "Sí" | "No" | "Por tomar" | ""
    presento = Optional(str, default="")
    punto_agenda = Optional(str, default="")
    # Agenda (agendo = cuándo completó el formulario / webhook Calendly; call = slot elegido; agendo_en = canal)
    agendo = Optional(datetime)
    agendo_en = Optional(str)
    call = Optional(datetime)
    # Id del evento GHL (/calendars/events → event.id). Upsert idempotente del sync.
    ghl_appointment_id = Optional(str)
    # Contacto GHL (puede repetirse: varias citas por persona). Índice NO único.
    ghl_contact_id = Optional(str)
    # Formulario GHL calendar (7 preguntas de calificación; contacto va en nombre/ig/email/telefono)
    formulario = Optional(Json, default=lambda: {})
    link_llamada = Optional(str, default="")
    # Negocio (setter/closer/triajer = nombre en `teammember`, texto libre para compatibilidad)
    setter = Optional(str, default="")
    closer = Optional(str, default="")
    closer_norm = Optional(str, default="")
    triajer = Optional(str, default="")
    triaje_hecho = Optional(bool, default=False)
    outbound = Optional(bool, default=False)
    dolores_setting = Optional(str, default="")
    dolores_llamada = Optional(str, default="")
    closer_report = Optional(str, default="")
    razon_compra = Optional(str, default="")
    programa_ofrecido = Optional(str, default="")
    programada_ofrecido_llamada = Optional(str, default="")
    # Ventas
    pago = Optional(float, default=0)
    debe = Optional(float, default=0)
    # URL relativa bajo /media (ej. /media/comprobantes/1/uuid.jpg)
    comprobante_url = Optional(str, default="")
    estado = Optional(str, default="")
    calificacion_llamada = Optional(str, default="")
    notas = Optional(str, default="")
    legacy_meta = Optional(Json, default=lambda: {})
    recordatorio_enviado = Optional(bool, default=False)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class HotLead(db.Entity):
    _table_ = "hot_lead"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    nombre = Optional(str, default="")
    ig = Optional(str, default="")
    avatar = Optional(str, default="")
    seguidores = Optional(str, default="")
    calidad = Optional(str, default="")
    fecha = Optional(date)
    status = Optional(str, default="Prospectar")
    notas = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class TeamMember(db.Entity):
    _table_ = "teammember"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    nombre = Required(str)
    rol = Required(str)  # 'setter' | 'closer' | 'cash' | 'triajer'
    activo = Required(bool, default=True)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class SetterReport(db.Entity):
    _table_ = "setter_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    fecha = Required(date)
    conversaciones = Required(int, default=0)
    agendas = Required(int, default=0)
    links_enviados = Required(int, default=0)
    notas = Optional(str, default="")
    sentimiento_trafico = Optional(str, default="")
    avatar_tipo_agendas = Optional(str, default="")
    insights_marketing = Optional(str, default="")
    leads_nuevos = Required(int, default=0)
    seguimientos = Required(int, default=0)
    outbounds = Required(int, default=0)
    conversaciones_stories = Required(int, default=0)
    conversaciones_reels = Required(int, default=0)
    agendas_stories = Required(int, default=0)
    agendas_reels = Required(int, default=0)
    agendas_ads = Required(int, default=0)
    links_enviados_stories = Required(int, default=0)
    links_enviados_reels = Required(int, default=0)
    dia_bueno_malo = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class CloserReport(db.Entity):
    _table_ = "closer_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    fecha = Required(date)
    llamadas_agendadas = Required(int, default=0)
    shows = Required(int, default=0)
    cierres = Required(int, default=0)
    shows_organico = Required(int, default=0)
    shows_ads = Required(int, default=0)
    cierres_organico = Required(int, default=0)
    cierres_ads = Required(int, default=0)
    reservas = Required(int, default=0)
    seguimiento = Required(int, default=0)
    facturacion = Required(float, default=0)
    calificados = Required(int, default=0)
    descalificados = Required(int, default=0)
    ingreso = Required(float, default=0)
    notas = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class CallReport(db.Entity):
    """Análisis de llamada Fathom (1 link = 1 reporte)."""

    _table_ = "call_report"

    id = PrimaryKey(int, auto=True)
    lead_id = Required(int, index=True)
    lead_nombre = Optional(str, default="")
    fathom_url = Required(str, unique=True)
    estado = Required(str, default="pendiente")
    error_msg = Optional(str, default="")
    participantes = Optional(str, default="")
    motivo_reunion = Optional(str, default="")
    nivel_dolor = Optional(str, default="")
    capacidad_decision = Optional(str, default="")
    capacidad_economica = Optional(str, default="")
    fit_real = Optional(str, default="")
    objecion_diagnostico = Optional(str, default="")
    cambio_energia = Optional(str, default="")
    objecion_no_manejada = Optional(str, default="")
    razon_real_no_cerrar = Optional(str, default="")
    compromisos_prometidos = Optional(str, default="")
    patrones_y_mejoras = Optional(str, default="")
    resumen = Optional(str, default="")
    hubo_objeciones = Optional(str, default="")
    tipo_perfil = Optional(str, default="")
    ingresos_estimados = Optional(str, default="")
    situacion_y_deseo = Optional(str, default="")
    closer_report = Optional(str, default="")
    dolores_llamada = Optional(str, default="")
    razon_compra = Optional(str, default="")
    program_offered = Optional(str, default="")
    status_llamada = Optional(str, default="")
    user_id = Required(int, index=True)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class WeeklyReport(db.Entity):
    """Reporte semanal generado por Claude (análisis Fathom + reportes diarios closer)."""

    _table_ = "weekly_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    semana_inicio = Required(date)
    semana_fin = Required(date)
    contenido = Optional(str, default="")
    estado = Required(str, default="pendiente")
    error_msg = Optional(str, default="")
    llamadas_count = Required(int, default=0)
    closer_dias_count = Required(int, default=0)
    feedback_marketing = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class AppSyncSettings(db.Entity):
    """Config global del servidor: intervalos de sync automático (singleton id=1)."""

    _table_ = "app_sync_settings"

    id = PrimaryKey(int)
    stories_interval_minutes = Required(int, default=5)
    reels_interval_minutes = Required(int, default=1440)
    calendly_interval_minutes = Required(int, default=360)
    updated_at = Optional(datetime)


class SeguimientoReport(db.Entity):
    """Cobranzas / seguimiento declaradas por setter, closer o cash; suman a cash collected del mes."""

    _table_ = "seguimiento_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    fecha = Required(date)
    nombre_lead = Required(str)
    monto = Required(float, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class LeadPayment(db.Entity):
    """Historial de pagos de un lead. Independiente de Lead.pago / Lead.debe."""

    _table_ = "lead_payment"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    lead_id = Required(int, index=True)
    source = Optional(str, default="atv")
    legacy_id = Optional(str)
    monto = Required(float, default=0)
    fecha = Required(date)
    concepto = Optional(str, default="")
    producto = Optional(str, default="")
    metodo = Optional(str, default="")
    nota = Optional(str, default="")
    comprobante_url = Optional(str, default="")
    legacy_meta = Optional(Json, default=lambda: {})
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class LegacyLeadRef(db.Entity):
    """Trazabilidad por fila de leads.csv (ganador, absorbida o nueva)."""

    _table_ = "legacy_lead_ref"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    legacy_id = Required(str, unique=True)
    lead_id = Optional(int, index=True)
    rol = Required(str)
    motivo = Optional(str, default="")
    payload = Optional(Json, default=lambda: {})
    payload_history = Optional(Json, default=lambda: [])
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class LegacyCuotaRef(db.Entity):
    """Snapshot histórico de cuotas del CRM juano (no fuente de saldos en ATV)."""

    _table_ = "legacy_cuota_ref"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    source = Optional(str, default="atv")
    legacy_id = Optional(str)
    lead_id = Optional(int)
    alumno_raw = Optional(str, default="")
    programa_raw = Optional(str, default="")
    monto_total = Optional(float)
    abonado = Optional(float)
    saldo = Optional(float)
    ultimo_cobro = Optional(date)
    siguiente_cobro = Optional(date)
    closer_raw = Optional(str, default="")
    closer_norm = Optional(str, default="")
    situacion_raw = Optional(str, default="")
    cuota_label = Optional(str, default="")
    match_score = Optional(float)
    match_method = Optional(str, default="")
    legacy_meta = Optional(Json, default=lambda: {})
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class CrmClient(db.Entity):
    """Datos CRM post-venta vinculados a un lead (programa, avance, wins)."""

    _table_ = "crm_client"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    lead_id = Required(int)
    program_duration_months = Optional(int)
    start_date = Optional(date)
    sale_status = Optional(str)  # override; si null se infiere del lead
    wins = Required(Json, default=lambda: [])
    notes = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, lead_id)
