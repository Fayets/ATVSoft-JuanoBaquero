# Unificación closers duplicados — juano

**Tenant:** `user_id = 1` (juano)  
**Estado:** Investigación completada · **3 variantes unificadas (APLICADO)** · Thomas/Santiago Gamba **no fusionados**  
**Fecha:** 2026-08-12  
**Spec origen:** `unificar-closers-duplicados.md` (Desktop operador)

---

## 1. Problema reportado

El equipo del cliente ve llamadas que no les corresponden. Causa principal identificada: **la misma persona figura con dos nombres distintos** en `lead.closer`, y panel diario + reportes de ventas agrupan por ese texto crudo.

---

## 2. Hallazgo clave — qué campo usan los reportes

| Componente | Campo usado | Archivo |
|---|---|---|
| Panel diario (filtro / asignación) | `lead.closer` | `daily-panel-page.tsx`, `agent_closer_service.py` |
| Reporte diario closer (auto-generate) | `lead.closer` (match exacto case-insensitive vs `TeamMember.nombre`) | `closer_report_auto_service.py` |
| `CloserReport` (tabla) | `member_id` → `TeamMember.nombre` | `team_controller.py` |
| Sync GHL | escribe `lead.closer` | `ghl_controller.py` |
| `closer_norm` + `CLOSER_ALIASES` | Solo en import legacy y (ahora) sync GHL | `legacy_juano_import.py` |

**Conclusión:** `closer_norm` existía pero **no servía** mientras reportes y panel usen `closer` crudo. Las variantes duplicadas partían métricas aunque el alias estuviera definido para nombres cortos (`catalina`, `matias`).

---

## 3. Estado antes del apply

```
Gabriel Perez        720   2026-05-09 → 2026-08-15
Santiago Torrico     543   2026-05-28 → 2026-08-16
(sin closer)         270   2026-04-30 → 2026-08-09   ← 16% del total
Santiago Molina      260   2026-06-23 → 2026-08-12
Santiago Gamba       255   2026-07-09 → 2026-08-16
Catalina Zarlenga    205   2026-07-26 → 2026-08-14
Juano Baquero        190   2026-04-30 → 2026-05-25
Matias Sandobal      142   2026-07-27 → 2026-08-14
Thomas Gamba          64   2026-07-09 → 2026-08-05
Jorge Quesada         51   2026-07-28 → 2026-07-31
Nicholas Ramirez      35   2026-05-01 → 2026-06-07
Ignacio Claveria      19   2026-07-28 → 2026-08-13
Agus Olivero           7   2026-08-11
Agustín Olivero        6   2026-08-10 → 2026-08-14
Matías Sandobal        6   2026-07-30 → 2026-08-07  (doc decía 6; en BD eran 8)
Catalina               1   2026-08-08
```

**GHL (~9 responsables activos):** `Gabriel Perez`, `Santiago Gamba`, `Agustín Olivero`, `Catalina Zarlenga`, `Matias Sandobal`, `Santiago Torrico`, `Ignacio Claveria`, `Martín Jácome`, `Santiago Molina`.

---

## 4. Investigación §4 — 270 llamadas sin closer

```sql
SELECT COALESCE(source,'atv'), COUNT(*),
       COUNT(*) FILTER (WHERE ghl_appointment_id IS NOT NULL AND TRIM(ghl_appointment_id) <> ''),
       MIN(call)::date, MAX(call)::date
FROM lead
WHERE user_id = 1 AND call IS NOT NULL AND COALESCE(closer,'') = ''
GROUP BY 1;
```

| source | llamadas | con `ghl_appointment_id` real | desde | hasta |
|---|---:|---:|---|---|
| `legacy_juano` | **243** | **0** | 2026-04-30 | 2026-08-09 |
| `atv` | **27** | ~15* | 2026-07-01 | 2026-07-25 |

\*El conteo `IS NOT NULL` sin `TRIM` inflaba legacy (columna con strings vacíos). Con `TRIM <> ''`: legacy = 0, ATV = subset con cita GHL real.

**Lectura:**

| Resultado | Interpretación |
|---|---|
| 243 legacy, 0 GHL id | CRM viejo **no tenía closer**. No hay dato que recuperar en esos leads. |
| 27 ATV, ~15 con GHL id | **Posible bug de sync:** cita sincronizada pero `assignedUserId` no resolvió a nombre. Revisar `ghl_controller._ghl_owner_from_sync` y usuarios GHL ausentes en Equipo. |

**Prioridad abierta:** script de recuperación consultando API GHL para las ~15 citas ATV con id pero sin closer.

---

## 5. Investigación §3 — Thomas Gamba vs Santiago Gamba

**Decisión operador: NO unificar** (dos personas distintas ante la duda).

```sql
SELECT closer, call::date, COUNT(*)
FROM lead WHERE user_id = 1 AND closer IN ('Thomas Gamba','Santiago Gamba')
GROUP BY 1,2 ORDER BY 2,1;
```

| Métrica | Valor |
|---|---:|
| Días Thomas activo | 20 |
| Días Santiago activo | 38 |
| **Días con AMBOS activos** | **19** |

Ejemplo solapamiento (julio 2026): el 2026-07-10 → Santiago 10 + Thomas 8; el 2026-07-15 → Santiago 7 + Thomas 6.

