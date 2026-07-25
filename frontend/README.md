# Laboratorio de Contenido 3.0 — Aumenta Tu Valor

Plataforma de gestion de contenido y ventas para creadores high-ticket. Conecta cada pieza de contenido con el cash que genera.

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 3.4
- **Backend:** Supabase (Auth + PostgreSQL + RLS)
- **Charts:** Chart.js + react-chartjs-2
- **Validacion:** Zod v4
- **Deploy:** Vercel

## Setup rapido (para devs del equipo)

### 1. Clonar el repo

```bash
git clone https://github.com/TU-USUARIO/laboratorio-de-negocio.git
cd laboratorio-de-negocio
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cd frontend
cp .env.example .env.local
```

Abrir `.env.local` y pegar las keys que te mando Thiago:

```
NEXT_PUBLIC_SUPABASE_URL=https://ivnhcozvqprajxzoycbm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<pedir a Thiago>
```

### 4. Levantar el servidor

```bash
npm run dev
```

Abrir http://localhost:3000 — te va a pedir login. Crear una cuenta nueva con tu email.

## Arquitectura

```
src/
├── app/
│   ├── (auth)/              # Login, Signup
│   ├── (main)/              # Todas las secciones (protegidas)
│   │   ├── dashboard/       # Dashboard contenido (KPIs, donut, sparkline)
│   │   ├── reels/           # Trackeo reels + extraction IA
│   │   ├── historias/       # Trackeo historias + screenshot analysis
│   │   ├── youtube/         # Trackeo YouTube + extraction IA
│   │   ├── bio/             # Canal directo BIO (semanas)
│   │   ├── referidos/       # Canal directo referidos
│   │   ├── diferidos/       # Cobros de meses anteriores
│   │   ├── leads/           # Spreadsheet de leads (inline edit, tabs)
│   │   ├── sales-dashboard/ # Dashboard ventas (funnel, tabs M/S/D)
│   │   ├── setter/          # Metricas setter (tabs, charts, metas)
│   │   ├── closer/          # Metricas closer (tabs, charts, metas)
│   │   ├── team/            # Equipo (comisiones, earnings, rendimiento)
│   │   ├── objetivos/       # Metas mensuales editables
│   │   ├── metricas/        # Views IG + followers
│   │   ├── listas/          # Listas maestras (dolores, angulos, CTAs)
│   │   ├── conexiones/      # Conexiones API (Metricool, YT, Apify)
│   │   └── ajustes/         # Perfil + export datos
│   └── auth/callback/       # OAuth callback
│
├── features/                 # Logica por feature
│   ├── auth/                # Login/signup services + forms
│   ├── content-tracking/    # Componente generico de contenido
│   ├── direct-channels/     # Componente generico canales directos
│   ├── dashboard/           # Dashboard services + KPI components
│   ├── leads/               # Leads spreadsheet + inline editing
│   ├── sales-dashboard/     # VD engine (mensual/semanal/diario)
│   └── team/                # Team + setter/closer metrics
│
├── shared/                   # Componentes reutilizables
│   ├── components/          # Sidebar, Topbar, Modal, Toast, Charts, MonthSelector
│   ├── hooks/               # useSupabase, useMonth
│   └── lib/                 # Supabase clients, query helpers
│
└── lib/supabase/            # Supabase client (browser) + server
```

## Base de Datos (Supabase)

12 tablas con RLS habilitado:

| Tabla | Que guarda |
|-------|------------|
| `profiles` | Nombre del usuario |
| `content_items` | Reels, historias, videos (metrics jsonb, classification jsonb) |
| `leads` | Leads de ventas (23 campos, status, closer, programa, pagos) |
| `bio_entries` | Canal directo BIO (semanas, chats) |
| `referral_entries` | Referidos (nombre, referido_por, cash) |
| `deferred_entries` | Cobros diferidos (pieza, tipo, cash) |
| `team_members` | Setters y closers (comisiones) |
| `objectives` | Metas mensuales (cash, chats, views, piezas) |
| `api_connections` | Credentials de APIs externas |
| `master_lists` | Dolores, angulos, CTAs (configurables) |
| `account_metrics` | Views IG + followers por mes |
| `daily_calls` | Llamadas diarias por miembro |

**Todas las tablas usan RLS:** cada usuario solo ve sus propios datos (`auth.uid() = user_id`).

## Flujo de trabajo con Git

```
main (produccion — auto-deploy a Vercel)
  |
  ├── feat/nombre-de-feature   (nueva feature)
  ├── fix/nombre-del-bug        (bug fix)
  └── refactor/nombre            (refactor)
```

**Reglas:**
1. NUNCA pushear directo a `main`
2. Crear branch → hacer cambios → Pull Request → merge
3. Cada PR debe pasar `npm run build` sin errores

```bash
# Crear branch nueva
git checkout -b feat/mi-feature

# Hacer cambios, commit
git add .
git commit -m "feat: descripcion corta"

# Push y crear PR
git push -u origin feat/mi-feature
# Ir a GitHub y crear Pull Request
```

## Comandos

```bash
npm run dev      # Servidor desarrollo (auto-port 3000-3006)
npm run build    # Build produccion (DEBE pasar antes de PR)
npm run lint     # Linter
```

## Design System

- **Background:** #050505 (negro profundo)
- **Accent:** #E63946 (rojo)
- **Text:** #FAFAFA → #A1A1AA → #52525B
- **Green:** #22C55E (cash, positivo)
- **Amber:** #F59E0B (warning)
- **Fonts:** Inter (UI) + JetBrains Mono (numeros)
- **Glass cards:** bg-[var(--bg2)] + border-[var(--border)] + backdrop-blur

## Deploy

Cada push a `main` hace deploy automatico a Vercel.

URL de produccion: https://laboratorio-de-negocio-theta.vercel.app

---

Documentacion de negocio completa en `BUSINESS_LOGIC.md`.
