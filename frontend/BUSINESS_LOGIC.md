# BUSINESS_LOGIC.md - Laboratorio de Contenido 3.0

> Generado por SaaS Factory | Fecha: 2026-03-26
> Fuente: Reverse-engineering de app.html existente (~8400 lineas) + entrevista con el fundador

---

## 1. Problema de Negocio

**Dolor:** Los creadores de contenido que venden high-ticket (coaching, mentorias, programas) no tienen visibilidad de que pieza de contenido genera plata. No saben que reel trajo chats, que historia cerro una venta, ni como rinde cada canal. Operan a ciegas entre marketing, ventas y equipo.

**Costo actual:**
- Horas semanales cruzando datos entre Instagram Insights, hojas de calculo y CRM
- Decisiones de contenido basadas en vanity metrics (likes) en vez de cash
- No hay forma de saber el cash por chat por canal ni por pieza
- El equipo de ventas (setters/closers) no tiene metricas claras de rendimiento
- Atribucion de ventas rota: no se sabe si la venta vino de un reel, historia o referido

---

## 2. Solucion

**Propuesta de valor:** Una plataforma integral que conecta contenido con ventas para que creadores de contenido high-ticket vean exactamente cuanto cash genera cada pieza, cada canal y cada miembro del equipo.

**Flujo principal (Happy Path):**

1. **El creador se loguea** → ve el Dashboard con KPIs del mes (cash total, chats, piezas, cash por chat)
2. **Importa contenido automaticamente** → Metricool (reels + historias IG), YouTube API, Apify (scraping con transcripcion)
3. **Trackea ventas en el spreadsheet de leads** → leads con status, closer, programa, ingresos, pagos
4. **La IA clasifica el contenido** → Claude analiza transcripciones y asigna dolor, angulo, CTA
5. **Ve metricas cruzadas** → Dashboard de Ventas (funnel), Cash Metrics (cash por pieza), Team Dashboard (comisiones)
6. **Define objetivos y escenarios** → Calcula cuantos chats/views necesita para llegar a su meta de cash
7. **Sincroniza con Airtable** → CRM bidireccional que matchea leads cerrados con piezas de contenido

---

## 3. Usuario Objetivo

**Rol:** Creador de contenido / dueno de negocio que vende high-ticket (coaching, mentorias, programas educativos)

**Contexto:**
- Factura entre $10K-$500K+ USD/mes
- Tiene presencia fuerte en Instagram (reels + historias) y YouTube
- Vende via DMs: contenido genera "chats" (consultas), el equipo agenda calls, closers cierran
- Tiene equipo de ventas: setters (agendan) y closers (cierran)
- Habla espanol (interfaz 100% en espanol)
- Audiencia latinoamericana, mercado de habla hispana
- Programas tipicos: "Boost", "Advantage", "Mentoria" (con precios escalonados)
- Modelo de negocio: contenido organico → DMs → call de ventas → cierre high-ticket

**NO es para:**
- Agencias de marketing
- Creadores que solo monetizan con ads/sponsors
- E-commerce o SaaS B2B tradicional

---

## 4. Arquitectura de Datos

### Input (lo que entra al sistema):

**Automatico (APIs):**
- Metricool API → reels de IG (views, likes, comments, saves, shares, reach) + stories de IG (views, replies, exits, reach)
- YouTube Data API v3 → videos (views, likes, comments, duration, thumbnail)
- Apify Scraper → reels de IG con transcripcion de audio (para clasificacion IA)
- Airtable CRM → leads cerrados con "Punto de agenda" (que pieza genero la venta)

**Manual (el usuario ingresa):**
- Leads: nombre, IG, telefono, avatar, status, origen, programa ofrecido/comprado, ingresos, pago, debe, closer, link de llamada, reporte
- Contenido: fecha, dolor, angulo(s), CTA, titulo CTA, link, chats, cash, notas
- BIO: nombre del lead, fecha, chats, cash (canal directo desde link en bio)
- Referidos: nombre, referido por, fecha, chats, cash
- Diferidos: pieza original, tipo, fecha original, cash (cobros de contenido anterior)
- Metricas de cuenta: views totales IG (manual o via Metricool)
- Objetivos: cash target, chats target, views target, followers target, piezas target
- Listas maestras: dolores, angulos, CTAs (configurables)
- Equipo: setters y closers con nombre, comision (fija o por tiers)

