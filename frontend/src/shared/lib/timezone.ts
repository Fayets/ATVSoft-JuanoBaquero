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
 * Instant absoluto de `call` / `scheduled_at`.
 *
 * Contrato: el backend manda UTC (idealmente con sufijo `Z`).
 * - Con `Z` u offset → se respeta tal cual (una sola vez).
 * - Naive → se interpreta como UTC (se agrega `Z`), NUNCA como hora local del browser.
 *
 * Luego el único paso de zona es Intl `{ timeZone }` al formatear.
 */
export function parseCallInstant(raw: string | null | undefined): Date | null {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return null

  // Solo fecha calendario
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  let iso = s.includes('T') ? s : s.replace(' ', 'T')

  // Ya es absoluto: no tocar
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // Naive → UTC explícito (evitar Date(...) local del browser = doble offset)
  if (!iso.endsWith('Z')) iso = `${iso}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatWithZone(
  d: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      ...options,
    }).format(d)
  } catch {
    return null
  }
}

/** Fecha call: `dd/mm/aaaa` en la timezone elegida. */
export function formatCallDate(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  return formatWithZone(d, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Hora call: `HH:mm` en la timezone elegida. */
export function formatCallTime(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  return formatWithZone(d, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Fecha + hora call compacta. */
export function formatCallDateTime(
  raw: string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string | null {
  const d = parseCallInstant(raw)
  if (!d) return null
  // en-GB → `dd/mm/yyyy, HH:mm` estable; un solo timeZone (sin offset manual).
  return formatWithZone(d, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** YYYY-MM-DD del día civil en la timezone IANA (para panel diario / filtros). */
export function todayIsoInTimeZone(timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function isDateBeforeToday(isoDate: string, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const day = isoDate.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  return day < todayIsoInTimeZone(timeZone)
}
