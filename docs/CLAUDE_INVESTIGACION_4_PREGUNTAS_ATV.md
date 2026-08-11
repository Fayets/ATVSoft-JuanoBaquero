# Investigación — 4 preguntas funcionales ATV (Juano, user_id=1)

Investigación de código + consultas read-only en Neon. **Sin cambios aplicados.**

Anclas verificadas intactas: 362 pagos / $265.526,99 en `lead_payment`; julio dashboard ~$163.195,80; 353 links Fathom.

---

## 1. Closers — alta y asignación desde GHL

### 1.1 Cómo funciona hoy

| Tema | Dónde vive |
|------|------------|
| **Alta / administración UI** | `frontend/src/app/(main)/team/equipo/page.tsx` — pantalla **Equipo** (`/team/equipo`), no Listas maestras |
| **API alta/baja/edición** | `backend/src/controllers/team_controller.py` → `create_member`, `update_member`, `delete_member` |
| **Modelo persistente** | `backend/src/models.py` → `TeamMember` (`teammember`): `nombre`, `rol` (`setter` \| `closer` \| `cash` \| `triajer`), `activo` |
| **Modelo `Closer` separado** | **No existe** |
| **Campo en el lead** | `Lead.closer` — varchar texto libre; comentario en modelo: “nombre en teammember, texto libre para compatibilidad” (`models.py`) |
| **`closer_norm`** | Columna en `Lead`; se escribe **solo en migración legacy** vía `legacy_juano_import.normalize_closer()` + dict `CLOSER_ALIASES` (3 entradas: catalina, ignacio, matias). **No se actualiza** al editar `closer` en `leads_controller.patch_lead` ni en sync GHL |
| **Dropdowns en UI** | Leads y panel diario cargan nombres desde `GET /team/members` (`team_controller.list_members`) filtrando `rol === 'closer'`; incluyen nombres ya guardados aunque el miembro esté inactivo (`leads-page.tsx` → `buildColumns`) |
| **Permisos / usuarios login** | `TeamMember` es catálogo operativo; **no** está ligado a `AuthUser`. Los closers no necesitan cuenta ATV para existir en reportes |
| **Reportes por closer** | Agrupan por **`lead.closer`** (no `closer_norm`): `closer_report_auto_service._lead_closer_name`, `getMemberMetrics(..., field: 'closer')` en `leads-analytics.ts` |
| **Reportes denormalizados** | Tabla `closer_report` — snapshot diario por `member_id`; se genera bajo demanda (`team_controller.generate_closer_report*`), no se recalcula solo al cambiar `lead.closer` retroactivamente |

### 1.2 Asignación automática desde GHL — respuesta central

**Sí: el closer viene de GHL en la gran mayoría de los casos.** No es carga manual sistemática.

Flujo sync (polling + botón “Actualizar” panel diario):

1. `ghl_controller._fetch_contacts_with_appointments` → por cada cita obtiene contacto
2. `ghl_controller._ghl_owner_from_sync` — prioridad:
   - Objetos embebidos en la cita: `assignedUser`, `assigned_user`, `user`
   - **`assignedUserId`** → `ghl_controller._resolve_ghl_user_name` → **GET `/users/{id}`** a GHL
   - Fallback: `contact.assignedTo` / `assigned_to` (también resuelto vía API)
3. Nombre del contacto: `ghl_controller._ghl_contact_display_name`
4. Persistencia: `ghl_controller._apply_appointment_to_lead` — **`row.closer = closer_name` solo si viene no vacío** (no pisa con `""`)

Flujo webhook (`POST /ghl/webhook`):

1. `ghl_controller.ghl_webhook`
2. Closer: `ghl_controller._ghl_owner_from_webhook_body` — busca en `body.user`, `Propietario de la cita`, `calendar.user`, `triggerData.user`, `appointment.user`, etc.
3. **Sin lookup API** si solo llega un ID opaco (comentario explícito en código)
4. Misma persistencia en `_apply_appointment_to_lead`

**No hay tabla de equivalencias GHL user id ↔ closer ATV.** La resolución es nombre legible devuelto por la API de GHL en el momento del sync/webhook.

**Verificación empírica Neon (user_id=1):**

```text
Leads con ghl_appointment_id:     1.607
Con closer poblado:               1.592  (99,1 %)
Sin closer:                          15  (0,9 %)

Distribución closer (source='atv', top): Gabriel Perez 368, Santiago Torrico 360, …, (vacío) 27 total en todos los leads
```

Ejemplos recientes GHL con closer:

| id | nombre | closer | origen |
|----|--------|--------|--------|
| 7031 | Samuel Escobar | Ignacio Claveria | GHL |
| 7030 | Carlos Giraldo | Catalina Zarlenga | GHL |
| 7027 | Ignacio Chavez | Matias Sandobal | GHL |

