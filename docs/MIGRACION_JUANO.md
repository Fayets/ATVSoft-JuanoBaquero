# Migración CRM legacy (juano) → ATV

**Estado: Paso 2 completado — importador y validador listos. Pendiente dry-run con CSV reales y aprobación para carga.**

Referencia: `prompt-cursor-migracion-juano.md` · Aprobación: `respuesta-mapeo-juano.md`

---

## Contexto

- **Origen:** CRM Supabase schema `juano` — 3 CSVs en `./data/legacy/`
- **Destino:** ATV — FastAPI + Pony ORM + PostgreSQL (Neon)
- **Idempotencia:** `UNIQUE (legacy_id) WHERE legacy_id IS NOT NULL` + skip en importador
- **Python 3.13:** patrón `rows_for_user()` — sin lambdas en queries Pony

**Contacto = `Lead`.** Pagos = **`lead_payment`**. Cuotas históricas = **`legacy_cuota_ref`**.

---

## Decisiones aprobadas

| # | Decisión |
|---|----------|
| 1 | **`legacy_cuota_ref`** para las 20 cuotas (snapshot, no saldos) |
| 2 | **`legacy_meta` jsonb** para flags/auditoría; **`producto`**, **`metodo`**, **`concepto`** como columnas en `lead_payment` |
| 3 | **`concepto`** columna en `lead_payment` (cierre nuevo) |
| 4 | **`Herramienta 3 meses`** → producto `Otro`; nombre real en `legacy_meta.producto_original` |
| 5 | CSVs en **`./data/legacy/`** — falla con mensaje claro si falta alguno |

---

## Correcciones aplicadas

### A. `lead.debe` = NULL si no hay contrato

```
si precio_contrato conocido (desde pagos):
    debe = max(0, precio_contrato - suma(pagos no programados))
si no:
    debe = NULL   # desconocido — NO cero
```

**Desempate `precio_contrato`:** usar el de pagos con `concepto IN ('PIF','1ra Cuota')`. Si hay varios o ninguno → `max(precio_contrato)` y `legacy_meta.precio_contrato_conflicto = true`.

### B. Teléfono inválido

- **No se descarta la fila**
- Tel inválido → `legacy_meta.telefono_invalido`; campo `telefono` queda vacío
- Importación continúa; queda en log

### C. Rollback con snapshot

Antes de modificar un lead **`source = 'atv'`** matcheado desde pagos:

```json
legacy_meta.pre_import_snapshot = {
  "pago", "debe", "status", "programa_ofrecido", "snapshot_at"
}
```

Script **`scripts/rollback_legacy_juano.py`** restaura snapshots → borra legacy.

**Rollback confiable alternativo:** restore del branch Neon (recomendado si hubo muchos matches a leads ATV).

Verificación post-rollback:

```sql
SELECT COUNT(*) FROM lead WHERE source = 'legacy_juano';          -- 0
SELECT COUNT(*) FROM lead_payment WHERE source = 'legacy_juano'; -- 0
SELECT COUNT(*) FROM legacy_cuota_ref WHERE source = 'legacy_juano'; -- 0
```

---

## Columnas nuevas

### `lead`

| Columna | Tipo |
|---------|------|
| `source` | text DEFAULT `'atv'` |
| `legacy_id` | text |
| `closer_norm` | text |
| `legacy_meta` | jsonb |

### `lead_payment`

| Columna | Tipo |
|---------|------|
| `source` | text DEFAULT `'atv'` |
| `legacy_id` | text |
| `concepto` | text |
| `producto` | text |
| `metodo` | text |
| `legacy_meta` | jsonb |

### `legacy_cuota_ref` (tabla nueva)

Trazabilidad + `alumno_raw`, `programa_raw`, montos, fechas, closers, `match_score`, `match_method`, `legacy_meta`.

---

## Mapeo: `leads.csv` → `lead`

| Origen | Destino | Notas |
|--------|---------|-------|
| `id` | `legacy_id` | |
| `nombre` | `nombre` | NFKC; `es_prueba` en meta |
| `correo` | `email` | |
| `tel_norm` | `telefono` | Inválido → meta, no fila |
| `fecha` | `fecha_bot` | NULL → `created_at`, `fecha_inferida` |
| `closer` | `closer` + `closer_norm` | |
| `situacion` | `status` / `estado` | Ver tabla abajo |
| `presento`, `cierre`, etc. | `legacy_meta` | |
| `producto` | `programa_ofrecido` | `"null"` → vacío |

### Status

| situacion | status ATV |
|-----------|------------|
| Venta | Cerrado |
| En Seguimiento / Adentro en seguimiento | Seguimiento |
| No Show | No show |
| Lead Descartado | Descalificado |
| Reagendó | Re-agenda |
| Nuevo / No agendó | Pendiente |
| Llamada Cancelada / Canceló | Pendiente |
| Fee / No cerró / Adentro en llamada | Seguimiento |

---

## Mapeo: `pagos.csv` → `lead_payment`

| Origen | Destino |
|--------|---------|
| `usd` | `monto` |
| `fecha` | `fecha` |
| `concepto` | **`concepto`** (columna) |
| `producto_norm` | **`producto`** (columna); Herramienta 3 meses → Otro |
| `metodo` | **`metodo`** (columna) |
| `producto_original`, flags, closers, GHL | `legacy_meta` |
| `notas` | `nota` |

**Identidad:** tel_norm → email (notas/correo) → nombre → crear lead.

---

## Mapeo: `cuotas.csv` → `legacy_cuota_ref`

Referencia histórica. Match difuso por `alumno`; score bajo → sin `lead_id`. Excluir `fgghhhh`.

---

## Validaciones (validate_legacy_juano.py)

| Check | Esperado |
|-------|----------|
| Pagos importados | 351 |
| Suma USD | 255699.99 |
| Pagos julio 2026 | 211 / 163195.80 |
| Leads importados | 2478 |
| presento = Sí | 366 |
| Cuotas | 20 |
| legacy_id NULL en legacy | 0 |

---

## Ejecución

```bash
# 1. Copiar CSV a data/legacy/

# 2. Dry-run (NO escribe)
cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run

# 3. PARAR — snapshot branch Neon (manual)

# 4. Import real
python ../scripts/import_legacy_juano.py --user-id 1

# 5. Validar
python ../scripts/validate_legacy_juano.py --user-id 1

# 6. Idempotencia — segunda corrida, conteos iguales

# Rollback si hace falta
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
python ../scripts/rollback_legacy_juano.py --user-id 1
```

---

## Archivos entregados

| Archivo | Rol |
|---------|-----|
| `backend/src/db.py` | Migración `_migrate_postgres_legacy_juano` |
| `backend/src/models.py` | Campos + `LegacyCuotaRef` |
| `backend/src/services/legacy_juano_import.py` | Lógica de import |
| `scripts/import_legacy_juano.py` | CLI importador |
| `scripts/validate_legacy_juano.py` | Validaciones |
| `scripts/rollback_legacy_juano.py` | Rollback con snapshot |
| `data/legacy/README.md` | Instrucciones CSV |

---

## Advertencia métricas CRM viejo

No replicar cierres 336 / close rate 129,9%. **Ancla: Cash Collected = 255699,99 USD.**
