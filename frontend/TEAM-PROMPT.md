# Prompt para el equipo — Copiar y pegar en Claude Code al inicio de cada sesion

---

**Copiar todo lo de abajo y pegarlo como primer mensaje en Claude Code:**

---

Estoy trabajando en el proyecto **Laboratorio de Contenido 3.0** — una plataforma SaaS para creadores de contenido high-ticket que conecta contenido con ventas.

## Contexto del proyecto

**Repo:** https://github.com/Snzzzzz/laboratorio-de-negocio
**Deploy:** https://laboratorio-de-negocio-theta.vercel.app
**Owner:** Thiago (@Snzzzzz)

## Tech Stack

- **Next.js 16** + React 19 + TypeScript 5.7 (App Router)
- **Tailwind CSS 3.4** (NO shadcn/ui, todo custom)
- **Supabase** (Auth email/password + PostgreSQL + RLS) — `@supabase/supabase-js` 2.49 + `@supabase/ssr` 0.6
- **Chart.js 4.5** + react-chartjs-2 5.3 (graficos)
- **Zod v4** (validacion — usa `.issues` no `.errors`)
- **Deploy:** Vercel (auto-deploy en push a main)
- **NO** usa Zustand, shadcn/ui, ni CSS Modules

## Arquitectura

```
src/
├── app/(auth)/           # Login, Signup (redirige a /dashboard si logueado)
├── app/(main)/           # Todas las secciones protegidas (redirige a /login si no logueado)
│   ├── dashboard/        # KPIs, sparkline cash, donut, chats, cash por chat, referidos, diferidos, objetivos
│   ├── reels/            # CRUD reels + extraction IA + form con listas maestras
│   ├── historias/        # CRUD historias + screenshot analysis + secuencias
│   ├── youtube/          # CRUD videos + YouTube Analytics OAuth2 + CTR/retention
│   ├── bio/              # Canal directo BIO — tabs Automatico (ManyChat) / Manual
│   ├── referidos/        # Canal directo referidos
│   ├── diferidos/        # Cobros de meses anteriores
│   ├── leads/            # Spreadsheet leads (tabs status, inline edit, 23 campos)
│   ├── sales-dashboard/  # Dashboard ventas VD (tabs Mensual/Semanal/Diario, funnel, charts)
│   ├── setter/           # Metricas setter (tabs, KPIs, charts, rendimiento, metas)
│   ├── closer/           # Metricas closer (tabs, KPIs, charts, rendimiento, metas)
│   ├── team/             # Equipo (earnings, comisiones, estado pago, rendimiento)
│   ├── objetivos/        # Metas mensuales editables
│   ├── metricas/         # Views IG + followers
│   ├── listas/           # Listas maestras (dolores, angulos, CTAs)
│   ├── conexiones/       # API connections (ManyChat, Metricool, YouTube, Apify, Airtable)
│   └── ajustes/          # Perfil + export JSON
├── app/api/              # API Routes
│   ├── webhooks/manychat/  # POST — webhook ManyChat (auto-log chats de bio)
│   ├── sync/apify/         # POST — sync reels via Apify scraper
│   ├── sync/metricool/     # POST — sync reels + historias via Metricool
│   ├── sync/youtube/       # POST — sync videos via YouTube Data API
│   ├── youtube-analytics/  # GET — fetch CTR + retention
│   ├── youtube-analytics/auth/     # GET — redirect a Google OAuth2
│   ├── youtube-analytics/callback/ # GET — OAuth2 callback, guarda tokens
│   ├── classify/           # POST — clasificacion IA con Claude
│   └── analyze-image/      # POST — analisis de imagenes
├── features/             # Logica por feature (components, hooks, services, types)
├── shared/               # Componentes reutilizables
│   ├── components/       # Sidebar, Topbar, Modal, Toast, Charts, MonthSelector, AppProviders
│   ├── hooks/            # useSupabase (CRITICO), useMonth
│   └── lib/supabase/     # queries.ts (formatCash, formatK, getMonthRange)
└── lib/supabase/         # client.ts (singleton browser), server.ts (server components)
```

## Base de datos — 13 tablas Supabase con RLS

| Tabla | Campos clave |
|-------|-------------|
| `profiles` | id (=auth.users.id), full_name, brand_name |
| `content_items` | user_id, content_type (reel/historia/story/video), platform, metrics (jsonb), classification (jsonb), cash, chats, published_at |
| `leads` | user_id, client_name, status, ig_handle, phone, avatar_type, origin, entry_channel, program_offered/purchased, revenue, payment, owed, closer, setter, month |
| `bio_entries` | user_id, name, chats, cash, month (entradas manuales) |
| `manychat_chats` | user_id, keyword, contact_name, contact_ig_username, manychat_contact_id, month, received_at (auto via webhook) |
| `referral_entries` | user_id, name, referred_by, chats, cash, month |
| `deferred_entries` | user_id, piece_name, content_type, cash, month |
| `team_members` | user_id, name, role (setter/closer), comision_pct, commission_type, meta_llamadas/agendas/cierres/cash |
| `objectives` | user_id, month, cash_target, chats_target, views_target, pieces_target, scenario |
| `api_connections` | user_id, platform (metricool/youtube/apify/airtable/manychat), credentials (jsonb) |
| `master_lists` | user_id, category (dolores/angulos/ctas), items (jsonb array) |
| `account_metrics` | user_id, month, account_views, followers |
| `daily_calls` | user_id, member_name, date, llamadas |

