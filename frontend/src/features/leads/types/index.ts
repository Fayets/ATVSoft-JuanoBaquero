import {
  AVATAR_COLORS,
  AVATAR_OPTIONS,
} from '@/shared/constants/avatar-defaults'

export type LeadFormulario = {
  forma_agendamiento: string
  conoce_juano: string
  tiempo_siguiendo: string
  experiencia_youtube: string
  urgencia: string
  dinero_disponible: string
  alguien_mas_reunion: string
}

export const FORMULARIO_KEYS: (keyof LeadFormulario)[] = [
  'forma_agendamiento',
  'conoce_juano',
  'tiempo_siguiendo',
  'experiencia_youtube',
  'urgencia',
  'dinero_disponible',
  'alguien_mas_reunion',
]

export const FORMULARIO_LABELS: Record<keyof LeadFormulario, string> = {
  forma_agendamiento: '1) ¿De qué forma te agendaste?',
  conoce_juano: '2) ¿De dónde conoces a Juano?',
  tiempo_siguiendo: '3) ¿Hace cuánto tiempo sigues a Juano?',
  experiencia_youtube: '4) ¿Qué experiencia tienes con YouTube?',
  urgencia: '5) ¿Qué tan pronto quieres resolver estos obstáculos?',
  dinero_disponible: '6) ¿Cuánto dinero disponible tienes para iniciar HOY MISMO?',
  alguien_mas_reunion: '7) ¿Debe estar alguien más presente en la reunión?',
}

export function emptyFormulario(): LeadFormulario {
  return {
    forma_agendamiento: '',
    conoce_juano: '',
    tiempo_siguiendo: '',
    experiencia_youtube: '',
    urgencia: '',
    dinero_disponible: '',
    alguien_mas_reunion: '',
  }
}

export function normalizeFormulario(raw: unknown): LeadFormulario {
  const out = emptyFormulario()
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const k of FORMULARIO_KEYS) {
    const v = obj[k]
    if (v != null) out[k] = String(v).trim()
  }
  return out
}

export function formularioAnsweredCount(raw: unknown): number {
  const data = normalizeFormulario(raw)
  return FORMULARIO_KEYS.filter((k) => Boolean(data[k])).length
}

export type Lead = {
  id: string
  /** user_id del dueño en BD (Pony Lead.user_id) */
  lead_user_id?: string | null
  client_name: string
  ig_handle: string | null
  phone: string | null
  avatar_type: string | null
  status: string
  origin: string | null
  /** keyword / embudo (API); no se muestra en la tabla de leads */
  entry_funnel: string | null
  keyword?: string | null
  agenda_point: string | null
  fecha_bot?: string | null
  /** Fecha/hora de la llamada agendada (elige el cliente); columna «Call» en la tabla. */
  scheduled_at: string | null
  /** Canal donde agendó: Chat, Youtube (columna agendo_en en BD). */
  agendo_en?: string | null
  /** ISO: momento en que completó el formulario Calendly (columna agendo). */
  agendo?: string | null
  call_at: string | null
  /** ISO fecha/hora en BD (columna `call`, mismo valor que scheduled_at / Calendly). */
  call?: string | null
  call_link: string | null
  closer_report: string | null
  program_offered: string | null
  /** Programa ofrecido en la llamada (BD `programada_ofrecido_llamada`); no usado en facturación. */
  programada_ofrecido_llamada: string | null
  /** Precio USD del catálogo en BD (GET /leads); mismo criterio que Ajustes → Programas. */
  program_price_usd?: number | null
  revenue: number
  payment: number
  owed: number
  closer: string | null
  setter: string | null
  notes: string | null
  date: string
  month: string | null
  // Campos Calendly / GHL
  email: string | null
  dolores_setting: string | null
  dolores_llamada: string | null
  razon_compra: string | null
  /** 7 respuestas del formulario GHL calendar. */
  formulario?: LeadFormulario | Record<string, string> | null
  calendly_event_uri: string | null
  calendly_invitee_uri: string | null
  /** Origen del registro (manual, import, etc.). */
  source_type?: string | null
  content_url?: string | null
  manychat_contact_id?: string | null
  respondio_auto?: boolean | null
}

export type ColumnDef = {
  key: string
  label: string
  title?: string
  width: number
  type: 'text' | 'number' | 'date' | 'select' | 'badge' | 'link' | 'currency'
  editable?: boolean
  options?: string[]
  colors?: Record<string, string>
  sticky?: boolean
  defaultVisible?: boolean
}

export type SortConfig = {
  field: string
  dir: 'asc' | 'desc'
}

