'use client'

import { SimpleEntriesPage } from '@/features/direct-channels/components/simple-entries-page'

export default function ReferidosPage() {
  return (
    <SimpleEntriesPage
      table="referral_entries"
      title="Referidos — Canal Directo"
      fields={[
        { key: 'name', label: 'Nombre' },
        { key: 'referred_by', label: 'Referido por' },
        { key: 'date', label: 'Fecha', type: 'date' },
        { key: 'chats', label: 'Chats', type: 'number' },
        { key: 'cash', label: 'Cash $', type: 'number' },
        { key: 'notes', label: 'Notas' },
      ]}
      columns={[
        { key: 'name', label: 'Nombre' },
        { key: 'referred_by', label: 'Referido por' },
        { key: 'chats', label: 'Chats' },
        { key: 'cash', label: 'Cash' },
      ]}
    />
  )
}
