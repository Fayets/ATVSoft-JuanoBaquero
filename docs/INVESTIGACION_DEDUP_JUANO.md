# Investigación deduplicación leads — juano → ATV

**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Fecha:** 2026-08-09 (actualizado con cardinalidad + decisiones P1–P3)  
**Ejecutado por:** Cursor (consultas Neon solo lectura)  
**Estado:** 🛑 **PARAR** — pendiente verificación `ghlId` en Supabase (§13) antes de implementar  
**Relacionado:** `docs/CLAUDE_MIGRACION_JUANO.md`, `alto-duplicados-juano.md` (origen del riesgo)

---

## 1. Problema crítico omitido en el doc principal

ATV ya tiene **~1.577 leads** para `user_id = 1` (`juano`). El CSV `leads.csv` traerá **2.478 filas** más.

El documento `CLAUDE_MIGRACION_JUANO.md` define resolución de identidad **solo para `pagos → lead`**. Para **`leads.csv → lead` no hay ninguna**: el importador actual insertaría las 2.478 filas como leads nuevos sin verificar si esa persona/cita ya existe en ATV.

**El índice `UNIQUE (legacy_id)` no protege contra esto.** Evita reimportar el mismo CSV dos veces, pero **no** evita duplicar a una persona que ya está en ATV bajo otro `id`.

### Por qué el solapamiento es probable

- `leads.csv` tiene columna `ghl_contact_id` → el CRM legacy estaba sincronizado con GoHighLevel.
- Los leads actuales en ATV también vienen del sync GHL (ver §2.4).
- **1.556 de 1.577** leads ATV tienen `GHL contact_id:` embebido en `notas`.

### Consecuencia si no se resuelve

- El cliente ve la misma persona dos veces en su CRM
- Métricas de funnel infladas
- Pagos pueden colgar del lead equivocado
- Difícil de revertir una vez que el cliente trabaja sobre los datos

---

## 2. Consultas ejecutadas — fase 1 (Neon ATV, solo lectura)

### 2.1 — Origen y rango de los leads existentes

```sql
SELECT
  source,
  COUNT(*)                                                  AS total,
  MIN(fecha_bot)::date                                      AS desde,
  MAX(fecha_bot)::date                                      AS hasta,
  COUNT(*) FILTER (WHERE telefono IS NULL OR telefono = '') AS sin_telefono
FROM lead
WHERE user_id = 1
GROUP BY source
ORDER BY total DESC;
```

**Resultado:**

| source | total | desde (`fecha_bot`) | hasta (`fecha_bot`) | sin_teléfono |
|--------|------:|---------------------|---------------------|-------------:|
| `atv`  | **1.577** | 2026-07-15 | 2026-07-15 | 2 |

**Interpretación:** `fecha_bot` **no sirve** para medir solapamiento temporal. Casi todos los leads la tienen vacía (solo 2 filas con valor). El rango real de actividad:

| columna | non-null | min | max |
|---------|---------:|-----|-----|
| `fecha_bot` | 2 | 2026-07-15 | 2026-07-15 |
| `agendo` | 1.577 | **2026-06-15** | **2026-08-09** |
| `call` | 1.577 | **2026-07-01** | **2026-08-13** |
| `created_at` | 1.577 | 2026-07-25 | 2026-08-09 |

**Riesgo temporal: ALTO** — solapamiento jun–ago 2026 con el rango esperado de `leads.csv` (abr–ago 2026).

---

### 2.2 — Formato real del teléfono en ATV

Formato consistente: **`+` + dígitos E.164**, sin espacios ni guiones (`+573115749093`, `+525574548628`, etc.).

**Conclusión:** coincide con `tel_norm` del CSV. Normalizar **ambos lados** a solo dígitos.

---

### 2.3 — ¿ATV guarda algún identificador de GHL?

**43 columnas** en `lead`. Columnas con `ghl` en el nombre:

| column_name | data_type |
|-------------|-----------|
| `ghl_appointment_id` | character varying |