export type FilterConfig = {
  field: string
  operator: 'contains' | 'equals' | 'gt' | 'lt' | 'empty' | 'not_empty'
  value: string
}

export const STATUS_COLORS: Record<string, string> = {
  Cerrado: '#4ADE80',
  Seguimiento: '#60A5FA',
  'Seña': '#FBBF24',
  'No show': '#F87171',
  'Re-agenda': '#FB923C',
  Descalificado: '#A855F7',
  Pendiente: '#94A3B8',
}

export { AVATAR_COLORS, AVATAR_OPTIONS }

export const PROGRAM_COLORS: Record<string, string> = {
  Boost: '#F59E0B',
  Advantage: '#3B82F6',
  Mentoria: '#22C55E',
}

export const STATUS_OPTIONS = ['Pendiente', 'Seguimiento', 'Seña', 'Cerrado', 'No show', 'Re-agenda', 'Descalificado']
export const PROGRAM_OPTIONS = ['', 'Boost', 'Advantage', 'Mentoria']
export const ORIGIN_OPTIONS = ['Referido', 'Setter', 'Youtube', 'Lead viejo (seguimiento)'] as const

export const AGENDO_EN_OPTIONS = ['Chat', 'Youtube'] as const

export const AGENDO_EN_COLORS: Record<string, string> = {
  Chat: '#E1306C',
  Youtube: '#FF0000',
}

export const ORIGIN_COLORS: Record<string, string> = {
  Referido: '#F59E0B',
  Setter: '#3B82F6',
  Youtube: '#FF0000',
  'Lead viejo (seguimiento)': '#A855F7',
}

export const STATUS_TABS = ['Todos', 'Cerrados', 'Seguimiento', 'No show', 'Pendiente', 'Descalificado']

function normStatusKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Unifica variantes de texto libre al valor canónico de STATUS_OPTIONS
 * para filtros, colores y selects.
 */
export function canonicalLeadStatus(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return 'Pendiente'
  const n = normStatusKey(s)
  const synonyms: Record<string, string> = {
    cerrado: 'Cerrado',
    cerrados: 'Cerrado',
    closed: 'Cerrado',
    won: 'Cerrado',
    seguimiento: 'Seguimiento',
    'en seguimiento': 'Seguimiento',
    follow: 'Seguimiento',
    'follow up': 'Seguimiento',
    'no show': 'No show',
    noshow: 'No show',
    'no asistio': 'No show',
    'no asistió': 'No show',
    pendiente: 'Pendiente',
    pending: 'Pendiente',
    descalificado: 'Descalificado',
    disqualificado: 'Descalificado',
    disqualified: 'Descalificado',
    're-agenda': 'Re-agenda',
    're agenda': 'Re-agenda',
    reagenda: 'Re-agenda',
    seña: 'Seña',
    sena: 'Seña',
  }
  if (synonyms[n]) return synonyms[n]
  const fromOptions = STATUS_OPTIONS.find((o) => normStatusKey(o) === n)
  if (fromOptions) return fromOptions
  return s
}

export const SETTER_COLORS: Record<string, string> = {
  _default: '#3B82F6',
}

export const CLOSER_COLORS: Record<string, string> = {
  _default: '#8B5CF6',
}

