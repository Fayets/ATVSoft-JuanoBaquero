export type CallReportEstado = 'pendiente' | 'procesando' | 'listo' | 'error'

export type CallReport = {
  id: string
  lead_id: string
  lead_nombre: string
  fathom_url: string
  estado: CallReportEstado | string
  error_msg: string | null
  participantes: string | null
  motivo_reunion: string | null
  nivel_dolor: string | null
  capacidad_decision: string | null
  capacidad_economica: string | null
  fit_real: string | null
  objecion_diagnostico: string | null
  cambio_energia: string | null
  objecion_no_manejada: string | null
  razon_real_no_cerrar: string | null
  compromisos_prometidos: string | null
  patrones_y_mejoras: string | null
  /** Legacy — reportes anteriores al formato calificación/coaching */
  resumen: string | null
  hubo_objeciones: string | null
  tipo_perfil: string | null
  ingresos_estimados: string | null
  situacion_y_deseo: string | null
  closer_report: string | null
  dolores_llamada: string | null
  razon_compra: string | null
  program_offered: string | null
  status_llamada: string | null
  created_at: string
  updated_at: string | null
}

export const ESTADO_COLORS: Record<string, string> = {
  pendiente: '#94A3B8',
  procesando: '#60A5FA',
  listo: '#22C55E',
  error: '#F87171',
}

export const ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  procesando: 'Procesando',
  listo: 'Listo',
  error: 'Error',
}

export type ClaudeApiStatusKind =
  | 'not_configured'
  | 'ok'
  | 'no_balance'
  | 'invalid_key'
  | 'permission_denied'
  | 'rate_limited'
  | 'unavailable'

export type ClaudeApiStatus = {
  status: ClaudeApiStatusKind
  message: string
  api_key_masked: string | null
}

export type FathomApiStatusKind =
  | 'not_configured'
  | 'ok'
  | 'invalid_key'
  | 'unavailable'

export type FathomApiStatus = {
  status: FathomApiStatusKind
  message: string
  api_key_masked: string | null
}
