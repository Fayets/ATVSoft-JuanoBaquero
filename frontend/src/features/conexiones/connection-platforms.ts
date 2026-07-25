export type ConnectionField = {
  key: string
  label: string
  placeholder?: string
  type?: string
  span?: 2
}

export type ConnectionPlatform = {
  key: string
  label: string
  icon: string
  subtitle: string
  fields: ConnectionField[]
  guide: { title: string; steps: string[] }
  infoOnly?: boolean
}

const PLATFORMS: ConnectionPlatform[] = [
  {
    key: 'calendly',
    label: 'Calendly',
    icon: '📅',
    subtitle: 'Creá leads cuando alguien agenda una sesión',
    fields: [
      { key: 'api_key', label: 'Personal Access Token', placeholder: 'eyJraWQ...', type: 'password' },
      { key: 'signing_key', label: 'Webhook Signing Key', placeholder: 'whsec_...', type: 'password' },
    ],
    guide: {
      title: 'Cómo configurar Calendly',
      steps: [
        'Andá a calendly.com → Integraciones → API & Webhooks',
        'Generá un Personal Access Token y pegalo acá',
        'Creá un webhook en Calendly con la URL de abajo y el evento invitee.created',
        'Copiá el Signing Key del webhook y pegalo en el campo correspondiente',
      ],
    },
  },
  {
    key: 'ghl',
    label: 'Go High Level',
    icon: '📆',
    subtitle: 'Sincronizá appointments del calendario como leads',
    fields: [
      { key: 'access_token', label: 'Private Integration Token', placeholder: 'pit-...', type: 'password' },
      { key: 'location_id', label: 'Location ID', placeholder: 'tt2MHSab9ZgEYLPCBKE6' },
      { key: 'calendar_id', label: 'Calendar ID', placeholder: '343pcyvrOZuhFN2H8CKY' },
    ],
    guide: {
      title: 'Cómo configurar Go High Level',
      steps: [
        'En GHL → Settings → Private Integrations, creá un token con acceso a Contacts y Calendars',
        'Pegá el Private Integration Token en el campo correspondiente',
        'Copiá el Location ID desde Settings → Business Profile',
        'Copiá el Calendar ID del calendario cuyas citas querés importar',
        'Guardá la conexión y usá «Sincronizar» para importar appointments',
      ],
    },
  },
  {
    key: 'manychat',
    label: 'ManyChat',
    icon: '💬',
    subtitle: 'Conectá tu keyword de bio para trackear chats',
    fields: [
      { key: 'api_key', label: 'API Key de ManyChat', placeholder: 'Settings → API', type: 'password' },
      { key: 'bio_keyword', label: 'Keyword de bio', placeholder: 'Ej: info, value, hola', type: 'text' },
    ],
    guide: {
      title: 'Cómo configurar ManyChat',
      steps: [
        'Copiá la API Key desde Settings → API',
        'Conectá y usá la URL del webhook en un External Request POST',
        'Incluí webhook_token en el body del request',
      ],
    },
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: '📸',
    subtitle: 'Sincronizá insights de stories con Instagram Graph API',
    fields: [
      { key: 'access_token', label: 'Access Token', placeholder: 'EAAG...', type: 'password' },
      { key: 'instagram_user_id', label: 'Instagram User ID', placeholder: '1784...' },
    ],
    guide: {
      title: 'Cómo configurar Instagram',
      steps: [
        'Conectá tu app en Meta for Developers (app activa, no eliminada)',
        'Generá un Access Token con: instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement',
        'La cuenta Instagram debe ser Profesional (Business/Creator) vinculada a una página de Facebook',
        'Pegá token e Instagram User ID (el ID numérico de la cuenta business, suele empezar con 1784…)',
        'Usá «Probar conexión» antes de sincronizar historias',
      ],
    },
  },
  {
    key: 'youtube',
    label: 'YouTube',
    icon: '▶️',
    subtitle: 'Importá videos con YouTube Data API v3',
    fields: [
      { key: 'api_key', label: 'API Key de Google', placeholder: 'AIzaSy...', type: 'password' },
      { key: 'channel_id', label: 'Channel ID', placeholder: 'UCxxxxxxxxxx' },
    ],
    guide: {
      title: 'Cómo configurar YouTube',
      steps: [
        'Habilitá YouTube Data API v3 en Google Cloud',
        'Creá una API Key y pegala acá',
        'Copiá el Channel ID de tu canal',
      ],
    },
  },
  {
    key: 'claude',
    label: 'Claude (Anthropic)',
    icon: '🧠',
    subtitle: 'Analizá las llamadas con tu propia cuenta de Claude',
    fields: [
      { key: 'api_key', label: 'API Key de Anthropic', placeholder: 'sk-ant-...', type: 'password', span: 2 },
    ],
    guide: {
      title: 'Cómo configurar Claude',
      steps: [
        'Entrá a console.anthropic.com e iniciá sesión (o creá una cuenta)',
        'Andá a Settings → API Keys → Create Key',
        'Copiá la key (empieza con sk-ant-) y pegala acá',
        'Necesitás saldo o un plan activo en la cuenta para que el análisis funcione',
        'El análisis de llamadas usará esta key: el consumo se factura a tu cuenta de Anthropic',
      ],
    },
  },
  {
    key: 'youtube_analytics',
    label: 'YouTube Analytics API',
    icon: '▶️',
    subtitle: 'Métricas avanzadas de canal; habilitala en Google Cloud.',
    fields: [],
    infoOnly: true,
    guide: {
      title: 'YouTube Analytics API',
      steps: [
        'Usá el mismo proyecto de Google Cloud que para YouTube Data API v3.',
        'Andá a APIs & Services → Library → busca "YouTube Analytics API" → Enable.',
        'Esta API suele requerir OAuth 2.0 del propietario del canal.',
        'Por ahora el tablero de YouTube usa Data API v3 para listar videos y estadísticas básicas.',
      ],
    },
  },
]

const SETUP_ORDER = ['instagram', 'manychat', 'calendly', 'youtube'] as const
const APP_ORDER = ['calendly', 'ghl', 'manychat', 'instagram', 'youtube', 'claude'] as const
const LEGACY_EXTRA_ORDER = ['youtube_analytics'] as const

function pick(order: readonly string[]): ConnectionPlatform[] {
  const map = new Map(PLATFORMS.map((p) => [p.key, p]))
  return order.map((key) => map.get(key)).filter(Boolean) as ConnectionPlatform[]
}

export function platformsForSetup(): ConnectionPlatform[] {
  return pick(SETUP_ORDER)
}

export function platformsForApp(): ConnectionPlatform[] {
  return [...pick(APP_ORDER), ...pick(LEGACY_EXTRA_ORDER)]
}
