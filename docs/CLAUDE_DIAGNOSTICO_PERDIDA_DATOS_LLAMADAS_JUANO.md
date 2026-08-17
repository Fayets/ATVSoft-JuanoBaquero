# Diagnóstico — pérdida de datos en llamadas (juano)

**Fecha:** 2026-08-17  
**Tenant:** `user_id = 1` (juano, timezone `America/Bogota`)  
**Fase:** SOLO DIAGNÓSTICO. No se modificó código ni datos.  
**Origen:** `auditoria-perdida-datos-llamadas.md` + lectura de código + SELECT en Neon.

---

## 0. Acción inmediata (antes de cualquier fix)

**Pausar el auto-sync de GHL.** Cada 4 horas recorre el mes actual y vuelve a poner `status = "Agendado"` en todos los leads de esas citas.

- Job: `auto_sync_ghl` en `backend/main.py` (`IntervalTrigger(hours=4)`, id `GHL_JOB_ID`)
- Función: `run_ghl_auto_sync_all_users()` en `backend/src/controllers/ghl_controller.py`
- Última corrida vista: **2026-08-17 12:19:07 UTC** (~07:19 Colombia) en `apiconnection.last_sync_at` platform=`ghl`

Hasta que el overwrite de `status` esté parcheado, **también dejar de usar el botón "Actualizar GHL"** del panel diario: hace el mismo write, limitado al día seleccionado.

Cuando se parchee: **no escribir `status` si el lead ya tiene uno distinto de vacío / Agendado**.

---

## 1. Causa raíz

El sync de GHL **sí escribe `status`**, siempre, en cada update de un lead existente. No hay `NEVER_TOUCH_FIELDS`.

```python
# backend/src/controllers/ghl_controller.py
# _apply_appointment_to_lead() — rama `if row is not None:` (update)

        row.status = "Agendado"
        row.agendo_en = "GHL"
```

También lo setea en el alta (`Lead(..., status="Agendado", ...)`).

### Asimetría status vs estado

| Origen | Qué escribe |
|---|---|
| PATCH del panel (`PATCH /leads/{id}`) | `row.status = st` **y** `row.estado = st` |
| Sync / webhook GHL (`_apply_appointment_to_lead`) | Solo `row.status = "Agendado"` — **no toca `estado`** |

El panel diario lee `status` primero (`l.status or l.estado or "Pendiente"`). Después del sync, la UI muestra Agendado aunque `estado` siga en Cerrado / No show / Descalificado.

### "Agendado" no es un status del combo

`STATUS_OPTIONS` del panel:

```
Pendiente, Seguimiento, Seña, Cerrado, No show, Re-agenda, Descalificado
```

**"Agendado" no está.** El `<select>` controlado con un value que no matchea ninguna option cae al primer valor visual: **Pendiente**. Por eso el equipo dice "otra vez todos en pendiente" y no "todos en agendado".

---

## 2. Quién dispara el overwrite

Tres caminos llegan a `_apply_appointment_to_lead`:

| Camino | Cuándo | Alcance |
|---|---|---|
| **APScheduler auto-sync** | Cada 4 h | Mes actual Colombia, todos los users con conexión GHL |
| **Botón "Actualizar GHL"** | Manual, sincrónico | Solo el día seleccionado (`POST /ghl/sync?fecha=YYYY-MM-DD`) |
| **Webhook GHL** | Al agendar/cambiar cita | Esa cita |

El auto-sync con `month=None` resuelve al mes actual Bogotá:

```python
# _iter_contacts_with_appointments
if not month:
    now = datetime.now(_GHL_NAIVE_TZ)  # America/Bogota
    month = f"{now.year:04d}-{now.month:02d}"
```

`closer` solo se escribe si viene no vacío. **No pisa:** `link_llamada`, `pago`, `debe`, `triaje_hecho`, `setter`, `programa_ofrecido`, `programada_ofrecido_llamada`, `calificacion_llamada`.

Si la fecha de `call` cambia de día (reagenda), desvincula el `ghl_appointment_id` del lead viejo y **crea uno nuevo**. El trabajo queda en el lead viejo; el nuevo nace en Agendado vacío.

---

## 3. Evidencia en BD (agosto 2026, user_id=1)

`lead` **no tiene columna `updated_at`**. No se pueden armar picos por hora. Proxy: `apiconnection.last_sync_at` de GHL.

### Distribución de `status` en agosto

| status | cantidad |
|---|---:|
| Agendado | **1.133** |
| Descalificado | 39 |
| No show | 26 |
| Pendiente | 23 |
| Cerrado | 15 |
| Seguimiento | 7 |
| Re-agenda | 7 |
| **Total** | **1.250** |