**IA (Claude API via proxy):**
- Extraccion de contenido: el usuario pega texto y Claude clasifica dolor, angulo, CTA
- Clasificacion masiva de reels: usa transcripcion de Apify + listas maestras como contexto
- Importacion de reels: el usuario pega multiples notas y Claude parsea a entradas individuales
- Importacion de historias: screenshot de historias + Claude extrae datos (con vision)

### Output (lo que sale del sistema):

**Dashboards:**
- Dashboard de Contenido: KPIs (cash total, chats total, piezas, cash por chat), breakdown por canal (reels/historias/BIO), sparklines, comparacion vs mes anterior
- Cash Metrics: ranking de piezas por cash generado, top por canal, cash por chat por pieza
- Dashboard de Ventas: funnel completo (chats → agendas → shows → cierres), tasas de conversion, AOV, ticket promedio, cash/agenda, programas ofrecidos vs comprados
- Setter Metrics: metricas del setter (leads contactados, agendas logradas, tasas)
- Closer Metrics: metricas del closer (calls tomadas, cierres, close rate, cash)
- Team Dashboard: rendimiento por miembro, comisiones calculadas (fija o tiers), estado de pago

**Panel de Objetivos:**
- Progreso vs meta de cash mensual
- Chats necesarios calculados desde el cash por chat actual
- Views necesarias calculadas desde ratio views/chat
- Escenarios: volumen (mas contenido), conservador (subir el cash por chat un poco), agresivo (subir el cash por chat mucho)
- Diagnostico de cuellos de botella en el funnel

**Exportaciones:**
- JSON backup de todos los datos
- Sync bidireccional con Airtable

### Storage (Supabase tables):

```
profiles
├── id: uuid (PK, = auth.users.id)
├── full_name: text
├── created_at: timestamptz
└── updated_at: timestamptz

content_items
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── external_id: text (metricool_xxx, yt_xxx, apify_xxx)
├── title: text
├── content_type: text (reel, story, video, historia)
├── platform: text (instagram, youtube)
├── metrics: jsonb {views, likes, comments, saves, shares, reach, plays, thumbnail}
├── classification: jsonb {dolor, angulos[], cta, cta_title}
├── cash: numeric (default 0)
├── chats: integer (default 0)
├── published_at: timestamptz
├── url: text
├── notes: text
├── created_at: timestamptz
└── updated_at: timestamptz

leads
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── client_name: text
├── ig_handle: text
├── phone: text
├── avatar_type: text (select)
├── status: text (Cerrado, Seguimiento, Sena, No show, Re-agenda, Descalificado, Pendiente)
├── source_type: text (Andres, Referido, YouTube, Lead viejo)
├── channel: text (IG Chat, WSP Chat, Referido, YouTube)
├── entry_funnel: text (via - que pieza lo trajo)
├── agenda_point: text (punto de agenda - que pieza genero la agenda)
├── ctas_responded: integer
├── first_contact_at: date
├── scheduled_at: date
├── call_at: date
├── call_link: text
├── closer_report: text
├── program_offered: text
├── program_purchased: text
├── revenue: numeric (ingresos facturados)
├── payment: numeric (cash cobrado)
├── owed: numeric (saldo pendiente)
├── closer: text
├── notes: text
├── created_at: timestamptz
└── updated_at: timestamptz

bio_entries
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── name: text
├── date: date
├── chats: integer
├── cash: numeric
├── month: text (YYYY-MM)
├── created_at: timestamptz
└── updated_at: timestamptz

referral_entries
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── name: text
├── referred_by: text
├── date: date
├── chats: integer
├── cash: numeric
├── notes: text
├── month: text (YYYY-MM)
├── created_at: timestamptz
└── updated_at: timestamptz

deferred_entries
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── piece_name: text
├── content_type: text
├── original_date: date
├── cash: numeric
├── notes: text
├── month: text (YYYY-MM)
├── created_at: timestamptz
└── updated_at: timestamptz

team_members
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── name: text
├── role: text (setter, closer)
├── commission_type: text (fijo, tiers)
├── commission_pct: numeric
├── commission_tiers: jsonb [{min, max, pct}]
├── is_active: boolean
├── created_at: timestamptz
└── updated_at: timestamptz

objectives
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── month: text (YYYY-MM)
├── cash_target: numeric
├── chats_target: integer
├── views_target: integer
├── followers_target: integer
├── pieces_target: integer
├── scenario: text (volume, conservative, aggressive)
├── created_at: timestamptz
└── updated_at: timestamptz

api_connections
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── platform: text (metricool, youtube, apify, airtable)
├── credentials: jsonb (encrypted tokens/keys)
├── last_sync_at: timestamptz
├── created_at: timestamptz
└── updated_at: timestamptz

master_lists
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── category: text (dolores, angulos, ctas)
├── items: jsonb (string array)
├── updated_at: timestamptz
└── created_at: timestamptz

account_metrics
├── id: uuid (PK)
├── user_id: uuid (FK → auth.users)
├── month: text (YYYY-MM)
├── account_views: integer
├── followers: integer
├── updated_at: timestamptz
└── created_at: timestamptz
```