**Conclusión:** si `ghl_appointment_id` está poblado, casi siempre hay `closer` — viene del owner de la cita en GHL. Los 15 vacíos son excepción (payload sin owner resoluble o sync previo a la lógica actual).

### 1.3 Reasignación de llamadas existentes

| Capacidad | Estado |
|-----------|--------|
| UI individual | **Sí** — columna `closer` editable en Leads (`leads-page.tsx`); panel diario parchea `PATCH /leads/{id}` (`daily-panel-service.ts`) |
| UI masiva closer | **No existe** (sí existe `POST /leads/asignar-triajers-dia` solo para triajers) |
| Qué actualizar manualmente | `lead.closer` (y opcionalmente `closer_norm` si se usa para analytics legacy — hoy los reportes **no** lo usan) |
| `closer_report` | Filas históricas **no** se mueven solas; hay que regenerar reportes del día vía Team si se quiere consistencia |
| Closers nuevos + alias | Alta en **Equipo → + Closer**. Para nombres cortos de GHL distintos al catálogo, conviene que el **nombre en GHL** coincida con `TeamMember.nombre` o editar leads a mano. `CLOSER_ALIASES` solo aplica en import legacy, no en runtime GHL |

### Qué falta / no existe

- Modelo `Closer` dedicado, FK lead→closer, tabla de mapeo GHL user id
- Actualización automática de `closer_norm` al editar o sincronizar
- Reasignación masiva de closer
- Recálculo retroactivo de `closer_report` al cambiar closers

### Qué habría que hacer (estimación)

| Tarea | Esfuerzo |
|-------|----------|
| Documentar convención “nombre GHL = nombre Equipo” | Bajo (operativo) |
| Script SQL/UI bulk update `lead.closer` + regenerar reportes | Medio (1–2 días) |
| Tabla `ghl_user_id → team_member_id` + sync robusto | Medio-alto (3–5 días) |
| Mantener `closer_norm` en patch/sync + ampliar alias | Bajo-medio (1 día) |

---

## 2. Nombres incompletos en el Dashboard diario

### 2.1 Origen del dato

| Paso | Archivo:función |
|------|-----------------|
| API panel diario | `leads_controller.leads_llamadas_hoy` → `agent_closer_service.list_llamadas_dia` |
| Campo expuesto | `agent_closer_service._llamada_item` → **`"lead": (l.nombre or "").strip()`** |
| Frontend | `daily-calls-table.tsx` muestra `row.lead` sin truncar (solo CSS; `title` con nombre completo) |
| Alta manual | `leads_controller.create_manual_call` usa `client_name` → `Lead.nombre` |

**No hay truncado en frontend:** si en pantalla aparece “vale”, en BD debería estar igual (salvo CSS overflow visual).

**Consulta Neon** — nombres ≤6 caracteres (muestra): `Yei`, `Jhon`, `Juan`, `Lina`, `Javi`, `Ever`, `Diego`, etc. Son **datos reales** en `lead.nombre`, muchos con `ghl_appointment_id`.

Búsqueda `LIKE '%vale%'`: no hay fila con nombre exacto `"vale"`; sí hay `Valentina Sepulveda`, `valentin chairo`, etc. El ejemplo del cliente puede ser otro tenant/día o nickname no indexado literalmente.

### 2.2 ¿Se puede recuperar el nombre completo?

| Fuente | Disponible |
|--------|------------|
| **`lead.nombre`** | Única fuente para panel diario hoy |
| **`ghl_contact_id`** | **Sí** — columna en `Lead`; sync usa `ghl_controller._get_contact_cached` → GET `/contacts/{id}` |
| **Re-sync GHL** | `_apply_appointment_to_lead` **sobrescribe** `row.nombre = display_name` si GHL trae nombre mejor (`_ghl_contact_display_name`: `full_name` → `name` → `firstName` + `lastName`) |
| **`lead.formulario`** | JSON con **7 preguntas de calificación** (`lead_formulario.py`); **no incluye nombre** — el contacto va en columnas `nombre`/`email`/`telefono`/`ig` |
| **Typeform / landing crudo** | No hay tabla de respuestas crudas aparte del JSON `formulario` |

**Diagnóstico típico:** GHL guardó solo `firstName` (“Vale”, “Juan”, “Jhon”). ATV persiste lo que devuelve la API de contacto. El nombre completo **solo existe en GHL** si allí está completo; ATV puede refrescarlo en el próximo sync si GHL lo tiene en `lastName` / `full_name`.

### Qué falta / no existe

- Campo separado `nombre_completo` vs display corto
- Pull automático de nombre completo al mostrar panel diario
- Nombre en respuestas de formulario

