/** Catálogo legacy hardcodeado — seed lazy al primer GET /avatars si el usuario no tiene filas. */
export const DEFAULT_AVATARS: { nombre: string; color: string }[] = [
  { nombre: 'Experto en info', color: '#3B82F6' },
  { nombre: 'Dueño de agencia', color: '#A855F7' },
  { nombre: 'Dueño de negocio', color: '#F59E0B' },
  { nombre: 'Habilidades de alto valor', color: '#EC4899' },
  { nombre: 'Creador de contenido', color: '#22C55E' },
  { nombre: 'Creador con infoproducto', color: '#06B6D4' },
  { nombre: 'Otro', color: '#6B7280' },
]

export const AVATAR_COLORS: Record<string, string> = Object.fromEntries(
  DEFAULT_AVATARS.map((a) => [a.nombre, a.color]),
)

export const AVATAR_OPTIONS: string[] = ['', ...DEFAULT_AVATARS.map((a) => a.nombre)]