### Mismatch status vs estado (agosto)

- `status ≠ estado`: **1.133**
- `status=Agendado` y `estado` ya resuelto (no vacío / no Agendado / no Pendiente): **299**

Eso es el rastro de "el equipo sí cerró y algo lo revirtió".

### Overwrite por día (`status=Agendado` + `estado` resuelto)

| día (Bogotá) | overwritten | eran Cerrado | No show | Descalificado | Seguimiento | Re-agenda | con Fathom | con pago | suma pago USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 1.635 |
| 03 | 4 | 4 | 0 | 0 | 0 | 0 | 1 | 4 | 3.599 |
| 04 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 2.250 |
| 05 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 300 |
| 06 | 4 | 4 | 0 | 0 | 0 | 0 | 2 | 4 | 6.132 |
| 07 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 4.452 |
| 09 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 4.050 |
| 10 | 14 | 3 | 5 | 2 | 4 | 0 | 6 | 3 | 3.511 |
| 11 | 8 | 1 | 6 | 0 | 0 | 1 | 1 | 1 | 1.500 |
| 12 | 13 | 2 | 4 | 3 | 2 | 2 | 4 | 2 | 1.587 |
| 13 | **19** | 2 | 11 | 4 | 2 | 0 | 3 | 2 | 3.300 |
| **14** | **109** | **8** | **62** | **26** | **9** | **3** | 8 | 9 | **6.878** |
| 15 | **79** | 2 | 46 | 16 | 8 | 6 | 1 | 3 | 2.164 |
| 16 | 36 | 2 | 19 | 13 | 0 | 1 | 4 | 3 | 2.118 |
| 17 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

Cierres pisados a Agendado en agosto: **40 leads**, pago intacto (~US$ 43k en `pago`). El trabajo no se borró: **se ocultó**.

### Ejemplo canónico

**Tommy Rodriguez** `id=7122`

- call UTC `2026-08-14 13:00` → 08:00 Colombia
- closer: Martín Jácome
- `status=Agendado`
- `estado=Cerrado`
- `pago=578`
- Fathom vivo: `https://fathom.video/share/ctybrKXJtzSrFzDwGr2oZgAiP1kjwDRe`
- `ghl_appointment_id=PT9RpWqbBSOraHKIKOxa`

### 14-ago status vs estado

- iguales: 32
- distintos: **169**
- Agendado + estado vacío: 59
- Agendado + estado viejo (resuelto): **110**
- Total panel 14 (día civil Bogotá): **201** llamadas

---

## 4. Casos concretos pedidos

### Wendy Rey `id=7182` — escenario C (invisible), no borrada

| campo | valor |
|---|---|
| nombre | Wendy Rey |
| call UTC | 2026-08-15 01:15 |
| call Bogotá | **2026-08-14 20:15** |
| agendo | 2026-08-14 02:15:34 UTC |
| status | Agendado |
| estado | (vacío) |
| closer | Santiago Gamba |
| triajer | Shariff |
| pago | 0 |
| link_llamada | (vacío) |
| ghl_appointment_id | `1UsyxIjHf9adsDIf2vgP` |
| source | atv |

En el panel del **14/08** (201 filas, 30 por página) queda en **posición 186 → página 7 de 7**.

Cada refresh (incluido Actualizar GHL) hace `setPage(1)` porque `useEffect(() => setPage(1), [items])` en `daily-calls-table.tsx`. Si no pasan de página, "no aparece en ningún día".

No hay rastro de un Cerrado previo en `estado` (vacío). Puede no haberse persistido, o GHL pisó un `status=Cerrado` que nunca se copió a `estado`. Hipótesis abierta.

Otras Wendy: `Wendy quinto` (2/08) y `Wendy suarez` (legacy mayo) — no son el caso.

### Christian Martinez `id=2551`

| campo | valor |
|---|---|
| call UTC | 2026-08-11 23:30 |
| call Bogotá | **2026-08-11 18:30** (no es 13/14) |
| status | Agendado |
| estado | (vacío) |
| closer | Santiago Torrico |
| ghl_appointment_id | `qv0jHEulEbLicQ2KQQT8` |

Existe. No está en 13/14. "De Christian para arriba" encaja más con barrido de filas / paginación que con borrado.

### Sergio Burgos — reagenda = lead nuevo

| id | status | estado | call UTC | pago | ghl_appointment_id |
|---|---|---|---|---|---|
| 7704 | Cerrado | Cerrado | 14/08 15:45 | 350 | `nNmh6pOLBYNT7uEtmcyP` |
| 7720 | Agendado | (vacío) | 14/08 22:15 | 0 | `g6EQut3VpWysrA1O9uNO` |