### Qué habría que hacer (estimación)

| Tarea | Esfuerzo |
|-------|----------|
| Re-sync contactos GHL con `ghl_contact_id` para backfill nombres | Medio (script + API, 1–2 días) |
| Mostrar email/teléfono/IG junto al nombre corto en panel diario | Bajo (UI, horas) |
| Enriquecer en webhook/sync si `length(nombre) < N` y GHL tiene más campos | Bajo-medio (1 día) |

---

## 3. Notificación por email al triajer cuando entra una call nueva

### 3.1 Qué existe hoy

| Canal | Estado |
|-------|--------|
| **Email (SMTP, SendGrid, Resend, Mailgun, smtplib)** | **No implementado** en backend (búsqueda en repo: cero uso productivo; mención solo en docs frontend) |
| **Discord** | `discord_service.py` — webhooks para reportes setter, closer ventas, análisis Fathom (`DISCORD_*_WEBHOOK_URL`) |
| **WhatsApp / agente** | `agent_closer_service.list_proximas_llamadas` — flag `recordatorio_enviado` (migración `db.py` comenta “bot WhatsApp”); **no es email** |
| **In-app / push** | No encontrado |

**APScheduler** (`backend/main.py` → `lifespan`):

| Job | Intervalo |
|-----|-----------|
| `auto_sync_stories` | Configurable BD (historias IG) |
| `auto_refresh_reels_metrics` | Configurable BD |
| `auto_sync_calendly` | Configurable BD |
| **`auto_sync_ghl`** | **Cada 4 horas** (mes actual, silencioso) |
| Jobs adicionales vía `sync_scheduler_service.apply_sync_schedules` | Según BD |

Además: **webhook GHL** en tiempo real (`POST /ghl/webhook` y `/api/ghl/webhook`).

### 3.2 Datos disponibles

| Campo | Contenido |
|-------|-----------|
| `lead.triajer` | **Nombre** del triajer (varchar), no ID |
| Asignación | `triajer_service.pick_next_triajer` — round-robin por carga entre `TeamMember` activos con `rol='triajer'` |
| Email del triajer | **No existe** — `TeamMember` solo tiene `nombre`, `rol`, `activo` |
| Usuarios login | Tabla auth separada; no vinculada a triajers |

Asignación en lead GHL nuevo: `ghl_controller._apply_appointment_to_lead` — si `triajer` vacío → `pick_next_triajer(user_id)`.

Endpoint batch: `leads_controller.asignar_triajers_dia` para llamadas del día sin triajer.

### 3.3 Punto de enganche

| Evento | Función |
|--------|---------|
| Lead nuevo/actualizado GHL | `ghl_controller._apply_appointment_to_lead` (desde sync o webhook) |
| Webhook | `ghl_controller.ghl_webhook` |
| Polling | `ghl_controller.run_ghl_auto_sync_all_users` ← scheduler 4 h |

**Momento ideal para email:** al final de `_apply_appointment_to_lead` cuando retorna `"created"`, o al inicio del webhook tras crear.

### Qué falta / no existe

- Infraestructura de email
- Email en `TeamMember` o lookup triajer→email
- Plantilla / preferencias de notificación
- Job o evento post-creación

### Qué habría que hacer (estimación)

| Tarea | Esfuerzo |
|-------|----------|
| Campo `email` en `TeamMember` + UI Equipo | Bajo (0,5–1 día) |
| Integración SendGrid/Resend + env vars | Bajo-medio (1 día) |
| Servicio `notify_triajer_new_call(lead)` enganchado en `_apply_appointment_to_lead` | Medio (1–2 días) |
| Idempotencia (no re-enviar en re-sync) | Bajo (flag o comparar created_at) |
| **Total MVP** | **~3–5 días** |

---

## 4. Pago de cuota — flujo completo

### 4.1 Alta del pago

| Tema | Detalle |
|------|---------|
| **Pantalla** | **Cobranzas** → `/cobranzas` (listado deudores) → `/cobranzas/[leadId]` (`cobranza-perfil-page.tsx`) |
| **API** | `cobranzas_controller.create_pago` → inserta fila en **`lead_payment`** (`LeadPayment`) |
| **Campos UI/API hoy** | `monto`, `fecha`, `nota` (frontend fija `"Cuota"`), `comprobante_url` opcional |
| **`concepto`** | Existe en modelo/BD y en import legacy; **no** está en `LeadPaymentCreateRequest` ni en UI Cobranzas — **siempre queda vacío** en pagos manuales |
| **Plan de cuotas** | **No existe** entidad de plan. Pagos son filas independientes. Legacy `legacy_cuota_ref` es snapshot histórico (`models.py`), no gobierna saldos |

Validación al crear: `_assert_cuota_within_debt` — suma de cuotas del historial no puede superar `Lead.debe`.

