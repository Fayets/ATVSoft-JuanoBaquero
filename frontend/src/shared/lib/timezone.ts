/** Timezones soportadas para closers (IANA). */

export type TimezoneOption = {
  id: string
  flag: string
  label: string
  /** IANA timeZone para Intl */
  timeZone: string
}

export const DEFAULT_TIMEZONE = 'America/Bogota'

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { id: 'co', flag: '🇨🇴', label: 'Colombia', timeZone: 'America/Bogota' },
  { id: 'ar', flag: '🇦🇷', label: 'Argentina', timeZone: 'America/Argentina/Buenos_Aires' },
  { id: 'mx', flag: '🇲🇽', label: 'México', timeZone: 'America/Mexico_City' },
  { id: 'es', flag: '🇪🇸', label: 'España', timeZone: 'Europe/Madrid' },
  { id: 've', flag: '🇻🇪', label: 'Venezuela', timeZone: 'America/Caracas' },
  { id: 'pe', flag: '🇵🇪', label: 'Perú', timeZone: 'America/Lima' },
  { id: 'cl', flag: '🇨🇱', label: 'Chile', timeZone: 'America/Santiago' },
  { id: 'us', flag: '🇺🇸', label: 'USA East', timeZone: 'America/New_York' },
] as const

export function findTimezoneOption(timeZone: string | null | undefined): TimezoneOption {
  const tz = (timeZone || '').trim()
  return TIMEZONE_OPTIONS.find((o) => o.timeZone === tz) ?? TIMEZONE_OPTIONS[0]!
}

/**
 * Parsea ISO de `call` del backend.
 * Los naive (sin Z/offset) se tratan como UTC — así los guarda Calendly/GHL.
 */
export function parseCallInstant(raw: string | null | undefined): Date | null {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const normalized = s.includes('T') ? s : s.replace(' ', 'T')
  const d = new Date(`${normalized}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Fecha call: `dd/mm/aaaa` en la timezone elegida. */
export function formatCallDate(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d)
  } catch {
    return null
  }
}

/** Hora call: `HH:mm` en la timezone elegida. */
export function formatCallTime(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return null
  }
}

/** Fecha + hora call compacta. */
export function formatCallDateTime(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return null
  }
}
