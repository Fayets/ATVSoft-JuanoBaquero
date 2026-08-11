'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { formatCash } from '@/shared/lib/format-utils'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { uploadComprobante } from '../services/upload-comprobante'
import {
  CobranzaPerfil,
  LeadPayment,
  PAYMENT_CONCEPTOS,
  debeRestante,
  formatIsoDateToDdMmYyyy,
  suggestPaymentConcepto,
  todayIsoLocal,
} from '../types'

export function CobranzaPerfilPage() {
  const params = useParams()
  const leadId = String(params?.leadId ?? '')
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()

  const [perfil, setPerfil] = useState<CobranzaPerfil | null>(null)
  const [loading, setLoading] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [editPago, setEditPago] = useState<LeadPayment | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [formMonto, setFormMonto] = useState('')
  const [formFecha, setFormFecha] = useState(todayIsoLocal())
  const [formConcepto, setFormConcepto] = useState<string>('1ra Cuota')
  const [formPrecioContrato, setFormPrecioContrato] = useState('')
  const [savingContrato, setSavingContrato] = useState(false)
  const [formFile, setFormFile] = useState<File | null>(null)
  const [formExistingUrl, setFormExistingUrl] = useState<string | null>(null)
  const [clearComprobante, setClearComprobante] = useState(false)
  const cuotaFileRef = useRef<HTMLInputElement>(null)
  const leadFileRef = useRef<HTMLInputElement>(null)
  const [uploadingLeadProof, setUploadingLeadProof] = useState(false)

  const load = useCallback(async () => {
    if (!ready || !userId || !leadId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/cobranzas/${encodeURIComponent(leadId)}`)
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`Error: ${detail}`)
        setPerfil(null)
        return
      }
      setPerfil(raw as CobranzaPerfil)
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
      setPerfil(null)
    } finally {
      setLoading(false)
    }
  }, [ready, userId, leadId, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!perfil) return
    setFormPrecioContrato(
      perfil.lead.precio_contrato != null ? String(perfil.lead.precio_contrato) : '',
    )
  }, [perfil?.lead.id, perfil?.lead.precio_contrato])

  const maxCuotaPermitida = (editing: LeadPayment | null): number | null => {
    if (!perfil) return null
    if (perfil.lead.debe_desconocido || perfil.lead.debe == null) return null
    const deuda = Number(perfil.lead.debe) || 0
    const hist = Number(perfil.lead.total_pagado_historial) || 0
    const liberado = editing ? Number(editing.monto) || 0 : 0
    return Math.max(0, deuda - hist + liberado)
  }

  const openAdd = () => {
    if (!perfil) return
    const max = maxCuotaPermitida(null)
    if (max != null && max <= 0) {
      toast('No queda deuda por cobrar.')
      return
    }
    setEditPago(null)
    setFormMonto('')
    setFormFecha(todayIsoLocal())
    setFormConcepto(suggestPaymentConcepto(perfil.pagos))
    setFormFile(null)
    setFormExistingUrl(null)
    setClearComprobante(false)
    setAddOpen(true)
  }

  const openEdit = (p: LeadPayment) => {
    setEditPago(p)
    setFormMonto(String(p.monto ?? ''))
    setFormFecha((p.fecha || '').slice(0, 10) || todayIsoLocal())
    setFormConcepto((p.concepto || '').trim() || 'Otro')
    setFormFile(null)
    setFormExistingUrl(p.comprobante_url || null)
    setClearComprobante(false)
    setAddOpen(true)
  }

  const savePago = async () => {
    const monto = Number(String(formMonto).replace(',', '.'))
    if (!Number.isFinite(monto) || monto <= 0) {
      toast('Ingresá un monto válido mayor a 0.')
      return
    }
    if (!formFecha.trim()) {
      toast('Ingresá una fecha.')
      return
    }
    const max = maxCuotaPermitida(editPago)
    if (max != null && monto > max + 1e-9) {
      toast(`La cuota no puede superar ${formatCash(max)} (sin saldo a favor).`)
      return
    }
    if (!formConcepto.trim()) {
      toast('Seleccioná un concepto.')
      return
    }
    setBusy(true)
    try {
      let comprobante_url: string | null | undefined = undefined
      if (formFile) {
        comprobante_url = await uploadComprobante(formFile)
      } else if (clearComprobante) {
        comprobante_url = ''
      } else if (!editPago) {
        comprobante_url = null
      }

      const body: Record<string, unknown> = {
        monto,
        fecha: formFecha.trim(),
        concepto: formConcepto.trim(),
        nota: formConcepto.trim(),
      }
      if (comprobante_url !== undefined) {
        body.comprobante_url = comprobante_url
      }

      const res = editPago
        ? await apiFetch(`/cobranzas/pagos/${encodeURIComponent(editPago.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await apiFetch(`/cobranzas/${encodeURIComponent(leadId)}/pagos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo guardar: ${detail}`)
        return
      }
      toast(editPago ? 'Cuota actualizada.' : 'Cuota agregada.')
      setAddOpen(false)
      window.dispatchEvent(new Event('atvmkt-cobranzas-changed'))
      await load()
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setBusy(false)
    }
  }

  const uploadLeadComprobante = async (file: File) => {
    setUploadingLeadProof(true)
    try {
      const url = await uploadComprobante(file)
      const res = await apiFetch(`/leads/${encodeURIComponent(leadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobante_url: url }),
      })
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo guardar: ${detail}`)
        return
      }
      toast('Comprobante guardado.')
      await load()
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setUploadingLeadProof(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteId) return
    setBusy(true)
    try {
      const res = await apiFetch(`/cobranzas/pagos/${encodeURIComponent(deleteId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo eliminar: ${detail}`)
        return
      }
      toast('Cuota eliminada.')
      setDeleteId(null)
      window.dispatchEvent(new Event('atvmkt-cobranzas-changed'))
      await load()
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setBusy(false)
    }
  }

  const savePrecioContrato = async () => {
    const val = Number(String(formPrecioContrato).replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) {
      toast('Ingresá un precio de contrato válido mayor a 0.')
      return
    }
    setSavingContrato(true)
    try {
      const res = await apiFetch(`/cobranzas/${encodeURIComponent(leadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precio_contrato: val }),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo guardar: ${detail}`)
        return
      }
      toast('Precio de contrato guardado.')
      window.dispatchEvent(new Event('atvmkt-cobranzas-changed'))
      await load()
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setSavingContrato(false)
    }
  }

  if (loading || !ready) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  if (!perfil) {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="text-[13px] text-[var(--text2)]">No se encontró el lead.</p>
        <Link
          href="/cobranzas"
          className="text-[12px] font-medium text-[var(--accent)] hover:underline"
        >
          ← Volver a cobranzas
        </Link>
      </div>
    )
  }

  const { lead, pagos } = perfil
  const saldo = debeRestante(lead)
  const saldoLabel = saldo == null ? 'Sin tope' : formatCash(saldo)
  const puedeAgregar = saldo == null || saldo > 0
  const contactBits = [
    lead.ig ? `@${lead.ig.replace(/^@/, '')}` : '',
    lead.telefono || '',
    lead.email || '',
  ].filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          href="/cobranzas"
          className="text-[12px] text-[var(--text3)] transition-colors hover:text-[var(--text)]"
        >
          ← Cobranzas
        </Link>
        <div className="flex items-center gap-5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Debe
            </span>
            <span className="font-mono-num font-semibold text-[var(--amber)]">
              {saldoLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Pagado (Leads)
            </span>
            <span className="font-mono-num font-semibold text-[var(--text)]">
              {formatCash(lead.pago)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text3)]">
              Cuotas
            </span>
            <span className="font-mono-num font-semibold text-[var(--green)]">
              {formatCash(lead.total_pagado_historial)}
            </span>
          </div>
          <button
            type="button"
            onClick={openAdd}
            disabled={!puedeAgregar}
            className="shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Agregar cuota
          </button>
        </div>
      </div>

      {/* Cabecera lead */}
      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg2)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[16px] font-semibold text-[var(--text)]">
                {lead.nombre || 'Sin nombre'}
              </h2>
              {lead.status ? (
                <span className="inline-flex rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[11px] text-[var(--text2)]">
                  {lead.status}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] text-[var(--text3)]">
              {contactBits.length ? contactBits.join(' · ') : 'Sin contacto'}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--text2)]">
            <span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text3)]">
                Programa{' '}
              </span>
              {lead.programa_ofrecido || '—'}
            </span>
            <span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text3)]">
                Closer{' '}
              </span>
              {lead.closer || '—'}
            </span>
          </div>
        </div>
        {lead.debe_desconocido ? (
          <p className="mt-2 rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/10 px-3 py-2 text-[12px] text-[var(--amber)]">
            Este cliente no tiene monto de contrato registrado. Podés cargar pagos sin tope o
            completar el precio del contrato abajo.
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-[var(--text3)]">
          Debe restante = deuda en Leads (
          {lead.debe != null ? formatCash(lead.debe) : 'desconocida'}) − cuotas cargadas. Al guardar
          un pago se actualiza el acumulado en Leads.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
          <label className="block min-w-[160px] flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              Precio contrato (USD)
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formPrecioContrato}
              onChange={(e) => setFormPrecioContrato(e.target.value)}
              placeholder={
                lead.precio_contrato != null ? String(lead.precio_contrato) : 'Sin registrar'
              }
              disabled={savingContrato}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            disabled={savingContrato}
            onClick={() => void savePrecioContrato()}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--text3)] disabled:opacity-40"
          >
            {savingContrato ? 'Guardando…' : 'Guardar contrato'}
          </button>
          {lead.precio_contrato != null ? (
            <span className="text-[11px] text-[var(--text3)]">
              Registrado: {formatCash(lead.precio_contrato)}
            </span>
          ) : null}
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              Comprobantes
            </span>
            <div>
              <input
                ref={leadFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadLeadComprobante(file)
                }}
              />
              <button
                type="button"
                disabled={uploadingLeadProof}
                onClick={() => leadFileRef.current?.click()}
                className="rounded px-2 py-1 text-[10px] text-[var(--text2)] hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-40"
              >
                {uploadingLeadProof ? 'Subiendo…' : 'Subir (Lead)'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lead.comprobante_url ? (
              <ComprobanteThumb url={lead.comprobante_url} label="Lead" />
            ) : null}
            {pagos
              .filter((p) => p.comprobante_url)
              .map((p) => (
                <ComprobanteThumb
                  key={p.id}
                  url={p.comprobante_url!}
                  label={formatIsoDateToDdMmYyyy(p.fecha)}
                />
              ))}
            {!lead.comprobante_url && pagos.every((p) => !p.comprobante_url) ? (
              <span className="text-[12px] text-[var(--text3)]">Sin comprobantes cargados</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Historial */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Historial de cuotas
        </h3>
        <span className="font-mono-num text-[12px] text-[var(--text2)]">
          {pagos.length} cuota{pagos.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg3)]">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Fecha
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Concepto
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Monto
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Comprobante
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]" />
            </tr>
          </thead>
          <tbody>
            {pagos.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-[13px] text-[var(--text3)]">
                  Todavía no hay cuotas. Usá «Agregar cuota» para la primera.
                </td>
              </tr>
            ) : (
              pagos.map((p, i) => (
                <tr
                  key={p.id}
                  className={`border-b border-[var(--border)] transition-colors hover:bg-[rgba(255,255,255,0.03)] ${
                    i % 2 === 1 ? 'bg-[rgba(255,255,255,0.01)]' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">
                      {formatIsoDateToDdMmYyyy(p.fecha)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[12px] text-[var(--text2)]">
                      {(p.concepto || '').trim() || (
                        <span className="text-[var(--text3)]">(sin concepto)</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono-num text-[13px] font-semibold text-[var(--green)]">
                      {formatCash(p.monto)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.comprobante_url ? (
                      <ComprobanteThumb url={p.comprobante_url} compact />
                    ) : (
                      <span className="text-[12px] text-[var(--text3)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded px-2 py-1 text-[11px] text-[var(--text2)] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--text)]"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(p.id)}
                        className="rounded px-2 py-1 text-[11px] text-[#F87171] transition-colors hover:bg-[rgba(248,113,113,0.1)]"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={addOpen}
        onClose={() => !busy && setAddOpen(false)}
        title={editPago ? 'Editar cuota' : 'Agregar cuota'}
        maxWidth="420px"
        compact
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Concepto
            </span>
            <select
              value={formConcepto}
              onChange={(e) => setFormConcepto(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
            >
              {PAYMENT_CONCEPTOS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Monto (USD)
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              max={maxCuotaPermitida(editPago) ?? undefined}
              value={formMonto}
              onChange={(e) => setFormMonto(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
              placeholder={
                maxCuotaPermitida(editPago) != null
                  ? String(Math.round(maxCuotaPermitida(editPago)!))
                  : ''
              }
              autoFocus
            />
            <span className="mt-1 block text-[11px] text-[var(--text3)]">
              {maxCuotaPermitida(editPago) != null
                ? `Máximo ${formatCash(maxCuotaPermitida(editPago)!)} (sin superar la deuda)`
                : 'Sin tope de deuda — contrato no registrado'}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Fecha
            </span>
            <input
              type="date"
              value={formFecha}
              onChange={(e) => setFormFecha(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
            />
          </label>
          <div className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
              Comprobante
            </span>
            <input
              ref={cuotaFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                e.target.value = ''
                setFormFile(file)
                if (file) setClearComprobante(false)
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => cuotaFileRef.current?.click()}
                className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:border-[var(--text3)] disabled:opacity-40"
              >
                {formFile ? 'Cambiar archivo' : 'Elegir imagen/PDF'}
              </button>
              {formFile ? (
                <span className="truncate text-[11px] text-[var(--text2)]">{formFile.name}</span>
              ) : formExistingUrl && !clearComprobante ? (
                <a
                  href={resolveMediaUrl(formExistingUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--accent)] hover:underline"
                >
                  Ver actual
                </a>
              ) : (
                <span className="text-[11px] text-[var(--text3)]">Opcional</span>
              )}
              {(formFile || (formExistingUrl && !clearComprobante)) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFormFile(null)
                    setClearComprobante(true)
                  }}
                  className="text-[11px] text-[#F87171]"
                >
                  Quitar
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setAddOpen(false)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void savePago()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteId)}
        onClose={() => !busy && setDeleteId(null)}
        title="Eliminar pago"
        maxWidth="380px"
        compact
      >
        <p className="text-[13px] text-[var(--text2)]">¿Eliminar esta cuota del historial?</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setDeleteId(null)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmDelete()}
            className="rounded-lg bg-[#DC2626] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function ComprobanteThumb({
  url,
  label,
  compact,
}: {
  url: string
  label?: string
  compact?: boolean
}) {
  const href = resolveMediaUrl(url)
  const isPdf = href.toLowerCase().includes('.pdf')
  if (compact) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
      >
        {isPdf ? (
          'PDF'
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={href}
            alt="Comprobante"
            className="h-8 w-8 rounded border border-[var(--border)] object-cover"
          />
        )}
      </a>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col items-start gap-1"
      title={label || 'Comprobante'}
    >
      {isPdf ? (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded border border-[var(--border)] bg-[var(--bg3)] text-[11px] text-[var(--text2)]">
          PDF
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={href}
          alt={label || 'Comprobante'}
          className="h-14 w-14 rounded border border-[var(--border)] object-cover transition-opacity group-hover:opacity-90"
        />
      )}
      {label ? <span className="text-[10px] text-[var(--text3)]">{label}</span> : null}
    </a>
  )
}
