# Investigación — filtro de fechas en el Dashboard diario

Relevamiento de código + consultas read-only en Neon. **Sin cambios aplicados.**

Tenant: `user_id = 1` (juano).

---

## 1. Estado actual

### Veredicto: **existe a medias — backend listo, UI parcialmente implementada**

El cliente puede ver llamadas de días anteriores **hoy mismo** usando los botones **← Anterior / Siguiente →** del panel. Lo que falta es hacerlo **obvio** (calendario visible, botón “Hoy”, copy correcto).

| Capa | Estado |
|------|--------|
| **Backend** | ✅ Acepta `?fecha=YYYY-MM-DD` |
| **Frontend — datos** | ✅ Envía `fecha` al cambiar de día |
| **Frontend — UX** | ⚠️ Navegación día a día sí; **input calendario solo en modo admin**; mensajes hablan de “hoy” |

---

## 2. Backend

### 2.1 Endpoint

```453:467:backend/src/controllers/leads_controller.py
@router.get("/llamadas-hoy", response_model=LlamadasHoyOut)
def leads_llamadas_hoy(
    user_id: Annotated[str, Depends(require_user_id)],
    fecha: date | None = Query(
        default=None,
        description="YYYY-MM-DD opcional; si se omite, usa el día actual (Argentina).",
    ),
) -> LlamadasHoyOut:
    ...
    payload = list_llamadas_dia(uid, fecha) if fecha is not None else list_llamadas_hoy(uid)
    return LlamadasHoyOut(**payload)
```

- **Query param:** `fecha` (`YYYY-MM-DD`), documentado en OpenAPI.
- Si se omite → `list_llamadas_hoy(uid)`.
- Si se envía → `list_llamadas_dia(uid, fecha)`.

### 2.2 Servicio

```66:79:backend/src/services/agent_closer_service.py
def list_llamadas_hoy(user_id: int) -> dict:
    hoy = datetime.now(BOGOTA_TZ).date()
    return list_llamadas_dia(user_id, hoy)

def list_llamadas_dia(user_id: int, fecha: date) -> dict:
    inicio, fin = _day_bounds_utc_naive(fecha, BOGOTA_TZ)
    rows = _leads_call_between(user_id, inicio, fin)
    ...
    return {"fecha": fecha.isoformat(), "llamadas": [...]}
```

- Filtra por **`Lead.call`** dentro del día civil en **`America/Bogota`** (no Argentina).
- El nombre del endpoint (`llamadas-hoy`) es legacy; **no limita a hoy** si mandás `fecha`.

### 2.3 Endpoints relacionados que ya respetan fecha

| Endpoint | Archivo | Uso en panel |
|----------|---------|--------------|
| `POST /leads/asignar-triajers-dia?fecha=` | `leads_controller.asignar_triajers_dia` | Botón “Asignar triajers” |
| `POST /ghl/sync?fecha=` | `ghl_controller.sync_ghl` | Botón “Actualizar” (sync GHL del día) |
| `POST /team/closer-reports/generate-day?fecha=` | `team_controller.generate_closer_reports_day` | “Generar reporte” |

**Conclusión backend:** no hace falta construir soporte de fecha; **ya está**. Cambia la estimación a **solo UI/UX**.

---

## 3. Frontend

### 3.1 Llamada al API

```81:87:frontend/src/features/daily-panel/services/daily-panel-service.ts
export async function getDailyCalls(
  teamClosers: string[],
  defaultCloser: string,
  fecha?: string,
): Promise<DailyCallsResponse> {
  const q = fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''
  const res = await apiFetch(`/leads/llamadas-hoy${q}`)
```

### 3.2 Página del panel

`frontend/src/features/daily-panel/components/daily-panel-page.tsx`:

| Elemento | Comportamiento |
|----------|----------------|
| `selectedDate` | Estado inicial = hoy en **`America/Argentina/Buenos_Aires`** (`todayIsoAr`) |
| `fetchCalls` | Pasa `selectedDate` a `getDailyCalls(..., selectedDate)` |
| **← Anterior / Siguiente →** | `shiftDay(±1)` → cambia `selectedDate` y recarga |
| **Input `<type="date">`** | **Solo si `mode === 'admin'`** (panel de corrección con token) |
| Subtítulo | Dice “Argentina”; backend filtra en **Bogotá** |

### 3.3 Copy engañoso

```648:651:frontend/src/features/daily-panel/components/daily-calls-table.tsx
  if (items.length === 0) {
    return (
      ...
        <p>No hay llamadas agendadas para hoy.</p>
```

Siempre dice “hoy” aunque `selectedDate` sea un día pasado.

### 3.4 Comparación con Dashboard ventas

- Ventas usa `MonthSelector` (`shared/components/month-selector.tsx`) — selector de **mes**, no de día.
- Para el panel diario lo natural es **`<input type="date">`** (ya existe en admin) o botones Ayer/Hoy + flechas — no reutilizar `MonthSelector` tal cual.

---

## 4. Datos históricos (Neon, user_id=1)

```text
Rango:  2026-04-30 → 2026-08-16
Total:  2.764 leads con call

Últimos días (ejemplo):
  2026-08-11 → 28 llamadas
  2026-08-10 → 30
  2026-07-31 → 108
  2026-07-29 → 230
```

Hay contenido real desde **abril 2026** (migración + sync GHL). El filtro tendría datos desde el día uno.