**RLS:** Todas las tablas tienen `auth.uid() = user_id` en SELECT/INSERT/UPDATE/DELETE.

**Funciones RPC:**
- `log_manychat_chat(p_webhook_token, p_keyword, ...)` — SECURITY DEFINER, busca user por token en api_connections y loguea el chat. Usada por el webhook de ManyChat.

## Integraciones externas

| Integracion | Como funciona |
|-------------|---------------|
| **ManyChat** | Webhook POST a `/api/webhooks/manychat`. Cada DM con keyword de bio se loguea automaticamente en `manychat_chats`. Token generado en Conexiones API. |
| **Metricool** | Sync manual desde `/reels` o `/historias`. Trae metricas de IG (views, likes, comments, reach). |
| **YouTube Data API** | Sync manual desde `/youtube`. Trae videos con metricas. |
| **YouTube Analytics OAuth2** | OAuth2 flow en `/api/youtube-analytics/auth` -> callback -> guarda tokens. Trae CTR + retention por video. |
| **Apify** | Scraper de reels IG con transcripcion de audio. Sync manual. |
| **Airtable** | CRM bidireccional para matchear leads cerrados con contenido. |

## Patrones criticos que DEBES seguir

### 1. useSupabase hook (OBLIGATORIO en componentes client)
```tsx
// SIEMPRE usar este patron en paginas 'use client'
const { supabase, ready, userId } = useSupabase()

// SIEMPRE esperar ready antes de queries
const fetchData = useCallback(async () => {
  if (!ready) return
  // ... queries aqui
}, [ready, supabase])
```
**NUNCA** usar `getSupabase()` directo ni `createClient()` en componentes. El hook maneja la sesion.

### 2. Supabase client singleton
`src/lib/supabase/client.ts` tiene un singleton. No crear instancias nuevas.

### 3. Proteccion de rutas (sin middleware)
- `src/app/(main)/layout.tsx` — verifica auth con `supabase.auth.getUser()`, redirige a /login si no hay sesion
- `src/app/(auth)/layout.tsx` — redirige a /dashboard si ya hay sesion
- NO hay middleware.ts — fue eliminado porque causa problemas en Vercel con Next.js 16

### 4. Month context
Todas las secciones usan `useMonthContext()` de `AppProviders` para el mes seleccionado. El selector esta en la sidebar.

### 5. Design system
- Background: #050505 (--bg), #0C0C0E (--bg2), #141416 (--bg3), #1E1E22 (--bg4)
- Accent: #E63946 (rojo)
- Text: #FAFAFA (--text), #A1A1AA (--text2), #52525B (--text3)
- Green: #22C55E (cash/positivo), Amber: #F59E0B (warning)
- Glass cards: `className="glass-card"` (definido en globals.css)
- Numeros: `className="font-mono-num"` (JetBrains Mono)
- Todo en espanol

### 6. Chart.js
Importar de `@/shared/components/charts` (registra plugins). `cutout` va en options, NO en dataset.

## Git workflow

```bash
git checkout main && git pull
git checkout -b feat/mi-tarea
# ... cambios ...
npm run build  # DEBE pasar
git add . && git commit -m "feat: descripcion"
git push -u origin feat/mi-tarea
# Crear PR en GitHub o merge local
```

**NUNCA** pushear directo a main. Usar branches y merge.

## 18 secciones implementadas (funcional)

- Auth completo (login/signup/logout)
- Dashboard con sparkline, donut, cash por chat, referidos, diferidos, objetivos sidebar
- Cash Metrics con donut, tops dolor/angulo/CTA, ranking piezas
- Sales Dashboard VD con tabs Mensual/Semanal/Diario, funnel, charts, comparaciones
- Setter/Closer con tabs, KPIs, charts, rendimiento individual, metas
- Team con earnings, comisiones, estado pago
- Leads con tabs status, inline editing, sort
- Reels/Historias/YouTube con forms + dropdowns de listas maestras + sync APIs
- YouTube Analytics con OAuth2 + CTR + retention
- BIO con tabs Automatico (ManyChat webhook) / Manual
- Referidos y Diferidos
- Objetivos editables, Metricas IG, Listas maestras
- Conexiones API (ManyChat, Metricool, YouTube, Apify, Airtable)
- Ajustes (perfil + export)

## Que falta mejorar

- Leads: filtros avanzados (AND/OR), agrupar por campo, vistas guardadas
- Dashboard: sparkline interactivo con hover (3 lineas: actual, mes anterior, proyeccion)
- Sales Dashboard: charts de volumen (Ingresos/Conversaciones/Agendas por mes), seccion programas completa
- Setter/Closer: charts individuales por persona, close rate historico por semana
- Cash Metrics: content cards con thumbnails de IG, layout 3 columnas (Reels/Historias/YouTube)
- AI Analysis: clasificacion con Claude API (extraction de dolor/angulo/CTA desde transcript)
- Import masivo de reels/historias

## Referencia

- `BUSINESS_LOGIC.md` en la raiz tiene toda la logica de negocio
- `ONBOARDING.md` tiene el setup paso a paso

---

Ahora decime en que tarea estas trabajando y te ayudo.
