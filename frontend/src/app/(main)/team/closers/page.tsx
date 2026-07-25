import { redirect } from 'next/navigation'

/** Ruta antigua: el listado de edición pasó a incluir setters y closers en `/team/equipo`. */
export default function TeamClosersRedirectPage() {
  redirect('/team/equipo')
}
