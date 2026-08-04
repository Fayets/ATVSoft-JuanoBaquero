from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


class AuthRegisterRequest(BaseModel):
    username: str
    password: str


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int


class AuthMeResponse(BaseModel):
    username: str


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthChangePasswordResponse(BaseModel):
    status: str = "ok"


class MasterListUpsertRequest(BaseModel):
    items: list[str] = Field(default_factory=list)


class MasterListAddItemRequest(BaseModel):
    item: str = ""


class MasterListsResponse(BaseModel):
    dolores: list[str] = Field(default_factory=list)
    angulos: list[str] = Field(default_factory=list)
    ctas: list[str] = Field(default_factory=list)


class OfferedProgramOut(BaseModel):
    id: int
    name: str
    price_usd: float
    sort_order: int


class OfferedProgramsListResponse(BaseModel):
    programs: list[OfferedProgramOut] = Field(default_factory=list)


class OfferedProgramCreateRequest(BaseModel):
    name: str = ""
    price_usd: float = 0


class OfferedProgramPatchRequest(BaseModel):
    name: str | None = None
    price_usd: float | None = None
    sort_order: int | None = None


class AvatarTypeOut(BaseModel):
    id: int
    nombre: str
    color: str
    activo: bool
    sort_order: int


class AvatarTypesListResponse(BaseModel):
    avatars: list[AvatarTypeOut] = Field(default_factory=list)


class AvatarTypeCreateRequest(BaseModel):
    nombre: str = ""
    color: str = "#6B7280"
    activo: bool = True


class AvatarTypePatchRequest(BaseModel):
    nombre: str | None = None
    color: str | None = None
    activo: bool | None = None
    sort_order: int | None = None


class ApiConnectionResponse(BaseModel):
    id: str
    user_id: str
    platform: str
    credentials: dict[str, Any] = Field(default_factory=dict)
    last_sync_at: datetime | None = None
    updated_at: datetime | None = None


class ApiConnectionUpsertRequest(BaseModel):
    credentials: dict[str, Any] = Field(default_factory=dict)


class ReelResponse(BaseModel):
    id: str
    title: str | None = None
    content_type: str
    platform: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    classification: dict[str, Any] = Field(default_factory=dict)
    cash: float = 0
    chats: int = 0
    published_at: datetime | None = None
    url: str | None = None
    notes: str | None = None
    external_id: str
    keyword: str | None = None
    content_url: str | None = None
    chats_count: int = 0
    manual_cash: float | None = None
    manual_chats: int | None = None
    cash_total: float = 0
    cpc: float = Field(0, description="Cash por chat (cash ÷ chats).")
    agendas: int = 0