### 4.2 Dónde se refleja un pago con `concepto = '2da Cuota'`

Escenario **import legacy / filas ya migradas** (362 pagos con concepto poblado):

| Destino | ¿Impacta? | Cómo |
|---------|-----------|------|
| **Dashboard ventas — bucket Cuotas** | **Sí** | `leads-analytics.ts` → `cashBucketForConcepto`: `'2da Cuota'` \| `'3ra Cuota'` → bucket `cuotas`; datos vía `GET /cobranzas/pagos/month` |
| **Cobranzas — historial del lead** | **Sí** | `cobranzas_controller.get_perfil` lista `LeadPayment` del lead |
| **`lead.pago`** | **Sí, pero solo vía import** | `legacy_juano_import.recalc_lead_financials` suma pagos (excl. programados/monto_cero) → `lead.pago`. **create_pago NO llama recalc** |
| **Dashboard clientes — % avance** | **Indirecto** | `clients_service.compute_progress` usa **fecha inicio + duración programa**, no cada cuota. `resolve_start_date` puede usar **primer** `LeadPayment.fecha**. `sale_status_from_lead` mira `lead.pago > 0` |
| **Trackeo clientes — buckets** | **Indirecto** | `clients_service.client_tags` — tags `proxima_vencer`, `vencido`, etc. según `progress_percent` y completitud de datos, no por concepto de cuota |

Escenario **pago manual desde Cobranzas hoy**:

- Aparece en historial Cobranzas ✓
- Dashboard ventas: concepto vacío → cae en bucket **`pago`**, no **`cuotas`** ✗ (respecto a expectativa del doc)
- `lead.pago` / `lead.debe` **no se actualizan** ✗

### 4.3 Saldo pendiente

| Tema | Detalle |
|------|---------|
| **Referencia de deuda** | `Lead.debe` — “precio contrato − pagado” calculado en migración (`recalc_lead_financials` + `legacy_meta.precio_contrato`) |
| **Saldo operativo Cobranzas** | Frontend `debeRestante(lead)` = `debe − total_pagado_historial` (`cobranzas/types/index.ts`) — **no muta** `Lead.debe` al registrar cuotas |
| **`debe` NULL** | Neon: **268 / 2.783** leads con `debe IS NULL`; **44** con `debe > 0`. NULL se trata como **0** (`float(debe or 0)`) → **no aparecen en listado deudores** y **no permiten cargar cuota** (`maxCuotaPermitida` = 0) |
| **Plan de cuotas ATV** | No existe; cada `lead_payment` es independiente; tope = `Lead.debe` si está definido |

Conteo conceptos en `lead_payment` (user_id=1): 1ra Cuota 137, PIF 129, Fee 62, 2da Cuota 23, 3ra Cuota 7, Otro 4.

### Qué falta / no existe

- Selector `concepto` en UI Cobranzas
- Recalcular `lead.pago` al crear/editar/borrar pago manual
- Plan de cuotas estructurado
- Uso de `debe` NULL para leads sin contrato conocido (bloquea cobranzas operativa)

### Qué habría que hacer (estimación)

| Tarea | Esfuerzo |
|-------|----------|
| Exponer `concepto` en create/patch + UI desplegable | Bajo (1 día) |
| Hook `recalc_lead_financials` (o equivalente) post CRUD cobranzas | Medio (1–2 días) |
| Permitir cargar cuota con `debe` NULL (modo “sin tope” o captura manual de contrato) | Medio (2 días) |
| Plan de cuotas (opcional, largo plazo) | Alto (1–2 semanas) |

---

## Resumen ejecutivo para el operador

1. **Closers:** se administran en **Equipo** (`TeamMember`), no Listas maestras. **GHL asigna el closer automáticamente** (~99% de citas) vía owner de la cita + API `/users/{id}`. Reasignación masiva no existe; reportes usan `lead.closer`, no `closer_norm`.
2. **Nombres cortos:** el panel muestra `lead.nombre` tal cual llegó de GHL (a menudo solo firstName). No es truncado UI. Se puede refrescar re-sincronizando contacto por `ghl_contact_id`.
3. **Email triajer:** **no hay email hoy**; solo Discord y bot WhatsApp para recordatorios. Falta email en equipo + servicio de envío + enganche en `_apply_appointment_to_lead` (~3–5 días MVP).
4. **Cuotas:** Cobranzas registra pagos en `lead_payment` pero **sin concepto** y **sin recalcular** `lead.pago`. El bucket “Cuotas” del dashboard solo funciona bien con filas migradas/importadas que traen `concepto = '2da Cuota'|'3ra Cuota'`. `debe NULL` deja ~268 clientes fuera del flujo de cobranzas con tope.
