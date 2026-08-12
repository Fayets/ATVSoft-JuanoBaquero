# Botón Refrescar closers + Jose Ortiz — juano

**Tenant:** `user_id = 1`  
**Estado:** ✅ **COMPLETO** (pendiente deploy VPS)  
**Fecha:** 2026-08-12  
**Spec origen:** `boton-refrescar-closers.md`

---

## 1. Jose Ortiz — corregido ✅

Sync `POST /ghl/sync?fecha=2026-08-11`:

| Campo | Antes | Después |
|---|---|---|
| lead 7022 closer | Agustín Olivero | **Martín Jácome** |
| `ghl_appointment_id` | guLCqReFbgEq8S9dvase | sin cambio |

---

## 2. Reportes regenerados ✅

| Closer | Día | Llamadas |
|---|---|---:|
| **Martín Jácome** | 2026-08-11 | 1 |
| **Ignacio Claveria** | 2026-08-11 | 1 (faltaba tras sync del día) |

Martín: **0 → 1** llamada en ATV.

---

## 3. Endpoint `POST /ghl/refrescar-closers` ✅

**Archivo:** `backend/src/services/ghl_refrescar_closers_service.py`  
**Ruta:** `/ghl/refrescar-closers` y `/api/ghl/refrescar-closers`

| Parámetro | Default |
|---|---|
| `desde` | hoy − 6 días |
| `hasta` | hoy |

**Comportamiento:**
- Solo leads con `ghl_appointment_id` en rango de `call`
- Solo toca `closer` y `closer_norm`
- GHL vacío o API error → no pisa
- Cambio → audit en `legacy_meta.actualizaciones[]` con `origen: refrescar_closers_ghl`
- Caché de usuarios GHL por corrida
- Eventos por día (batch) + fallback por appointment id

**No reutiliza** `_apply_appointment_to_lead`.

---

## 4. UI — Dashboard diario ✅

**Botón:** "Refrescar closers" junto a "Actualizar"  
**Rango UI:** 7 días terminando en el día seleccionado  
**Confirmación:** avisa que sobrescribe correcciones manuales en ATV

Archivos:
- `frontend/src/features/daily-panel/services/daily-panel-service.ts`
- `frontend/src/features/daily-panel/components/daily-panel-page.tsx`

---

## 5. Recuperación 15 huérfanas jul

```
RECUPERACIÓN 15 CITAS HUÉRFANAS

Revisadas        : 81 (todas con ghl_appointment_id en rangos jul-01→03 y jul-25)
Recuperadas      : 6
Sin closer en GHL: 9  (GHL tampoco devuelve owner)
API error        : 0

sin_closer_con_ghl_id: 9 (antes: 15)
```

### Recuperadas (6)

| lead_id | nombre | fecha cita | closer asignado |
|---:|---|---|---|
| 1460 | Daniel sanchez | 2026-07-25 | Santiago Torrico |
| 1458 | Daniel sanchez | 2026-07-25 | Santiago Torrico |
| 1470 | Camilo Mora | 2026-07-25 | Gabriel Perez |
| 1473 | Reymi Nolasco | 2026-07-25 | Gabriel Perez |
| 1465 | Andres Perez | 2026-07-25 | Santiago Torrico |
| 1462 | Heyder Castro | 2026-07-25 | Santiago Torrico |

### Sin recuperar (9) — GHL sin owner

| lead_id | nombre | call | ghl_appointment_id |
|---:|---|---|---|
| 551 | Angel Ramírez | 2026-07-01 | f9tmTKaAvRra1QF405CT |
| 552 | Alexander Montoya | 2026-07-01 | y8ORU7nyoX5EgZj4CAJr |
| 561 | Manuel Fernando castano | 2026-07-01 | 5OqUQf54L8hPkjqrXn0P |
| 1035 | José Rodrigo García rumbo | 2026-07-02 | 9Vzc3umByR5LcC2S0h9M |
| 1042 | Esther Rafael | 2026-07-02 | AnOR7iEvwiP62IXoSvRo |
| 1044 | Victor Aristizabal | 2026-07-02 | iTr0da5EXwatpv3QGgTd |
| 585 | Byron Meza | 2026-07-03 | t2cu7Hcc4SGen2yhvAJX |
| 588 | Didier Mina | 2026-07-03 | efphcHrjuosnFatzpFAg |
| 594 | Samuel Cruz | 2026-07-03 | WGcOSKHHbceWeoGM5sMl |

Jul 01–03: **0 recuperadas** — GHL no expone `assignedUserId` en esas citas históricas.

---

## 6. Anclas

| Check | Resultado |
|---|---:|
| Pagos legacy | 362 / $265.526,99 ✅ |
| links_con_link | 356 ✅ |

---

## 7. Scripts

```bash
cd backend
python ../scripts/run_bloque_refrescar_closers.py --jose-only
python ../scripts/run_bloque_refrescar_closers.py --huerfanas-only
python ../scripts/regenerate_closer_reports_missing.py --yes
```

---

## 8. Deploy pendiente

El spec pide deploy conjunto con cobranzas, panel diario TZ, closers, etc. Comando VPS:

```bash
git push
# VPS:
git pull && docker compose build && docker compose up -d
```

Verificación post-deploy: botón "Refrescar closers" visible en dashboard diario.

---

*Generado: 2026-08-12 · tenant user_id=1*