**No existe columna `ghl_contact_id`** (pendiente agregar — ver §5 P1).

---

### 2.4 — Cobertura GHL en datos existentes

| métrica | count |
|---------|------:|
| Total leads | 1.577 |
| Con `GHL contact_id:` en notas | **1.556** |
| Con `ghl_appointment_id` | 1.556 |
| Con `email` en columna | 1.575 |

**Hallazgo crítico:** `ghl_contact_id` está embebido en `notas` (`GHL contact_id: <id>`). El sync GHL en `ghl_controller.py` escribe ese marcador al crear/actualizar leads.

---

## 3. Consultas ejecutadas — fase 2 (cardinalidad, BLOQUEANTE)

### 3.1 — ¿Uno-a-uno o uno-a-muchos por `ghl_contact_id`?

```sql
WITH ghl AS (
  SELECT
    id,
    (regexp_match(notas, 'GHL contact_id:\s*(\S+)'))[1] AS ghl_contact_id
  FROM lead
  WHERE user_id = 1 AND notas ILIKE '%GHL contact_id:%'
)
SELECT
  COUNT(*)                                    AS filas_con_ghl_id,
  COUNT(DISTINCT ghl_contact_id)              AS ids_distintos,
  COUNT(*) - COUNT(DISTINCT ghl_contact_id)   AS filas_extra
FROM ghl;
```

**Resultado:**

| métrica | valor |
|---------|------:|
| `filas_con_ghl_id` | 1.556 |
| `ids_distintos` | **1.400** |
| `filas_extra` | **156** |

**Conclusión: `filas_extra > 0` → ATV repite leads por cita, no es uno-a-uno por persona.**

Adicional:
- **134 grupos** de `ghl_contact_id` con más de un lead
- **`ghl_appointment_id` sí es 1:1**: 1.556 filas = 1.556 ids distintos (**0 extras**)

### 3.2 — Muestra de duplicados (top 20)

| ghl_contact_id | veces | fechas_agenda (ejemplo) |
|----------------|------:|-------------------------|
| Xl9lDi3mGEmfc8Qm0Q3t | 4 | 2026-07-28, 07-29, 08-02, 08-05 |
| CpLM3nrLdJhyIjnESKjW | 4 | 2026-07-28, 08-01, 08-01, 08-06 |
| ciUy734jtCrxP19CQRhV | 4 | 2026-07-27, 07-27, 07-28, 07-28 *(nombre distinto: Yira Lopez)* |
| zov54JZ4ZE83vAa9NIna | 3 | 2026-07-28 × 3 |
| … | … | … |

Cada fila duplicada tiene **`ghl_appointment_id` distinto**.

### 3.3 — Alineación con diseño GHL en ATV

`backend/src/controllers/ghl_controller.py` — `_apply_appointment_to_lead`:

> Match SOLO por `ghl_appointment_id`. Nunca por contacto: un mismo `ghl_contact_id` con otra cita → lead nuevo.

**Implicación:** la unidad de identidad en ATV es la **cita** (`ghl_appointment_id`), no la persona (`ghl_contact_id`). Matchear solo por contacto colapsaría 156 filas incorrectamente.

**Problema adicional:** el export actual de `leads.csv` **solo trae `ghl_contact_id`**, no `ghl_appointment_id`:

```sql
-- docs/CLAUDE_MIGRACION_JUANO.md, query leads.csv
data->>'ghlContactId' AS ghl_contact_id,
-- falta: ghl_appointment_id
```

---

## 4. Dashboards — qué columna de fecha usan (hallazgo C)

### 4.1 Backend — filtro mensual `GET /leads?month=`

`backend/src/controllers/leads_controller.py` — `_lead_effective_dt`:

```
Prioridad: call > agendo > fecha_bot > created_at
```

- Por defecto **excluye leads sin `agendo`** (`include_all=false`)
- El mes operativo usa **`call` > `agendo` > `fecha_bot` > `created_at`**

### 4.2 Frontend — dashboard marketing

