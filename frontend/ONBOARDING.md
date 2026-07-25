# Onboarding — Laboratorio de Contenido 3.0

Guia paso a paso para que puedas empezar a trabajar en el proyecto hoy.

---

## Requisitos previos

- **Node.js 18+** (descargar de https://nodejs.org)
- **Git** (viene con macOS, o `brew install git`)
- **VS Code** (recomendado) o cualquier editor de codigo
- **Cuenta de GitHub** (para clonar el repo)

Verificar que tenes todo:
```bash
node --version    # Debe decir v18+ o v20+
git --version     # Debe decir git version 2.x
npm --version     # Debe decir 9+ o 10+
```

---

## Paso 1: Clonar el repositorio

```bash
git clone https://github.com/TU-USUARIO/laboratorio-de-negocio.git
cd laboratorio-de-negocio
```

> Thiago te va a mandar el link exacto del repo.

---

## Paso 2: Instalar dependencias

```bash
npm install
```

Esto instala Next.js, React, Supabase, Chart.js y todo lo necesario. Tarda ~30 segundos.

---

## Paso 3: Configurar variables de entorno

```bash
cd frontend
cp .env.example .env.local
```

Abrir `.env.local` con tu editor y pegar las keys que te manda Thiago:

```env
NEXT_PUBLIC_SUPABASE_URL=https://ivnhcozvqprajxzoycbm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la key que te mando Thiago>
```

> IMPORTANTE: Nunca subas `.env.local` a git (ya esta en .gitignore).

---

## Paso 4: Levantar el servidor local

```bash
npm run dev
```

Abrir **http://localhost:3000** en el browser.

Te va a pedir login — **crea una cuenta nueva** con tu email y una contrasena. Cada persona tiene su propia cuenta, y por seguridad (RLS) solo ves tus propios datos.

---

## Paso 5: Verificar que todo funciona

- [ ] Puedo crear cuenta y loguearme
- [ ] Veo el dashboard con la sidebar a la izquierda
- [ ] Puedo navegar a todas las secciones (Reels, Leads, Ventas, etc.)
- [ ] Puedo agregar un reel de prueba
- [ ] Puedo agregar un lead de prueba
- [ ] `npm run build` pasa sin errores

---

## Como trabajar (Git workflow)

### Regla de oro: NUNCA pushear directo a main

```bash
# 1. Antes de empezar, asegurate de estar actualizado
git checkout main
git pull origin main

# 2. Crear branch nueva para tu tarea
git checkout -b feat/nombre-de-tu-tarea

# 3. Hacer tus cambios...

# 4. Verificar que el build pasa
npm run build

# 5. Commit
git add .
git commit -m "feat: descripcion corta de lo que hiciste"

# 6. Push
git push -u origin feat/nombre-de-tu-tarea

# 7. Ir a GitHub y crear Pull Request
#    El equipo revisa → se aprueba → se mergea a main
#    Vercel hace deploy automatico
```

### Tipos de branches

| Prefijo | Cuando usarlo | Ejemplo |
|---------|---------------|---------|
| `feat/` | Feature nueva | `feat/ai-classification` |
| `fix/` | Arreglar un bug | `fix/leads-loading` |
| `refactor/` | Mejorar codigo sin cambiar funcionalidad | `refactor/dashboard-queries` |
| `style/` | Cambios visuales | `style/sidebar-icons` |

---

## Estructura del proyecto

```
src/
├── app/(main)/          # Paginas de la app (cada carpeta = una ruta)
├── features/            # Logica de cada feature (components, hooks, services)
├── shared/              # Componentes reutilizables (Sidebar, Modal, etc.)
└── lib/supabase/        # Clientes de Supabase (browser + server)
```

**Para agregar una feature nueva:**
1. Crear carpeta en `src/app/(main)/tu-feature/page.tsx`
2. Si tiene logica compleja, crear `src/features/tu-feature/`
3. Reutilizar componentes de `src/shared/`

---

## Base de datos

Usamos **Supabase** (PostgreSQL). Las tablas ya estan creadas. Si necesitas modificar la estructura, hacelo via migracion (no tocar la BD directo):

```sql
-- Ejemplo: agregar columna
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS nueva_columna text;
```

**RLS (Row Level Security):** Cada tabla filtra por `user_id`. Esto significa que cada usuario solo ve sus propios datos. SIEMPRE incluir `user_id` al insertar.

---

## Problemas comunes

### "Cargando..." infinito en alguna seccion
La sesion de Supabase tarda ~1 segundo en cargar. Si despues de 5 segundos sigue cargando, refresh la pagina.

### "npm run build" falla con errores de TypeScript
Arreglar los errores antes de hacer PR. Los mas comunes:
- `Property does not exist` → falta un campo en el tipo
- `implicitly has 'any' type` → agregar tipo explicitio

### No puedo ver datos de otro usuario
Correcto — RLS lo impide. Cada usuario solo ve sus datos.

### El deploy fallo en Vercel
Verificar que `npm run build` pasa localmente. Si pasa local pero falla en Vercel, es un problema de env vars.

---

## Contacto

- **Thiago** — Owner del proyecto, dudas de arquitectura o negocio
- **GitHub Issues** — Para reportar bugs o pedir features

---

*Documento actualizado: Marzo 2026*
