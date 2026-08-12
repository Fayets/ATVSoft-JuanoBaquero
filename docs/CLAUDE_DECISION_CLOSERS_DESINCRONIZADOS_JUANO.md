# Closers desincronizados — investigación GHL vs ATV

**Tenant:** `user_id = 1`  
**Estado:** Investigación §1 **COMPLETA** · Reportes Ignacio **APLICADOS** · Fix re-sync **PENDIENTE**  
**Fecha:** 2026-08-12  
**Spec origen:** `decision-closers-desincronizados.md` (Desktop operador)

---

## Resumen ejecutivo

La hipótesis de reasignación en GHL **se confirma en Jose Ortiz**: GHL tiene **Martín Jácome**, ATV tiene **Agustín Olivero**. El lead se creó a las **00:14** del 11/08, **9 h antes** de la cita.

En una muestra de **30 citas recientes**, solo **1/30** no coincide (Jose Ortiz). La tasa global de desincronización reciente es **baja (~3%)**, pero el **mecanismo de fondo** explica el síntoma del equipo (*"aparecen 5 calls y solo 2 son de ese closer"*) cuando hay reasignaciones que no se propagan.

---

## 1.1 — Jose Ortiz en GHL (confirmado)

| Campo | Valor |
|---|---|
| `ghl_appointment_id` | `guLCqReFbgEq8S9dvase` |
| `startTime` GHL | 2026-08-11T14:00:00Z (= 09:00 Colombia) |
| `status` | booked |
| `assignedUserId` | `OPjXS45lGIVfQF8Y9zr1` |
| **Closer GHL hoy** | **Martín Jácome** |
| **Closer ATV (7022)** | **Agustín Olivero** |
| `created_at` ATV | 2026-08-11 **00:14:23** |

**Conclusión:** reasignación posterior en GHL (Agustín → Martín) que ATV no reflejó.

---

## 1.2 — ¿El sync re-procesa citas existentes?

### Qué hace el sync

1. `POST /ghl/sync` o auto-sync trae eventos de `/calendars/events` para **mes actual** o **un día específico** (`fecha=YYYY-MM-DD`).
2. Por cada evento, busca lead por `ghl_appointment_id` y llama `_apply_appointment_to_lead`.
3. **Sí re-procesa citas ya sincronizadas** si vuelven a aparecer en el rango feteado.

### Comportamiento del closer en `_apply_appointment_to_lead`

```568:570:backend/src/controllers/ghl_controller.py
        if closer_name:
            row.closer = closer_name
            row.closer_norm = closer_name
```

| Caso | Comportamiento |
|---|---|
| `closer=""` | **No pisa** el existente |
| `closer` distinto no vacío | **Sí sobrescribe** |
| Lead nuevo | Escribe el closer que venga |

### El gap real

| Trigger | ¿Re-sincroniza citas pasadas? |
|---|---|
| Auto-sync (cron) | Solo **mes actual** |
| Sync manual sin `fecha` | Mes actual |
| Sync con `fecha=YYYY-MM-DD` | **Sí**, ese día puntual |
| Webhook `POST /ghl/webhook` | Solo cuando GHL dispara evento |

**Problema:** si una cita se reasigna en GHL **después** de que ATV ya la sincronizó, y **no** llega webhook de reasignación, ATV queda con el closer viejo **hasta** que alguien ejecute sync de ese día concreto.

### Webhook

- Endpoint documentado como *"cuando se agenda una cita nueva"*.
- `_ghl_owner_from_webhook_body` lee nombres embebidos; **no hace lookup API** si solo viene ID.
- **No hay evidencia** de que GHL notifique reasignaciones al mismo workflow.

---

## 1.3 — Muestra 30 citas: GHL vs ATV

Script: `scripts/compare_ghl_atv_closers.py`

```
Coinciden: 29/30
Discrepancias: 1
API miss: 0
ATV sin closer: 0
GHL sin closer: 0
```

| appointment_id | contacto | GHL | ATV | ¿ok? |
|---|---|---|---|:---:|
| guLCqReFbgEq8S9d | Jose ortiz | Martín Jácome | Agustín Olivero | ❌ |
| *(29 restantes)* | … | … | … | ✅ |

**Lectura:** el bug de reasignación **existe y es real**, pero en citas recientes es **poco frecuente** (1 caso visible). El síntoma del equipo puede deberse a:

1. Reasignaciones puntuales no propagadas (como Jose Ortiz).
2. Closers viendo leads cuya cita **ya fue reasignada a otro** en GHL.
3. Combinación con reportes que nunca se generaron (typo Ignacio — ya corregido).

**No es un bug masivo de sync roto** — es **falta de re-sync incremental** ante cambios de owner en GHL.

---

## 2. Decisiones del operador — estado

### 2.1 — 15 huérfanas jul-25: diferido ✅

Sin acción. Cubiertas si se implementa re-sync general.

### 2.2 — Jose Ortiz: investigado, no corregido ✅

Evidencia preservada. Un `POST /ghl/sync?fecha=2026-08-11` **actualizaría** el closer a Martín (código lo permite), pero **no se ejecutó** para no enmascarar.

### 2.3 — Triajers: resuelto ✅

`Alonso` (id 10) y `Shariff` (id 11) ya en Equipo. Round-robin 188/188 OK.

### 2.4 — Reportes Ignacio/Martín: aplicado (Ignacio) ✅

| Closer | Días con llamadas | Reportes antes | Generados |
|---|---:|---:|---:|
| **Ignacio Claveria** | 11 | 0 | **11** (19 llamadas total) |
| **Martín Jácome** | 0 | 0 | 0 (su cita está bajo Agustín en ATV) |

Script: `scripts/regenerate_closer_reports_missing.py --yes` (sin Discord).

Fechas generadas Ignacio: 2026-07-28, 07-29, 08-01, 08-03, 08-04, 08-05, 08-06, 08-07, 08-10, 08-12, 08-13.

Martín: pendiente hasta corregir closer de Jose Ortiz (o re-sync del 11/08).

---

## 3. Anclas

| Check | Resultado |
|---|---:|
| Pagos legacy | 362 / $265.526,99 ✅ |
| links_con_link | 356 ✅ |

---

## 4. Fix propuesto (pendiente aprobación)

**Opción A — Re-sync periódico de citas futuras recientes:**
- Al auto-sync, incluir también citas de los últimos N días con `ghl_appointment_id` y refrescar owner desde API.

**Opción B — Webhook de reasignación:**
- Configurar en GHL workflow para `Appointment Updated` / cambio de assigned user → mismo endpoint `/ghl/webhook`.

**Opción C — Botón "Refrescar closers GHL":**
- Endpoint que toma leads con `ghl_appointment_id` en rango de fechas y actualiza closer desde API (sin tocar otros campos).

**Quick win verificable:** sync `fecha=2026-08-11` corrige Jose Ortiz sin script ad hoc.

---

## 5. Scripts

```bash
cd backend
python ../scripts/compare_ghl_atv_closers.py
python ../scripts/regenerate_closer_reports_missing.py --dry-run
python ../scripts/regenerate_closer_reports_missing.py --yes
```

---

*Generado: 2026-08-12 · tenant user_id=1*