**RLS Policies (TODAS las tablas):**
- SELECT: `auth.uid() = user_id`
- INSERT: `auth.uid() = user_id`
- UPDATE: `auth.uid() = user_id`
- DELETE: `auth.uid() = user_id`

---

## 5. KPI de Exito

**Metrica principal:** Visibilidad completa del negocio — saber exactamente cuanto cash genera cada pieza de contenido, cada canal y cada miembro del equipo, con metricas en tiempo real.

**KPIs especificos:**
- Cash por chat por canal: Reels, Historias, BIO
- Funnel completo: Chats → Agendas → Shows → Cierres (con tasas de conversion)
- Cash total del mes vs objetivo
- Rendimiento del equipo: comisiones, close rate por closer
- Atribucion de contenido: que pieza trajo que venta

---

## 6. Especificacion Tecnica (Para el Agente)

### Features a Implementar (Feature-First)

```
src/features/
├── auth/                # Autenticacion Email/Password (Supabase)
├── dashboard/           # Dashboard principal de contenido (KPIs, sparklines, comparaciones)
├── leads/               # Spreadsheet tipo Airtable (filtros, sort, group, inline edit, bulk actions)
├── sales-dashboard/     # Dashboard de ventas (funnel SVG, tasas de conversion, revenue)
├── setter/              # Metricas del setter (leads contactados, agendas, tasas)
├── closer/              # Metricas del closer (calls, cierres, close rate, cash)
├── team/                # Dashboard de equipo (roster, comisiones fijas/tiers, estado de pago)
├── content-tracking/    # Trackeo de contenido (reels, historias, youtube)
│   ├── reels/           # CRUD reels con dolor, angulo multi-select, CTA, chats, cash
│   ├── historias/       # CRUD historias con dolor, angulo multi-select, CTA, chats, cash
│   └── youtube/         # CRUD videos youtube con metricas
├── direct-channels/     # Canales directos
│   ├── bio/             # BIO entries (leads desde link en bio)
│   ├── referidos/       # Referidos entries
│   └── diferidos/       # Cobros diferidos (atribucion cruzada de meses anteriores)
├── content-metrics/     # Metricas de contenido agregadas (sync con Airtable)
├── objectives/          # Panel de objetivos, escenarios, diagnostico de funnel
├── ai-analysis/         # Clasificacion IA (Claude): dolor, angulo, CTA desde texto/transcripcion
├── import/              # Importacion masiva (reels batch, historias con imagen, quick load mode)
├── api-connections/     # Conexiones API (Metricool, YouTube, Apify, Airtable)
├── master-lists/        # Listas maestras configurables (dolores, angulos, CTAs)
└── settings/            # Ajustes de cuenta (email, export JSON, reset data)
```