| Uso | Columnas (prioridad) | Archivo |
|-----|---------------------|---------|
| Atribución diaria chats | `fecha_bot` → `agendo` → `date` | `dashboard-view.tsx` |
| Embudo CHATS/CONVERSACIONES | `fecha_bot` → `date` → `agendo` | `leads-analytics.ts` |
| Cash diario/semanal | `call_at` / `scheduled_at` (= `call` en BD) | `dashboard-view.tsx` |

**Nota:** campo `date` en la API = `created_at.date()`, **no** `fecha_bot`.

### 4.3 Mapeo actual del importador legacy

| CSV | columna ATV |
|-----|-------------|
| `fecha` | `fecha_bot` |
| `fecha_agenda` | `agendo` |
| `fecha_llamada` | `call` |
| `created_at` | `created_at` |

### 4.4 Conclusión visibilidad

**Riesgo parcial, no total.** Leads migrados aparecerán en filtro mensual si `fecha_agenda`/`fecha_llamada` vienen pobladas (backend prioriza `call` y `agendo`).

**Puntos de atención:**

1. **Grilla leads** (`GET /leads` sin `include_all`): filas sin `fecha_agenda` → `agendo` NULL → **invisibles**. Necesita fallback (`fecha` o `created_at` → `agendo`).
2. **Gráficos chats diarios**: priorizan `fecha_bot` — conviene que `leads.csv.fecha` llegue bien a `fecha_bot` (ya mapeado).
3. **Meses históricos (abr–jun 2026)**: aparecerán vía `agendo`/`call`/`fecha_bot`, no vía `created_at` (fecha de import).

---

## 5. Decisiones aprobadas (P1–P3 + correcciones)

### P1 — `ghl_contact_id`: columna nueva + backfill ✅ **Opción B**

- Migración SQL: columna `ghl_contact_id` indexable
- Backfill: regex `GHL contact_id:\s*(\S+)` desde `notas` → ~1.556 filas
- **Requisito adicional:** actualizar `ghl_controller.py` para escribir en la columna nueva al crear/actualizar leads (si no, queda desactualizada tras el import)

### P2 — Política de merge ✅ Confirmada, con límite

- **Solo completar campos vacíos, nunca sobrescribir**
- `pre_import_snapshot` + `legacy_meta.legacy_lead` para auditoría
- Pagos siempre se agregan (registros nuevos)

**Campos que NUNCA tocar** (aunque estén vacíos en ATV — estado operativo actual):

- `status` / `estado`
- `closer` / `setter` asignados
- `notas` escritas a mano por el equipo

Valor legacy de esos campos → solo en `legacy_meta.legacy_lead`.

**Campos que sí se completan si vacíos:** `email`, `telefono`, `nombre`, `origen`, `keyword`.

### P3 — `--report-duplicates` ✅ Requiere CSV completos

Sin dry-parse parcial. Si faltan CSV → fallar con mensaje claro (comportamiento actual).

### Corrección — matcheo por nombre NO fusiona automáticamente

Fusionar dos personas distintas es peor que duplicar una. Con nombres latinos comunes (`Juan Romero`, `Andrés Martínez`) los falsos positivos son inevitables.

| Método | Acción |
|--------|--------|
| `ghl_appointment_id` exacto | Merge automático ✅ |
| `ghl_contact_id` + fecha llamada/agenda | Merge automático ✅ |
| Teléfono (dígitos completos) | Merge automático ✅ |
| Teléfono (últimos 10 dígitos) | Merge automático ✅ |
| Email exacto | Merge automático ✅ |
| **Solo nombre** | **Crear lead nuevo** + `legacy_meta.posible_duplicado = true` + `legacy_meta.candidato_lead_id` |

Casos solo-nombre → listados en `--report-duplicates` para revisión humana.

---

## 6. Cadena de matcheo propuesta (pendiente OK final §9)