class ReelsListResponse(BaseModel):
    reels: list[ReelResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 0
    available_months: list[str] = Field(default_factory=list)
    total_cash: float = 0
    total_chats: int = 0


class ReelPatchRequest(BaseModel):
    cash: float | None = None
    chats: int | None = None
    chats_manuales: int | None = None
    dolor: str | None = None
    angulos: str | None = None
    cta: str | None = None



class ReelKeywordPatchRequest(BaseModel):
    keyword: str | None = None


class ReelsSyncRequest(BaseModel):
    limit: int | None = None


class ReelsSyncRangeDiscoverRequest(BaseModel):
    """Sin parámetros: cuenta todos los reels de la cuenta de Instagram conectada (vista previa rápida)."""


class ReelsSyncRangeImportRequest(BaseModel):
    take: int = Field(ge=1, description="Cantidad de reels a importar (≤ total hallado en discover).")


class ReelsSyncResponse(BaseModel):
    success: bool
    total: int = 0
    new: int = 0
    updated: int = 0
    detail: str | None = None


class ReelsMetricsOut(BaseModel):
    chats_del_mes: int
    piezas_publicadas: int
    reels_con_cta: int
    reels_sin_cta: int


class ManychatChatResponse(BaseModel):
    id: str
    keyword: str
    contact_name: str | None = None
    contact_ig_username: str | None = None
    received_at: datetime
    """ID suscriptor ManyChat (si viene de la API live)."""
    manychat_subscriber_id: str | None = None
    """Último texto que envió el contacto (API ManyChat), suele ser la keyword."""
    manychat_last_input: str | None = None
    """Resumen de custom fields del suscriptor (para contexto / bio)."""
    manychat_custom_fields_preview: str | None = None
    lead_airtable_record_id: str | None = None  # ID externo legacy (opcional)
    lead_status: str | None = None
    lead_client_name: str | None = None
    lead_program_offered: str | None = None
    lead_payment: float | None = None
    lead_revenue: float | None = None
    lead_ig_bio_snapshot: str | None = None
    lead_automation_reply_snapshot: str | None = None


class BioManualEntryResponse(BaseModel):
    id: str
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioDataResponse(BaseModel):
    auto_chats: list[ManychatChatResponse] = Field(default_factory=list)
    manual_entries: list[BioManualEntryResponse] = Field(default_factory=list)
    is_connected: bool = False
    available_months: list[str] = Field(default_factory=list)
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    manychat_bio_tag_reply_id: int | None = None


class ManychatLiveSummaryResponse(BaseModel):
    page_name: str | None = None
    category: str | None = None
    timezone: str | None = None
    tags_count: int = 0
    growth_tools_count: int = 0
    custom_fields_count: int = 0
    bot_fields_count: int = 0
    sample_tags: list[str] = Field(default_factory=list)
    sample_growth_tools: list[str] = Field(default_factory=list)


class ManychatAutomationStatsResponse(BaseModel):
    """
    Métricas aproximadas para la automatización BIO.
    ManyChat no documenta un endpoint público equivalente al panel (envíos, % abierto por nodo);
    usamos getFlows + conteo de contactos por tags configurados.
    """

    info_note: str | None = None
    flow_found: bool = False
    flow_name: str | None = None
    flow_ns: str | None = None
    """Objeto del flow devuelto por getFlows (puede incluir campos extra según versión de API)."""
    flow_raw: dict[str, Any] = Field(default_factory=dict)
    getflows_error: str | None = None

    entry_tag_id: int | None = None
    entry_tag_name: str | None = None
    entry_contacts_count: int = 0
    entry_tag_error: str | None = None

    reply_tag_id: int | None = None
    reply_tag_name: str | None = None
    reply_contacts_count: int = 0
    reply_tag_error: str | None = None

    reply_rate_percent: float | None = None


class BioManualEntryCreateRequest(BaseModel):
    month: str | None = None
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioAutomationConfigRequest(BaseModel):
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    """Tag ManyChat de quienes completan el embudo (ej. 'responde la auto de la bio')."""
    manychat_bio_tag_reply_id: int | None = None


class BioLeadResponse(BaseModel):
    id: str
    handle: str
    nombre: str | None = None
    avatar_url: str | None = None
    subscribed_at: str | None = None
    keyword: str | None = None
    """Origen / canal (ej. Perfil, Automático - ManyChat)."""
    via: str | None = None
    airtable_found: bool = False
    airtable_record_id: str | None = None
    status: str | None = None
    setter: str | None = None
    programa: str | None = None
    pago: float | None = None
    fecha_agendo: str | None = None
    llamada_url: str | None = None
    dolores: str | None = None
    razon_compra: str | None = None
    notas: str | None = None
    manychat_chat_url: str | None = None
    respondio_auto: bool = False
    # Campos tabla Lead (Neon)
    content_url: str | None = None
    manychat_contact_id: str | None = None
    programa_ofrecido: str | None = None
    fecha_bot: str | None = None
    agendo: bool = False


class BioLeadsListResponse(BaseModel):
    leads: list[BioLeadResponse] = Field(default_factory=list)
    manychat_active: bool = True
    connected_to_airtable: bool = False
    bio_profile_keyword: str = Field(default="info", description="Keyword de bio configurada en ManyChat")


class BioLeadStatusPatchRequest(BaseModel):
    status: str


class BioLeadDescriptionPatchRequest(BaseModel):
    bio_descripcion: str | None = None


class BioMetricsResponse(BaseModel):
    total_leads: int = 0
    agendaron: int = 0
    cerrados: int = 0
    tasa_agenda: float = 0
    cash_total: float = 0
    cash_por_chat: float = 0
    respondio_auto: int = 0
    tasa_respuesta_auto: float | None = None
    cash_por_lead: float = 0
    tasa_conversion: float = Field(default=0, description="Alias de tasa_agenda (compatibilidad vista BIO)")


class BioManychatStatusResponse(BaseModel):
    connected: bool = False
    tag: str = ""
    total_subscribers: int = 0


class BioViaOptionsResponse(BaseModel):
    """Valores únicos del campo Vía en leads."""

    options: list[str] = Field(default_factory=list)


class StorySlideIn(BaseModel):
    order_index: int
    image_url: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None


class StorySequenceIn(BaseModel):
    sequence_date: date
    title: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None
    cash_generado: int | None = None
    has_cta: bool = False
    chats: int | None = None
    slides: list[StorySlideIn] = Field(default_factory=list)


class StorySequencePatchRequest(BaseModel):
    dolor: str | None = None
    angulos: str | None = None
    angulo: str | None = None
    cta: bool | None = None
    cta_text: str | None = None
    cash_manual: int | None = None
    chats: int | None = None


class StorySlideOut(BaseModel):
    id: int
    order_index: int
    image_url: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None
    instagram_media_id: str | None = None
    views: int | None = None
    reach: int | None = None
    shares: int | None = None
    like_count: int | None = None
    replies: int | None = None
    navigation: int | None = None
    profile_visits: int | None = None
    synced_at: str | None = None


class StorySequenceOut(BaseModel):
    id: int
    sequence_date: str
    title: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None
    cash_generado: int = 0
    cash_manual: int = 0
    cash_leads: int = 0
    agendas: int = 0
    has_cta: bool
    chats: int
    slides: list[StorySlideOut] = Field(default_factory=list)
    created_at: str


class StoriesMetricsOut(BaseModel):
    chats_del_mes: int
    secuencias_con_cta: int
    secuencias_sin_cta: int
    stories_sincronizadas: int


class YoutubeVideoPatchRequest(BaseModel):
    cash_manual: int | None = None


class LeadOut(BaseModel):
    """Paridad con `Lead` en BD + campos que usa la tabla del frontend."""

    id: str
    lead_user_id: str = Field(..., description="user_id del dueño del lead (columna user_id en BD)")
    client_name: str = ""
    ig_handle: str | None = None
    phone: str | None = None
    avatar_type: str | None = None
    status: str = "Pendiente"
    origin: str | None = None
    entry_funnel: str | None = None
    keyword: str | None = Field(default=None, description="keyword en BD (ManyChat / reel)")
    agenda_point: str | None = None
    fecha_bot: str | None = None
    scheduled_at: str | None = Field(
        default=None,
        description="Fecha/hora de la llamada (columna call en BD; Calendly).",
    )
    agendo: str | None = Field(
        default=None,
        description="ISO: momento en que completó el formulario Calendly (webhook invitee.created).",
    )
    agendo_en: str | None = Field(
        default=None,
        description='Canal donde agendó: "Chat", "Youtube" (columna agendo_en en BD, texto).',
    )
    call_at: str | None = None
    call: str | None = Field(default=None, description="ISO fecha/hora de la cita (misma columna `call` en BD)")
    call_link: str | None = None
    closer_report: str | None = None
    program_offered: str | None = Field(
        default=None,
        description="Programa comprado / facturación (columna `programa_ofrecido` en BD).",
    )
    programada_ofrecido_llamada: str | None = Field(
        default=None,
        description="Programa ofrecido en la llamada (solo CRM; no entra en facturación). Columna `programada_ofrecido_llamada`.",
    )
    program_price_usd: float | None = Field(
        default=None,
        description="Precio USD del catálogo (OfferedProgram) si coincide `programa_ofrecido` en BD.",
    )
    revenue: float = 0
    payment: float = 0
    owed: float = 0
    comprobante_url: str | None = None
    closer: str | None = None
    setter: str | None = None
    triajer: str | None = None
    triaje_hecho: bool | None = None
    notes: str | None = None
    date: str
    month: str | None = None
    email: str | None = None
    dolores_setting: str | None = None
    dolores_llamada: str | None = None
    razon_compra: str | None = None
    formulario: dict[str, str] = Field(
        default_factory=dict,
        description="7 respuestas del formulario GHL calendar (keys: forma_agendamiento, conoce_juano, …).",
    )
    calendly_event_uri: str | None = None
    calendly_invitee_uri: str | None = None
    source_type: str | None = None
    content_url: str | None = None
    manychat_contact_id: str | None = None
    respondio_auto: bool | None = None


class LeadsListResponse(BaseModel):
    leads: list[LeadOut] = Field(default_factory=list)


class LeadsMetricsOut(BaseModel):
    """Agregados del mes para el dashboard (todos los leads del usuario, no solo BIO)."""

    total_leads: int = 0
    agendaron: int = 0
    cash_total: float = 0
    cash_por_chat: float = 0


class LeadPatchRequest(BaseModel):
    """Campos opcionales alineados con `LeadOut` / tabla de leads (solo los que existen en BD)."""

    client_name: str | None = None
    ig_handle: str | None = None
    phone: str | None = None
    avatar_type: str | None = None
    status: str | None = None
    origin: str | None = None
    origen: str | None = Field(default=None, description="Alias de origin en PATCH (JSON en español)")
    entry_funnel: str | None = None
    keyword: str | None = None
    agenda_point: str | None = None
    punto_agenda: str | None = Field(
        default=None,
        description="Alias de agenda_point → columna punto_agenda en BD",
    )
    scheduled_at: str | None = None
    agendo_en: str | None = Field(
        default=None,
        description='Chat | Youtube → columna agendo_en (texto) en BD.',
    )
    agendo: str | None = Field(
        default=None,
        description="ISO → cuándo completó el formulario (columna agendo en BD).",
    )
    call: str | None = Field(default=None, description="ISO fecha/hora → columna call (alias de scheduled_at)")
    call_link: str | None = None
    program_offered: str | None = None
    programada_ofrecido_llamada: str | None = None
    revenue: float | None = None
    payment: float | None = None
    owed: float | None = None
    comprobante_url: str | None = None
    notes: str | None = None
    dolores_setting: str | None = None
    dolores_llamada: str | None = None
    closer_report: str | None = None
    razon_compra: str | None = None
    formulario: dict[str, str] | None = Field(
        default=None,
        description="Parcial o completo: 7 keys del formulario GHL.",
    )
    setter: str | None = None
    closer: str | None = None
    triajer: str | None = None
    triaje_hecho: bool | None = None
    calificacion_llamada: str | None = Field(
        default=None,
        description='"" | "calificado" | "descalificado" — panel diario.',
    )


class ManualCallCreateRequest(BaseModel):
    """Alta de llamada manual del panel diario (lead visible en tabla leads)."""

    client_name: str = Field(min_length=1, max_length=500)
    closer: str = Field(min_length=1, max_length=200)
    hora: str = Field(
        min_length=4,
        max_length=5,
        description="Hora Argentina HH:MM para la llamada de hoy.",
    )
    ig_handle: str | None = None


class LeadCreateRequest(BaseModel):
    """Alta manual de lead (cuenta como agendado para listados y métricas del mes)."""

    client_name: str = Field(min_length=1, max_length=500)
    ig_handle: str | None = None
    phone: str | None = None
    notes: str | None = None
    month: str | None = Field(
        default=None,
        description="YYYY-MM mes operativo (fecha_bot / agendo); si se omite, mes actual en Argentina.",
    )
    status: str | None = Field(default="Pendiente")


class KeywordClientRow(BaseModel):
    """Lead con keyword y reel asociado (misma keyword que un reel del usuario, si existe)."""

    lead_id: str
    nombre: str = ""
    instagram: str = ""
    reel_id: str | None = Field(default=None, description="ID interno del reel (BD), si existe match por keyword.")
    reel_permalink: str | None = None
    reel_published_at: str | None = Field(
        default=None,
        description="Fecha de publicación del reel (YYYY-MM-DD), si existe.",
    )
    keyword: str


class KeywordsReelOption(BaseModel):
    id: str
    label: str


class KeywordsMetrics(BaseModel):
    total_rows: int = 0
    unique_leads: int = 0
    unique_keywords: int = 0
    rows_with_reel: int = 0
    unique_reels: int = 0


class KeywordsSeriesDay(BaseModel):
    day: str = Field(description="YYYY-MM-DD")
    rows: int = 0
    leads: int = 0


class KeywordsTopKeyword(BaseModel):
    keyword: str
    rows: int = 0
    leads: int = 0


class KeywordsTopReel(BaseModel):
    reel_id: str
    label: str
    rows: int = 0


class KeywordsMetricsResponse(BaseModel):
    metrics: KeywordsMetrics = Field(default_factory=KeywordsMetrics)
    series_days: list[KeywordsSeriesDay] = Field(default_factory=list)
    top_keywords: list[KeywordsTopKeyword] = Field(default_factory=list)
    top_reels: list[KeywordsTopReel] = Field(default_factory=list)
    reels: list[KeywordsReelOption] = Field(default_factory=list)


class KeywordsListResponse(BaseModel):
    rows: list[KeywordClientRow] = Field(default_factory=list)
    total: int = 0
    reels: list[KeywordsReelOption] = Field(
        default_factory=list,
        description="Opciones de reels con keyword para filtro en frontend.",
    )
    metrics: KeywordsMetrics = Field(default_factory=KeywordsMetrics)


class SyncSettingsOut(BaseModel):
    stories_interval_minutes: int
    reels_interval_minutes: int
    calendly_interval_minutes: int = 360
    stories_next_sync: str | None = None
    reels_next_sync: str | None = None
    calendly_next_sync: str | None = None
    # 0 = desactivado; si activo, el mínimo efectivo es 1 (Calendly 60).
    min_interval_minutes: int = 0
    max_interval_minutes: int = 10080
    min_calendly_interval_minutes: int = 0
    max_calendly_interval_minutes: int = 10080
    disabled_interval_minutes: int = 0


class SyncSettingsPatch(BaseModel):
    stories_interval_minutes: int | None = Field(
        default=None,
        ge=0,
        description="Minutos entre sync de historias. 0 = desactivado.",
    )
    reels_interval_minutes: int | None = Field(
        default=None,
        ge=0,
        description="Minutos entre refresh de métricas de reels. 0 = desactivado.",
    )
    calendly_interval_minutes: int | None = Field(
        default=None,
        ge=0,
        description="Minutos entre auto-check Calendly. 0 = desactivado.",
    )


class UserSettingsOut(BaseModel):
    timezone: str = "America/Bogota"


class UserTimezonePut(BaseModel):
    timezone: str = Field(..., min_length=1, max_length=64)


class CallReportOut(BaseModel):
    id: str
    lead_id: str
    lead_nombre: str = ""
    fathom_url: str
    estado: str
    error_msg: str | None = None
    participantes: str | None = None
    motivo_reunion: str | None = None
    nivel_dolor: str | None = None
    capacidad_decision: str | None = None
    capacidad_economica: str | None = None
    fit_real: str | None = None
    objecion_diagnostico: str | None = None
    cambio_energia: str | None = None
    objecion_no_manejada: str | None = None
    razon_real_no_cerrar: str | None = None
    compromisos_prometidos: str | None = None
    patrones_y_mejoras: str | None = None
    resumen: str | None = None
    hubo_objeciones: str | None = None
    tipo_perfil: str | None = None
    ingresos_estimados: str | None = None
    situacion_y_deseo: str | None = None
    closer_report: str | None = None
    dolores_llamada: str | None = None
    razon_compra: str | None = None
    program_offered: str | None = None
    status_llamada: str | None = None
    created_at: str
    updated_at: str | None = None


class CallReportsListResponse(BaseModel):
    call_reports: list[CallReportOut] = Field(default_factory=list)


class CallReportAnalyzeRequest(BaseModel):
    lead_id: int
    fathom_url: str


class CallReportAnalyzeResponse(BaseModel):
    report_id: int
    estado: str


class CallReportBulkIdsRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


class ClaudeApiStatusResponse(BaseModel):
    status: str
    message: str
    api_key_masked: str | None = None


class FathomApiStatusResponse(BaseModel):
    status: str
    message: str
    api_key_masked: str | None = None


class HotLeadOut(BaseModel):
    id: str
    nombre: str = ""
    ig: str = ""
    avatar: str = ""
    seguidores: str = ""
    calidad: str = ""
    fecha: str | None = None
    status: str = "Prospectar"
    notas: str = ""
    created_at: str
    month: str | None = None


class HotLeadsListResponse(BaseModel):
    hot_leads: list[HotLeadOut] = Field(default_factory=list)


class HotLeadCreateRequest(BaseModel):
    nombre: str = Field(default="", max_length=500)
    ig: str | None = None
    avatar: str | None = None
    seguidores: str | None = None
    calidad: str | None = None
    fecha: str | None = Field(default=None, description="YYYY-MM-DD")
    status: str | None = Field(default="Prospectar")
    notas: str | None = None
    month: str | None = Field(
        default=None,
        description="YYYY-MM mes operativo para anclar fecha si se omite.",
    )


class HotLeadPatchRequest(BaseModel):
    nombre: str | None = None
    ig: str | None = None
    avatar: str | None = None
    seguidores: str | None = None
    calidad: str | None = None
    fecha: str | None = None
    status: str | None = None
    notas: str | None = None


class AgentResumenProgramaOut(BaseModel):
    nombre: str
    ventas: int
    ingresos: float


class AgentResumenPorSemanaOut(BaseModel):
    agendas: list[int] = Field(default_factory=lambda: [0, 0, 0, 0])
    cierres: list[int] = Field(default_factory=lambda: [0, 0, 0, 0])


class AgentResumenOut(BaseModel):
    month: str
    conversaciones: int
    leads_nuevos: int
    agendas: int
    shows: int
    cierres: int
    ingresos: float
    facturacion: float
    close_rate: float
    show_rate: float
    tasa_agendamiento: float
    ticket_promedio: float
    cash_por_chat: float
    programas: list[AgentResumenProgramaOut] = Field(default_factory=list)
    por_semana: AgentResumenPorSemanaOut


class AgentContenidoReelTopOut(BaseModel):
    label: str
    fecha: str
    plays: int
    reach: int
    chats: int
    cash: float


class AgentContenidoReelsOut(BaseModel):
    piezas_publicadas: int = 0
    chats_generados: int = 0
    reels_con_cta: int = 0
    reels_sin_cta: int = 0
    top: list[AgentContenidoReelTopOut] = Field(default_factory=list)


class AgentContenidoHistoriasOut(BaseModel):
    secuencias: int = 0
    chats_generados: int = 0
    secuencias_con_cta: int = 0
    cash: float = 0


class AgentContenidoYoutubeOut(BaseModel):
    videos: int = 0
    views: int = 0
    chats_generados: int = 0
    cash: float = 0


class AgentContenidoBioOut(BaseModel):
    total_leads: int = 0
    agendaron: int = 0
    cerrados: int = 0
    tasa_agenda: float = 0
    tasa_conversion: float = 0
    cash: float = 0


class AgentContenidoKeywordTopOut(BaseModel):
    keyword: str
    leads: int
    reel_label: str


class AgentContenidoOut(BaseModel):
    month: str
    reels: AgentContenidoReelsOut
    historias: AgentContenidoHistoriasOut
    youtube: AgentContenidoYoutubeOut
    bio: AgentContenidoBioOut
    keywords_top: list[AgentContenidoKeywordTopOut] = Field(default_factory=list)


class AgentLlamadaHoyItemOut(BaseModel):
    id: int
    hora: str
    lead: str
    closer: str
    triajer: str = ""
    triaje_hecho: bool = False
    link_llamada: str
    status: str
    payment: float = 0
    owed: float = 0
    program_offered: str = ""
    programada_ofrecido_llamada: str = ""
    calificacion_llamada: str = ""
    # ISO del slot `call` (UTC naive del backend) para formatear en timezone del cliente.
    call: str | None = None


class AgentLlamadasHoyOut(BaseModel):
    fecha: str
    llamadas: list[AgentLlamadaHoyItemOut] = Field(default_factory=list)


class LlamadasHoyOut(BaseModel):
    fecha: str
    llamadas: list[AgentLlamadaHoyItemOut] = Field(default_factory=list)


class AgentProximaLlamadaItemOut(BaseModel):
    hora: str
    lead: str
    closer: str


class AgentProximasLlamadasOut(BaseModel):
    llamadas: list[AgentProximaLlamadaItemOut] = Field(default_factory=list)


class LeadPaymentOut(BaseModel):
    id: str
    lead_id: str
    monto: float = 0
    fecha: str
    nota: str = ""
    comprobante_url: str | None = None
    created_at: str


class LeadPaymentCreateRequest(BaseModel):
    monto: float = Field(..., gt=0)
    fecha: str | None = Field(default=None, description="YYYY-MM-DD; default hoy")
    nota: str | None = None
    comprobante_url: str | None = None


class LeadPaymentPatchRequest(BaseModel):
    monto: float | None = Field(default=None, gt=0)
    fecha: str | None = Field(default=None, description="YYYY-MM-DD")
    nota: str | None = None
    comprobante_url: str | None = None


class CobranzaLeadOut(BaseModel):
    """Lead deudor + resumen del historial de pagos (sin mutar Lead.pago/debe)."""

    id: str
    nombre: str = ""
    ig: str = ""
    telefono: str = ""
    email: str = ""
    avatar: str = ""
    status: str = ""
    closer: str = ""
    setter: str = ""
    programa_ofrecido: str = ""
    # Referencia de la tabla leads (solo lectura en cobranzas)
    pago: float = 0
    debe: float = 0
    comprobante_url: str | None = None
    # Historial independiente
    total_pagado_historial: float = 0
    cantidad_pagos: int = 0


class MediaUploadOut(BaseModel):
    url: str


class CobranzasListResponse(BaseModel):
    deudores: list[CobranzaLeadOut] = Field(default_factory=list)


class CobranzaPagoMonthEntryOut(BaseModel):
    fecha: str
    monto: float = 0
    lead_id: str = ""
    nota: str = ""


class CobranzasMonthPagosOut(BaseModel):
    """Suma de historial LeadPayment del mes (por fecha del pago)."""

    month: str
    total: float = 0
    entries: list[CobranzaPagoMonthEntryOut] = Field(default_factory=list)


class CobranzaPerfilOut(BaseModel):
    lead: CobranzaLeadOut
    pagos: list[LeadPaymentOut] = Field(default_factory=list)