**Conclusión:** evidencia fuerte de **dos closers distintos**. Mantener separados. Thomas no existe en GHL; Santiago sí (255 llamadas).

---

## 6. Unificación aplicada (§2 aprobado)

### Dry-run → apply

```
UNIFICAR CLOSERS — APLICADO

Variantes → canónico:
  'Agus Olivero' → 'Agustín Olivero': 7 leads
  'Matías Sandobal' → 'Matias Sandobal': 8 leads
  'Catalina' → 'Catalina Zarlenga': 1 leads

legacy_cuota_ref: 1  (id=6 Catalina → Catalina Zarlenga)
TeamMember closers: 1  (id=13 Agus Olivero → Agustín Olivero)

Total leads: 16
```

### Alcance del cambio

| Tabla / campo | Acción |
|---|---|
| `lead.closer` | Texto → canónico GHL |
| `lead.closer_norm` | Recalculado vía `normalize_closer()` |
| `lead.legacy_meta.actualizaciones[]` | Audit `closer` / `closer_norm` con origen `unificar_closers_duplicados` |
| `legacy_cuota_ref.closer_raw` / `closer_norm` | 1 fila actualizada |
| `teammember.nombre` | id=13 → `Agustín Olivero` (necesario para match en reportes) |

**No tocado:** `closer_report` (agrupa por `member_id`; el rename de miembro 13 alinea futuros reportes).

### Distribución post-apply (variantes = 0)

| closer | llamadas |
|---|---:|
| `Agustín Olivero` | **13** (7+6 unificados) |
| `Matias Sandobal` | **149** (141+8) |
| `Catalina Zarlenga` | **206** (205+1) |
| `Agus Olivero` | **0** |
| `Matías Sandobal` | **0** |
| `Catalina` | **0** |

---

## 7. Prevención (código)

### `CLOSER_ALIASES` corregido (`legacy_juano_import.py`)

| Antes | Después |
|---|---|
| `"matias"` → `"Matías Sandobal"` ❌ (opuesto a GHL) | `"matias"` → `"Matias Sandobal"` ✅ |
| (sin alias Agus) | `"agus olivero"` → `"Agustín Olivero"` ✅ |
| `"matias sandobal"` (ausente) | `"matias sandobal"` → `"Matias Sandobal"` ✅ |
| `"catalina"` → `"Catalina Zarlenga"` | sin cambio ✅ |

### Sync GHL (`ghl_controller.py`)

Al crear/actualizar lead desde GHL:

```python
closer_name = normalize_closer(raw)  # alias GHL
row.closer = closer_name
row.closer_norm = closer_name
```

Citas nuevas caen en bucket canónico sin reasignación manual.

---

## 8. Verificación anclas (post-apply)

| Check | Esperado | Obtenido |
|---|---:|---:|
| Pagos legacy | 362 / $265.526,99 | **362 / $265.526,99** ✅ |
| `links_con_link` | 353–356 | **356** ✅ |
| Variantes duplicadas | 0 | **0** ✅ |

No toca dinero. Solo nombres de closer.

---

## 9. Pendiente / no tocado (§5–§6)

| Tema | Acción | Estado |
|---|---|---|
| **Juano Baquero** (190 llamadas, abr–may) | Titular cuenta — no reasignar | Reportar al cliente |
| **Jorge Quesada** (51, julio) | Idem | Reportar al cliente |
| **Nicholas Ramirez** (35, hasta jun-07) | 2 usuarios homónimos en GHL — limitación match por nombre | Documentar |
| **Ignacio Claveira** vs **Ignacio Claveria** | Typo en `TeamMember` (id=14) vs leads | **Abierto** — no unificado en este apply |
| **~15 citas ATV sin closer** con GHL id | Bug sync / recuperación API | **Abierto** — prioridad media |
| **243 legacy sin closer** | Sin dato en origen | Cerrado — esperado |

---

## 10. Scripts

```bash
cd backend

# Investigación (solo lectura)
python ../scripts/investigate_closers_duplicados.py

# Unificación
python ../scripts/unificar_closers_duplicados.py --user-id 1 --dry-run
python ../scripts/unificar_closers_duplicados.py --user-id 1 --yes
```

---

## 11. Archivos de código modificados (sin commit aún en este reporte)

| Archivo | Cambio |
|---|---|
| `scripts/unificar_closers_duplicados.py` | Nuevo — apply + audit |
| `scripts/investigate_closers_duplicados.py` | Nuevo — queries §3–§4 |
| `backend/src/services/legacy_juano_import.py` | `CLOSER_ALIASES` corregido |
| `backend/src/controllers/ghl_controller.py` | `normalize_closer` en sync |

---

## 12. Decisiones para Claude

1. **¿Investigar y script de recuperación** para las ~15 citas ATV con `ghl_appointment_id` pero `closer` vacío?
2. **¿Corregir typo** `Ignacio Claveira` → `Ignacio Claveria` en Equipo (id=14)?
3. **¿Regenerar reportes closer** históricos post-unificación, o confiar en re-generación manual día a día?
4. **¿Commit + deploy** de cambios de prevención GHL junto con deploy cobranzas pendiente?

---

*Generado: 2026-08-12 · tenant user_id=1 · `unificar_closers_duplicados.py` + `investigate_closers_duplicados.py`*