---

## 5. Otras vistas (alternativas provisionales)

| Vista | Ruta | Qué muestra | Limitación |
|-------|------|-------------|------------|
| **Leads** | `/leads` | Grilla con columna Call / fecha; filtro por **mes** (`MonthSelector`) | No es “agenda del día”; hay que buscar/ordenar por `call` dentro del mes |
| **Reporte calls** | `/reporte-calls` | Análisis Fathom; filtro **rango** `desde`/`hasta` en frontend | Solo leads con reporte generado, no la operativa del panel |
| **Team → Reporte diario closer** | `/team` (formulario) | Preview por **fecha + closer** desde panel | Una fila por closer/día, no la grilla operativa |
| **Dashboard equipo** | `/team` | Métricas agregadas del mes | No lista llamadas del día |

**Respuesta provisional al cliente:** puede usar **← Anterior** en el panel diario (ya funciona) o **Leads** con el mes correcto y columna Call. Lo ideal es exponer el calendario en el panel normal.

---

## 6. Lógica atada a “hoy” que hay que considerar

| Acción | ¿Atada a hoy? | Detalle |
|--------|---------------|---------|
| Listar llamadas | **No** | Usa `selectedDate` |
| Sync GHL | **No** | `syncGhlForDay(selectedDate)` |
| Asignar triajers | **No** | `assignTriajersForDay(day)` |
| Generar reporte closer | **No** | `generateCloserReportsForDay(reportDate)` |
| Editar filas (status, closer, triajer, pago, link…) | **No** | `PATCH /leads/{id}` sin restricción de fecha |
| **Agregar llamada manual** (usuario normal) | **Sí** | `createManualCall` → backend `_parse_call_hora_today` — **siempre fecha de hoy AR**, ignora día seleccionado |
| Agregar manual (admin) | **No** | `createAdminManualCall(selectedDate, ...)` |
| `recordatorio_enviado` | N/A en panel | Solo agente WhatsApp (`list_proximas_llamadas`); no afecta el panel |

### ¿Solo lectura en días pasados?

**Hoy no hay modo lectura.** Todas las celdas editables funcionan igual en fechas pasadas. Eso permite corregir datos históricos, pero también permite errores (p. ej. generar reporte Discord de un día viejo, sync GHL que reescribe leads).

**Recomendación de producto:**

- **Día pasado:** edición permitida (correcciones operativas) — coherente con uso actual.
- **Opcional:** deshabilitar “Actualizar GHL” y “Generar reporte” si `selectedDate < hoy`, o pedir confirmación.
- **Alta manual:** debería usar `selectedDate`, no solo hoy.

### Zona horaria

- UI inicializa “hoy” en **Argentina**.
- Backend filtra el día en **Bogotá**.
- Para Juano (Colombia) Bogotá es coherente; el subtítulo “Argentina” es **misleading** (herencia del reloj `ArgentinaClock`).

---

## 7. Qué haría falta (estimación)

### Escenario A — Solo hacer visible lo que ya existe (recomendado)

| Tarea | Esfuerzo |
|-------|----------|
| Mostrar `<input type="date">` también en modo normal (no solo admin) | 1–2 h |
| Botón **“Hoy”** para volver al día actual | 30 min |
| Corregir empty state: “No hay llamadas para el {fecha}” | 15 min |
| Aclarar subtítulo TZ (Bogotá / Colombia) | 15 min |
| **Total** | **~2–4 horas** |

### Escenario B — Pulido adicional

| Tarea | Esfuerzo |
|-------|----------|
| Todo lo de A | 2–4 h |
| Manual call con `selectedDate` en backend + frontend | 2–3 h |
| Atajos Ayer / Hoy junto a flechas | 1 h |
| Guardas UX en acciones de sync/reporte para días pasados | 1–2 h |
| **Total** | **~1 día** |

### Escenario C — Rango de fechas (varios días a la vez)

| Tarea | Esfuerzo |
|-------|----------|
| Nuevo param `desde`/`hasta` o rango en backend | 1–2 días |
| Tabla multi-día o vista distinta | 2–3 días |
| **Total** | **~3–5 días** |

**Opinión:** el cliente pide “ver días anteriores”, no un informe multi-día. **Escenario A alcanza**; el selector de día simple + flechas es mejor que rango.

---

## 8. Respuesta sugerida al cliente

> Sí, se pueden ver llamadas de días anteriores. En el Dashboard diario, usá los botones **← Anterior / Siguiente →** arriba de la fecha: cada clic cambia el día y carga las llamadas de ese día desde la base (datos desde abril 2026).
>
> Estamos por agregar un **selector de fecha en calendario** y un botón **“Hoy”** para que sea más visible. Mientras tanto, la grilla **Leads** (filtrando por mes) también muestra fechas de call históricas.

---

## 9. Archivos clave

| Rol | Ruta |
|-----|------|
| Endpoint | `backend/src/controllers/leads_controller.py` → `leads_llamadas_hoy` |
| Filtro por día | `backend/src/services/agent_closer_service.py` → `list_llamadas_dia` |
| Fetch frontend | `frontend/src/features/daily-panel/services/daily-panel-service.ts` → `getDailyCalls` |
| UI navegación | `frontend/src/features/daily-panel/components/daily-panel-page.tsx` |
| Empty state | `frontend/src/features/daily-panel/components/daily-calls-table.tsx` |