El trabajo quedó en el lead viejo. El nuevo parece "en blanco". El próximo auto-sync del mes **puede pisar también el 7704** a Agendado.

---

## 5. Escenario por síntoma

| # | Reporte del equipo | Escenario | Evidencia |
|---|---|---|---|
| 1 | Wendy no aparece en ningún día | **C. Invisible** | Existe; página 7/7 del 14 |
| 2 | "Me borró todo" | **B percibido como A** | Los registros siguen; status revertido |
| 3 | "Otra vez todos en pendiente" | **B. Sobrescrito** | GHL pisa `status`; combo muestra Pendiente |
| 4 | "De Christian para arriba" | **B + C** | Barrido mes/día; 201 filas el 14; paginación 30 |
| 5 | Cash no suma hasta "Generar reporte" | **Otro flujo** | Cash de equipo sale de `closer_report`, no del lead en vivo |
| 6 | "El fathom de unos cuantos" | **C / reagenda** | GHL **no** borra `link_llamada`; el link sigue en los pisados |
| 7 | 13 y 14 no aparecen los cerrados | **B + C** | 39 y 201 llamadas; mayoría otra vez Agendado |
| 8 | Ayer full, hoy borrado | **B recurrente** | Auto-sync 4 h + botón Actualizar GHL |

**No hay escenario A (borrado masivo)** en estos casos.

El diagnóstico de ayer ("el 96% quedó en Agendado porque el equipo no cierra") hay que corregirlo: el equipo **sí cierra**; se ve en `estado`. GHL **revierte `status`**.

---

## 6. Botones del panel diario

### Actualizar GHL

Frontend: `handleRefresh` → `syncGhlForDay(day)` → `POST /api/ghl/sync?fecha=YYYY-MM-DD` → recarga `getDailyCalls`.

Backend: si `fecha` está set, corre `_run_ghl_sync` **sincrónico** (no background). Para cada appointment del día llama `_apply_appointment_to_lead` → **`status=Agendado`**.

Toast: "N nuevas, M actualizadas". `updated` = leads existentes reescritos, incluido el status.

### Generar reporte

Frontend: `handleGenerateReport` → `generateCloserReportsForDay` → `POST /team/closer-reports/generate-day?fecha=`.

Backend: `generate_daily_reports_for_user` en `closer_report_auto_service.py`.

- **No toca leads.**
- Lee llamadas y hace upsert de `closer_report` + Discord.
- El cash del dashboard de equipo (`ingreso`) no se mueve hasta que corre esto. Coincide con síntoma #5.

**Bug de timezone en el reporte (no es el overwrite, pero sí desvía cash/conteos):**

```python
# closer_report_auto_service.py
def _day_bounds(fecha):
    inicio = datetime.combine(fecha, time.min)  # naive
    fin = datetime.combine(fecha, time.max)
```

Compara `lead.call` (UTC naive) contra medianoche–medianoche **sin convertir a Bogotá**.

El panel sí usa día civil del tenant:

```python
# agent_closer_service.py
def _day_bounds_utc_naive(fecha, tz):
    # ej. 2026-08-14 America/Bogota → 2026-08-14 05:00 UTC … 2026-08-15 04:59 UTC
```

Una llamada a las 20:15 Colombia (`2026-08-15 01:15` UTC, caso Wendy) **aparece el 14 en el panel** y **el 15 en el reporte**.

### Refrescar closers

`POST /ghl/refrescar-closers` — solo `closer` / `closer_norm`. Escribe `legacy_meta.actualizaciones`. **No pisa status.**

---

## 7. Frontend — hipótesis descartadas / parciales

### 4.1 Guardado optimista sin persistencia — NO explica la reversión masiva

Los handlers (`handleStatusChange`, `handleTriajeHechoChange`, `handleOutboundChange`, `handleSetterChange`, `patchLeadPayment`, etc.) hacen:

1. `await patch...` (PATCH parcial, un campo)
2. Recién ahí `setCalls(...)`
3. Si falla: toast y `throw` — **no** dejan el valor nuevo en React

`LeadPatchRequest` + `model_dump(exclude_unset=True)`: el PATCH **no manda el objeto entero**. Dos personas editando campos distintos del mismo lead no se pisan por payload completo. Sí pueden pisarse el **mismo** campo.

### 4.2 Timezone / filtro de fecha — contribuye a "invisible", no al revert

- Tenant juano: `America/Bogota`
- Panel: filtra `call` por día civil Bogotá (UTC naive bounds)
- GHL parsea `startTime` naive como Bogotá → UTC
- `call` NULL: el lead **no entra** al panel (solo se filtra por `call`, no por `agendo`)
- 13/14: no había leads con `agendo` y `call` NULL

