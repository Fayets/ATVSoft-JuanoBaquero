'use client'
 
 import { useEffect, useMemo, useState } from 'react'
 
 import { Bar, Line } from '@/shared/components/charts'
 import { apiFetch } from '@/lib/api'
 import { useAuthUser } from '@/shared/hooks/use-auth-user'
 
 type KeywordsSeriesPoint = {
   day: string // YYYY-MM-DD
   rows: number
   leads: number
 }
 
 type KeywordsTopKeyword = {
   keyword: string
   rows: number
   leads: number
 }
 
 type KeywordsTopReel = {
   reel_id: string
   label: string
   rows: number
 }
 
 type ReelOption = { id: string; label: string }
 
 type KeywordsMetricsResponse = {
   series_days: KeywordsSeriesPoint[]
   top_keywords: KeywordsTopKeyword[]
   top_reels: KeywordsTopReel[]
   reels: ReelOption[]
 }
 
 export function KeywordsMetricsPanel() {
   const { ready } = useAuthUser()
   const [loading, setLoading] = useState(true)
   const [reelId, setReelId] = useState('')
   const [reelOptions, setReelOptions] = useState<ReelOption[]>([])
   const [data, setData] = useState<KeywordsMetricsResponse>({
     series_days: [],
     top_keywords: [],
     top_reels: [],
     reels: [],
   })
 
   useEffect(() => {
     if (!ready) return
     let cancelled = false
     setLoading(true)
     const q = new URLSearchParams()
     if (reelId.trim()) q.set('reel_id', reelId.trim())
     apiFetch(`/keywords/metrics?${q.toString()}`)
       .then(async (res) => {
         const json = (await res.json().catch(() => ({}))) as Partial<KeywordsMetricsResponse> & { detail?: unknown }
         if (!res.ok) throw new Error(String(json.detail || res.statusText))
         if (cancelled) return
         const series = Array.isArray(json.series_days) ? json.series_days : []
         const topKeywords = Array.isArray(json.top_keywords) ? json.top_keywords : []
         const topReels = Array.isArray(json.top_reels) ? json.top_reels : []
         const reels = Array.isArray(json.reels) ? json.reels : []
         setData({
           series_days: series.map((p) => ({
             day: String((p as KeywordsSeriesPoint).day || ''),
             rows: Number((p as KeywordsSeriesPoint).rows || 0),
             leads: Number((p as KeywordsSeriesPoint).leads || 0),
           })),
           top_keywords: topKeywords.map((k) => ({
             keyword: String((k as KeywordsTopKeyword).keyword || ''),
             rows: Number((k as KeywordsTopKeyword).rows || 0),
             leads: Number((k as KeywordsTopKeyword).leads || 0),
           })),
           top_reels: topReels.map((r) => ({
             reel_id: String((r as KeywordsTopReel).reel_id || ''),
             label: String((r as KeywordsTopReel).label || ''),
             rows: Number((r as KeywordsTopReel).rows || 0),
           })),
           reels,
         })
         setReelOptions(reels)
       })
       .catch(() => {
         if (cancelled) return
         setData({ series_days: [], top_keywords: [], top_reels: [], reels: [] })
         setReelOptions([])
       })
       .finally(() => {
         if (cancelled) return
         setLoading(false)
       })
     return () => {
       cancelled = true
     }
   }, [ready, reelId])
 
   const lineData = useMemo(() => {
     const labels = data.series_days.map((p) => p.day.slice(5)) // MM-DD
     return {
       labels,
       datasets: [
         {
           label: 'Filas (keyword)',
           data: data.series_days.map((p) => p.rows),
           borderColor: 'rgba(59,130,246,0.9)',
           backgroundColor: 'rgba(59,130,246,0.15)',
           fill: true,
           tension: 0.35,
           pointRadius: 2,
         },
       ],
     }
   }, [data.series_days])
 
   const topKeywordsBar = useMemo(() => {
     const top = data.top_keywords.slice(0, 10)
     return {
       labels: top.map((k) => k.keyword || '—'),
       datasets: [
         {
           label: 'Filas',
           data: top.map((k) => k.rows),
           backgroundColor: 'rgba(34,197,94,0.75)',
         },
       ],
     }
   }, [data.top_keywords])
 
   if (!ready) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
 
   return (
     <div>
       <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
         <h2 className="text-lg font-semibold tracking-tight">Métricas · Keyword</h2>
         <div className="flex flex-wrap items-center gap-3">
           <select
             value={reelId}
             onChange={(e) => setReelId(e.target.value)}
             className="w-72 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
           >
             <option value="">Todos los reels</option>
             {reelOptions.map((o) => (
               <option key={o.id} value={o.id}>
                 {o.label}
               </option>
             ))}
           </select>
         </div>
       </div>
 
       <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
         <div className="glass-card p-5">
           <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--text3)]">
             Tendencia (últimos 30 días)
           </div>
           <div className="h-64">
             {loading ? (
               <div className="flex h-full items-center justify-center text-[12px] text-[var(--text3)]">Cargando…</div>
             ) : (
               <Line data={lineData} options={{ responsive: true, maintainAspectRatio: false }} />
             )}
           </div>
         </div>
 
         <div className="glass-card p-5">
           <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--text3)]">
             Top keywords (filas)
           </div>
           <div className="h-64">
             {loading ? (
               <div className="flex h-full items-center justify-center text-[12px] text-[var(--text3)]">Cargando…</div>
             ) : (
               <Bar
                 data={topKeywordsBar}
                 options={{
                   responsive: true,
                   maintainAspectRatio: false,
                   indexAxis: 'y' as const,
                 }}
               />
             )}
           </div>
         </div>
       </div>
     </div>
   )
 }
 