/** Opciones de «Prog. ofrecido»: definidas en Ajustes → Programas (fallback: PROGRAM_OPTIONS). */
export function buildColumns(
  setterNames: string[],
  closerNames: string[],
  programOffered?: { options: string[]; colors: Record<string, string> },
  avatarMeta?: { options: string[]; colors: Record<string, string> },
): ColumnDef[] {
  const progOpts = programOffered?.options ?? PROGRAM_OPTIONS
  const progColors = { ...PROGRAM_COLORS, ...(programOffered?.colors ?? {}) }
  const avatarOpts = avatarMeta?.options ?? AVATAR_OPTIONS
  const avatarColors = { ...AVATAR_COLORS, ...(avatarMeta?.colors ?? {}) }
  return [
    // Datos de contacto
    { key: 'client_name', label: 'Nombre', width: 160, type: 'text', editable: true, sticky: true, defaultVisible: true },
    { key: 'ig_handle', label: 'IG', width: 130, type: 'text', editable: true, defaultVisible: true },
    { key: 'phone', label: 'Tel', width: 140, type: 'text', editable: true, defaultVisible: true },
    { key: 'email', label: 'Email', width: 180, type: 'text', editable: false, defaultVisible: true },
    { key: 'avatar_type', label: 'Avatar', width: 170, type: 'badge', editable: true, options: avatarOpts, colors: avatarColors, defaultVisible: true },
    // Estado y equipo
    { key: 'status', label: 'Status', width: 130, type: 'select', editable: true, options: STATUS_OPTIONS, colors: STATUS_COLORS, defaultVisible: true },
    { key: 'origin', label: 'Origen', width: 200, type: 'select', editable: true, options: [...ORIGIN_OPTIONS], colors: ORIGIN_COLORS, defaultVisible: true },
    // entry_funnel (keyword) no se muestra en esta vista
    { key: 'agenda_point', label: 'Pto agenda', width: 160, type: 'badge', editable: false, options: [''], colors: {}, defaultVisible: true },
    { key: 'formulario', label: 'Formulario', width: 110, type: 'text', editable: false, defaultVisible: true },
    // Fechas
    { key: 'agendo', label: 'Agendo', width: 120, type: 'date', editable: true, defaultVisible: true },
    { key: 'scheduled_at', label: 'Call', width: 150, type: 'date', editable: true, defaultVisible: true },
    { key: 'agendo_en', label: 'Agendó en', width: 120, type: 'select', editable: true, options: [...AGENDO_EN_OPTIONS], colors: AGENDO_EN_COLORS, defaultVisible: true },
    { key: 'call_at', label: 'Fecha call (alt.)', width: 110, type: 'date', editable: true, defaultVisible: false },
    // Setting (pre-llamada)
    { key: 'setter', label: 'Setter', width: 110, type: 'badge', editable: true, options: ['', ...setterNames], colors: Object.fromEntries(setterNames.map(n => [n, '#3B82F6'])), defaultVisible: true },
    { key: 'dolores_setting', label: 'Dolores setting', width: 200, type: 'text', editable: true, defaultVisible: false },
    // Llamada (closer)
    { key: 'closer', label: 'Closer', width: 110, type: 'badge', editable: true, options: ['', ...closerNames], colors: Object.fromEntries(closerNames.map(n => [n, '#8B5CF6'])), defaultVisible: true },
    { key: 'closer_report', label: 'Reporte closer', width: 200, type: 'text', editable: true, defaultVisible: false },
    { key: 'call_link', label: 'Link de llamada', width: 130, type: 'link', editable: true, defaultVisible: true },
    { key: 'dolores_llamada', label: 'Dolores llamada', width: 200, type: 'text', editable: true, defaultVisible: false },
    { key: 'razon_compra', label: 'Razón compra', width: 100, type: 'text', editable: true, defaultVisible: false },
    // Venta
    {
      key: 'programada_ofrecido_llamada',
      label: 'Prog. ofrecido',
      width: 130,
      type: 'badge',
      editable: true,
      options: progOpts,
      colors: progColors,
      defaultVisible: true,
    },
    { key: 'program_offered', label: 'Prog. comprado', width: 130, type: 'badge', editable: true, options: progOpts, colors: progColors, defaultVisible: true },
    { key: 'payment', label: 'Pagó', width: 100, type: 'currency', editable: true, defaultVisible: true },
    { key: 'owed', label: 'Debe', width: 100, type: 'currency', editable: true, defaultVisible: true },
    // Extras
    { key: 'revenue', label: 'Facturación', width: 110, type: 'currency', editable: true, defaultVisible: false },
    { key: 'date', label: 'Fecha', width: 110, type: 'date', editable: true, defaultVisible: false },
    { key: 'notes', label: 'Notas', width: 200, type: 'text', editable: false, defaultVisible: false },
    { key: 'calendly_event_uri', label: 'Calendly (evento)', width: 160, type: 'link', editable: true, defaultVisible: false },
    { key: 'calendly_invitee_uri', label: 'Calendly (invitado)', width: 160, type: 'link', editable: true, defaultVisible: false },
    // Paridad con modelo Pony Lead (Neon)
    { key: 'lead_user_id', label: 'User cuenta', width: 96, type: 'text', editable: false, defaultVisible: false },
    { key: 'keyword', label: 'Keyword (BD)', width: 120, type: 'text', editable: false, defaultVisible: false },
    { key: 'fecha_bot', label: 'Fecha bot', width: 130, type: 'date', editable: false, defaultVisible: false },
    { key: 'call', label: 'Call (ISO BD)', width: 140, type: 'text', editable: false, defaultVisible: false },
    { key: 'content_url', label: 'Content URL', width: 160, type: 'link', editable: false, defaultVisible: false },
    { key: 'manychat_contact_id', label: 'ManyChat ID', width: 130, type: 'text', editable: false, defaultVisible: false },
    { key: 'respondio_auto', label: 'Resp. auto', width: 96, type: 'text', editable: false, defaultVisible: false },
    { key: 'source_type', label: 'Origen reg.', width: 110, type: 'text', editable: false, defaultVisible: false },
  ]
}
