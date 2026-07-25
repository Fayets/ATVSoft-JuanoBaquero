export function PageLoading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--text3)]">
      {label}
    </div>
  )
}