### Paginación — sí explica "no aparece" y "de X para arriba"

```ts
// daily-calls-table.tsx
const PAGE_SIZE = 30
useEffect(() => { setPage(1) }, [items])
```

201 llamadas el 14 = 7 páginas. Refresh → página 1. Wendy en página 7.

### Auto-patch de closer al cargar

`getDailyCalls` si el closer no está en el catálogo de Equipo, persiste en background el closer default (`Nick Xanders`). No pisa status, pero puede reasignar closer (p. ej. `"Agustin"` vs `"Agustín Olivero"`). El 14/08 había **45** llamadas con closer `"Agustin"`.

---

## 8. Auditoría

- `legacy_meta.actualizaciones`: **440** leads — rastro de **refrescar closers**, no de cambios de status.
- No hay historial de quién cambió `status` ni cuándo.
- `lead.updated_at` **no existe** (tampoco en information_schema).
- Parte de la solución futura: log de cambios (quién / cuándo / campo / antes / después), sobre todo `status`.

---

## 9. Código clave (rutas)

| Qué | Dónde |
|---|---|
| Overwrite status | `backend/src/controllers/ghl_controller.py` → `_apply_appointment_to_lead` (~L507-628), línea `row.status = "Agendado"` |
| Auto-sync 4 h | `backend/main.py` → `auto_sync_ghl` / `GHL_JOB_ID` |
| Auto-sync mes actual | `ghl_controller.py` → `run_ghl_auto_sync_all_users` |
| Botón Actualizar GHL | `frontend/.../daily-panel-page.tsx` `handleRefresh` + `daily-panel-service.ts` `syncGhlForDay` |
| Botón Generar reporte | `daily-panel-page.tsx` `handleGenerateReport` + `team_controller.py` `generate_closer_reports_day` |
| Bounds naive del reporte | `backend/src/services/closer_report_auto_service.py` `_day_bounds` |
| Bounds TZ del panel | `backend/src/services/agent_closer_service.py` `_day_bounds_utc_naive` / `list_llamadas_dia` |
| PATCH status+estado | `backend/src/controllers/leads_controller.py` `patch_lead` |
| Combo status | `frontend/.../daily-calls-table.tsx` `StatusSelect` + `STATUS_OPTIONS` en `features/leads/types` |
| Reset paginación | `daily-calls-table.tsx` `PAGE_SIZE=30` + `setPage(1)` on `items` |

---

## 10. Qué NO hace GHL (para no diagnosticar de más)

No borra filas.  
No pisa: Fathom (`link_llamada`), `pago`, `debe`, programas, triaje, setter, calificación.  
Por eso hay Cerrados "invisibles" con pago y Fathom todavía en la fila.

"El fathom de unos cuantos" no es wipe de GHL. Más probable: reagenda (lead nuevo sin link) o mirar la fila nueva / otra página.

---

## 11. Hipótesis abiertas

1. Wendy: no hay `estado=Cerrado` previo. ¿No se persistió, o solo estaba en `status`?
2. Fathom perdido en casos puntuales: ¿lead nuevo de reagenda vs fila equivocada?
3. Christian "para arriba": no hay bloque borrado a partir de él; día 11, no 13/14.
4. Los 15 que siguen `status=Cerrado` en agosto: PATCH posterior al último sync, o cita que el sync no matcheó.

---

## 12. Fix sugerido (no aplicado — esperar autorización)

Orden recomendado:

1. **Pausar** `auto_sync_ghl` (comentar el job o intervalo enorme) y pedir al equipo que no use Actualizar GHL.
2. En `_apply_appointment_to_lead` (update): **no asignar `status`** si el actual no está en `{"", "Agendado", "Pendiente"}` (o lista blanca de "aún no trabajado"). El alta de cita nueva sí puede nacer en Agendado.
3. Alinear `estado` con `status` en el alta GHL, o dejar de usar dos columnas para lo mismo.
4. Agregar `"Agendado"` al combo **o** mapear Agendado → Pendiente de forma explícita (hoy el mismatch visual agrava el reporte).
5. No resetear paginación a 1 en cada refresh (o restaurar página).
6. Generar reporte: usar `_day_bounds_utc_naive` del tenant, igual que el panel.
7. Auditoría de cambios de `status` (y `updated_at` en `lead`).
8. Recuperación de datos: para los 299 (o al menos los 40 Cerrados), copiar `estado` → `status` **solo donde** `status=Agendado` y `estado` está resuelto. Eso restaura lo que el equipo ya cargó, sin inventar cierres.

**No hacer el backfill de status hasta pausar el sync.** Si no, el próximo job de 4 h lo vuelve a pisar.