| Prioridad | Criterio | Acción |
|-----------|----------|--------|
| 1 | `ghl_appointment_id` exacto | Merge — *si se agrega al export CSV desde Supabase* |
| 2 | `ghl_contact_id` + `fecha_llamada` (mismo día calendario) | Merge al lead ATV cuya `call` cae en ese día |
| 3 | `ghl_contact_id` + `fecha_agenda` (mismo día) | Fallback si no hay `fecha_llamada` |
| 4 | Teléfono → solo dígitos | Merge |
| 5 | Teléfono → últimos 10 dígitos | Merge |
| 6 | Email exacto (lowercase, trim) | Merge |
| 7 | Solo nombre normalizado | **Crear nuevo** + flag `posible_duplicado` |
| 8 | Sin match | Crear lead nuevo |

Registrar en `legacy_meta.match_method` y `legacy_meta.match_score`.

**No matchear solo por `ghl_contact_id`** — colapsaría 156 filas ATV incorrectamente.

---

## 7. Cambios requeridos en el importador (pendiente implementación)

### 7.1 Resolución de identidad para `leads.csv → lead`

Implementar cadena §6 + registrar método/score en `legacy_meta`.

### 7.2 Política de merge

Según §5 P2. Extender `pre_import_snapshot` (ya existe para pagos) a leads mergeados.

### 7.3 Modo `--report-duplicates`

Modo solo lectura que genera:

- Cuántos leads CSV matchean con ATV existentes
- Desglose por método (`ghl_appt` / `ghl_contact+fecha` / tel / tel-10 / email / posible_duplicado_nombre / nuevo)
- Cuántos se crearían como nuevos
- Muestra de 30 matches: nombre CSV, nombre ATV, método, campos que difieren

### 7.4 Migración SQL + GHL controller

- Columna `ghl_contact_id` en `lead` + índice
- Script backfill desde `notas`
- `ghl_controller.py`: escribir `ghl_contact_id` en columna al sync

### 7.5 Fallback `agendo`

Si `fecha_agenda` vacía en CSV → usar `fecha` o `created_at` para `agendo` (evitar exclusión de grilla).

---

## 8. Confirmación menor — sobrepago

```python
# backend/src/services/legacy_juano_import.py
if raw_debe < 0:
    meta["sobrepago"] = True
    meta["sobrepago_monto"] = abs(raw_debe)  # valor absoluto real
    lead.debe = 0.0
```

---

## 9. Decisiones finales §9 — APROBADAS

### Q1 — `ghl_appointment_id` en export ✅ Sí, campo `ghlId` en jsonb

- Claves GHL en `juano.leads.data`: `ghlContactId` + **`ghlId`** (candidato a appointment id)
- **No asumir** — verificar con queries §13 antes de matcheo
- Si se confirma → reexportar `leads.csv` con `data->>'ghlId' AS ghl_appointment_id`

### Q2 — Fallback `ghl_contact_id + fecha` ✅ Con reparos

| Reparo | Regla |
|--------|-------|
| Zona horaria | Ventana **±1 día**, no día exacto |
| Múltiples candidatos | Si >1 lead ATV en ventana → **no fusionar**. Crear nuevo + `legacy_meta.match_ambiguo = true` + lista de ids candidatos |

### Q3 — Fallback `agendo` ✅ Confirmado

```
agendo = fecha_agenda
si vacío → agendo = fecha          (columna fecha del CSV)
si también vacío → agendo = created_at + legacy_meta.agendo_inferido = 'created_at'
```

**Nunca** usar `created_at` como primer fallback (backfills desalinean mes histórico).

### Detalles adicionales aprobados

1. Índice `ghl_contact_id`: **NO único** (1.400 ids / 1.556 filas)
2. 21 filas sin GHL → matcheo tel/email normal
3. `--report-duplicates`: desglose **por mes** (abr/may casi todo nuevo; jul/ago alta tasa match; jun transición)

---

## 10. Cadena de matcheo final (post-verificación ghlId)

