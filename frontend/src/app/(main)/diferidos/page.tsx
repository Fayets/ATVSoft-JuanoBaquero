'use client'

import { SimpleEntriesPage } from '@/features/direct-channels/components/simple-entries-page'

export default function DiferidosPage() {
  return (
    <SimpleEntriesPage
      table="deferred_entries"
      title="Diferidos — Atribucion Cruzada"
      fields={[
        { key: 'piece_name', label: 'Pieza original' },
        { key: 'content_type', label: 'Tipo (reel/historia/video)' },
        { key: 'original_date', label: 'Fecha original', type: 'date' },
        { key: 'cash', label: 'Cash $', type: 'number' },
        { key: 'notes', label: 'Notas' },
      ]}
      columns={[
        { key: 'piece_name', label: 'Pieza' },
        { key: 'content_type', label: 'Tipo' },
        { key: 'original_date', label: 'Fecha original' },
        { key: 'cash', label: 'Cash' },
      ]}
    />
  )
}