### Migracion de Datos: localStorage → Supabase

**Principio:** Supabase es el source of truth. NO mas localStorage como storage primario.

- Todos los datos se leen/escriben directo a Supabase via server actions
- Cache local solo para performance (React Query / SWR)
- El "Bridge" actual (sync bidireccional) se elimina completamente
- Las API keys del usuario se guardan en `api_connections` (Supabase), no en localStorage

### Integraciones Externas

| Servicio | Proposito | Flujo |
|----------|-----------|-------|
| Metricool API v2 | Import reels + stories de IG | Server action → Supabase content_items |
| YouTube Data API v3 | Import videos del canal | Server action → Supabase content_items |
| Apify (instagram-reel-scraper) | Scraping IG con transcripcion | Server action → Supabase content_items |
| Anthropic Claude API | Clasificacion IA de contenido | API route (proxy) → response al client |
| Airtable API | CRM sync bidireccional (leads, cash) | Server action → matchea con content_items |

**IMPORTANTE:** Todas las API calls a servicios externos van por server actions o API routes. NUNCA exponer tokens en el cliente. Las credenciales del usuario se guardan encriptadas en Supabase.

### Design System: Liquid Glass (Negro + Rojo)

**Tema:** Dark mode con estetica liquid glass (transparencias, blurs, gradientes sutiles)

- **Background:** Negro profundo (#050505) con capas de superficie
- **Accent:** Rojo marca (#E63946) — CTA, active states, highlights
- **Texto:** Blanco (#FAFAFA) con jerarquia en grises
- **Semantico:** Verde (#22C55E) para cash/positivo, Amber (#F59E0B) para warnings, Rojo para negativo
- **Glass:** backdrop-filter blur + bordes con opacidad + sombras difusas
- **Tipografia:** Inter (UI) + JetBrains Mono (numeros/metricas)
- **Componentes:** Cards con glass-morphism, KPI cards, progress bars, funnel SVG, sparklines
- **Sidebar:** 240px fija, navegacion con iconos y badges de conteo

### Stack Confirmado
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 3.4 + shadcn/ui
- **Backend:** Supabase (Auth + Database + Storage + RLS)
- **Validacion:** Zod
- **State:** Zustand (si necesario para estado complejo de spreadsheet/filtros)
- **Charts:** Chart.js o Recharts (para funnel, sparklines, progress bars)
- **AI:** Anthropic Claude API via server-side proxy (API route)
- **MCPs:** Next.js DevTools + Playwright + Supabase

### Proximos Pasos
1. [ ] Setup proyecto base (ya existe la estructura Next.js)
2. [ ] Configurar Supabase: crear TODAS las tablas + RLS policies
3. [ ] Implementar Auth (login/register con email/password)
4. [ ] Feature: Dashboard de contenido (KPIs, sparklines, comparaciones mes anterior)
5. [ ] Feature: Content tracking (reels, historias, youtube) — CRUD completo
6. [ ] Feature: Leads spreadsheet (filtros, sort, group, inline edit)
7. [ ] Feature: Sales dashboard (funnel, tasas de conversion)
8. [ ] Feature: Direct channels (bio, referidos, diferidos)
9. [ ] Feature: Objectives panel (metas, escenarios, diagnostico)
10. [ ] Feature: Cash metrics (ranking por pieza, breakdown por canal)
11. [ ] Feature: Team dashboard (setter, closer, comisiones)
12. [ ] Feature: API connections (Metricool, YouTube, Apify)
13. [ ] Feature: AI analysis (clasificacion con Claude)
14. [ ] Feature: Import masivo (batch reels, historias con imagen)
15. [ ] Feature: Master lists (dolores, angulos, CTAs)
16. [ ] Feature: Airtable sync bidireccional
17. [ ] Feature: Settings (export, reset)
18. [ ] Design system: Liquid Glass negro + rojo en toda la app
19. [ ] Testing E2E con Playwright
20. [ ] Deploy Vercel