| Prioridad | Criterio | Acción |
|-----------|----------|--------|
| 1 | `ghl_appointment_id` exacto (`ghlId` CSV = columna ATV) | Merge ✅ *si §13 confirma* |
| 2 | `ghl_contact_id` + `fecha_llamada` (±1 día) | Merge si candidato único |
| 3 | `ghl_contact_id` + `fecha_agenda` (±1 día) | Fallback si no hay llamada |
| 2–3 ambiguo | >1 candidato en ventana | **No merge** → `match_ambiguo` |
| 4 | Teléfono dígitos completos | Merge |
| 5 | Teléfono últimos 10 dígitos | Merge |
| 6 | Email exacto | Merge |
| 7 | Solo nombre | **Crear nuevo** + `posible_duplicado` |
| 8 | Sin match | Crear nuevo |

---

## 11. Verificación `ghlId` — estado

### Paso 1 — Supabase (operador): queries A y B

**A. Cardinalidad** — pendiente operador:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(data->>'ghlId') AS con_ghlid,
  COUNT(DISTINCT data->>'ghlId') AS ghlid_distintos,
  COUNT(data->>'ghlContactId') AS con_contactid,
  COUNT(DISTINCT data->>'ghlContactId') AS contactid_distintos
FROM juano.leads;
```

**B. Muestra** — pendiente operador (30 filas con `ghl_id`).

### Paso 2 — Neon (Cursor): verificación C

**Autotest ejecutado** (sanity check del query — IDs tomados de ATV, no de Supabase):

| métrica | valor |
|---------|------:|
| IDs probados | 30 |
| Coinciden en Neon | **30** |
| Tasa | **100%** |

**Formato `ghl_appointment_id` en ATV:** longitud fija **20** chars alfanuméricos (ej. `X4ytN6Jf062uFF6iHvRw`).

**Verificación real C** (ghlId legacy vs Neon): ⏳ **bloqueada** — requiere 30 `ghlId` del resultado B (Supabase). Sin credenciales Supabase en el repo.

Script listo:

```bash
cd backend
python ../scripts/verify_ghl_appointment_overlap.py id1 id2 id3 ...
```

Ver también `docs/EXPORT_CSV_SUPABASE_JUANO.md` §0.

---

## 12. Orden de ejecución actualizado

| Paso | Acción | Estado |
|------|--------|--------|
| 1 | Verificación A y B de `ghlId` en Supabase | ⏳ **Operador** |
| 2 | Verificación C solapamiento en Neon | ⏳ Tras paso 1 (script listo) |
| 3 | 🛑 PARAR — revisar resultados A/B/C | |
| 4 | Si confirmado → reexportar `leads.csv` con `ghl_appointment_id` | ⏳ Operador |
| 5 | Migración SQL: `ghl_contact_id` (índice NO único) + backfill + `ghl_controller.py` | ⏳ Cursor |
| 6 | Cadena matcheo, merge, `--report-duplicates` (desglose por mes), fallback `agendo` | ⏳ Cursor |
| 7 | CSV en `data/legacy/` + conteos | ⏳ Operador |
| 8 | `--report-duplicates` → PARAR | ⏳ |
| 9 | `--dry-run` → PARAR | ⏳ |
| 10 | Snapshot Neon → import → validate → idempotencia | ⏳ |

---

## 13. Corrección al doc principal

En `CLAUDE_MIGRACION_JUANO.md`, sección 12: **"tarea para Cursor"**, no Claude.

---

## 14. Resumen ejecutivo

1. **Unidad de identidad ATV = cita** (`ghl_appointment_id` 1:1).
2. **`ghlId` en Supabase** candidato a appointment id — **verificar antes de implementar**.
3. **Matcheo #1 ideal:** `ghlId` = `ghl_appointment_id` (exacto).
4. **Fallback:** contacto + fecha con **±1 día** y regla **match_ambiguo** si >1 candidato.
5. **Nombre solo → nunca merge auto.**
6. **`agendo` fallback:** `fecha_agenda` → `fecha` → `created_at` (marcado inferido).
7. **Reporte duplicados:** desglose por mes como control de sanidad.
8. **Siguiente:** operador corre A/B → Cursor corre C con script → revisión → implementación.
