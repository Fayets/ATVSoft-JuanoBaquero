# Estado migración CRM legacy juano → ATV

**Fecha:** 2026-08-08  
**Estado:** Paso 2 completado — pendiente CSV + dry-run + snapshot Neon antes de carga real

---

## Qué se hizo

### 1. Documentación

| Archivo | Contenido |
|---------|-----------|
| `docs/MIGRACION_JUANO.md` | Mapeo completo, decisiones aprobadas, correcciones A/B/C, validaciones, rollback |
| `data/legacy/README.md` | Instrucciones para colocar los CSV |

### 2. Base de datos (Neon)

Migración aplicada (`_migrate_postgres_legacy_juano`):

**Tabla `lead` — columnas nuevas:**
- `source` (default `'atv'`)
- `legacy_id`
- `closer_norm`
- `legacy_meta` (jsonb)

**Tabla `lead_payment` — columnas nuevas:**
- `source`, `legacy_id`
- `concepto`, `producto`, `metodo` *(columnas de negocio, no jsonb)*
- `legacy_meta` (jsonb)

**Tabla nueva `legacy_cuota_ref`:**
- Snapshot histórico de las 20 cuotas (no fuente de saldos)

**Índices únicos parciales** en `legacy_id` para idempotencia.

### 3. Código backend

| Archivo | Rol |
|---------|-----|
| `backend/src/models.py` | Modelos Pony actualizados |
| `backend/src/db.py` | Migración SQL |
| `backend/src/services/legacy_juano_import.py` | Lógica de importación |

### 4. Scripts CLI

| Script | Uso |
|--------|-----|
| `scripts/import_legacy_juano.py` | Importador (`--dry-run`, `--user-id`, `--only leads\|pagos\|cuotas`) |
| `scripts/validate_legacy_juano.py` | Validaciones post-import (exit ≠ 0 si falla) |
| `scripts/rollback_legacy_juano.py` | Restaura snapshots + borra filas legacy |

---

## Decisiones aprobadas (respuesta-mapeo-juano.md)

1. **`legacy_cuota_ref`** para las 20 cuotas — sí  
2. **`legacy_meta` jsonb** para flags; **`producto`**, **`metodo`**, **`concepto`** como columnas en `lead_payment` — sí  
3. **`concepto`** como columna — sí  
4. **`Herramienta 3 meses`** → producto `Otro` (nombre real en `legacy_meta.producto_original`)  
5. CSVs en **`./data/legacy/`** — falla con mensaje claro si falta alguno  

---

## Correcciones clave implementadas

### A. `lead.debe` = NULL si no hay contrato

- Con `precio_contrato` conocido → `debe = max(0, contrato − pagos)`
- Sin contrato → **`debe = NULL`** (no cero)
- Desempate: precio del pago `PIF` / `1ra Cuota`; conflicto → `legacy_meta.precio_contrato_conflicto = true`

### B. Teléfono inválido

- **No se descarta la fila**
- Tel inválido → `legacy_meta.telefono_invalido`; campo `telefono` vacío
- Queda registrado en log

### C. Rollback con snapshot

Antes de modificar un lead **`source = 'atv'`** matcheado desde pagos, se guarda:

```json
legacy_meta.pre_import_snapshot = {
  "pago", "debe", "status", "programa_ofrecido", "snapshot_at"
}
```

`rollback_legacy_juano.py` restaura snapshots → borra legacy.

**Alternativa confiable:** restore del branch Neon.

---

## Dry-run

**No completado** — faltan los CSV en `data/legacy/`:

```
leads.csv   (2478 filas)
pagos.csv   (351 filas)
cuotas.csv  (20 filas)
```

Mensaje al intentar sin archivos:

```
Faltan CSV en data/legacy: leads.csv, pagos.csv, cuotas.csv.
Copiá pagos.csv, leads.csv y cuotas.csv antes de importar.
```

---

## Próximos pasos

### 1. Copiar CSV

Colocar los 3 archivos en:

```
data/legacy/pagos.csv
data/legacy/leads.csv
data/legacy/cuotas.csv
```

### 2. Dry-run

```bash
cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
```

Revisar el resumen (insertados, omitidos, matches, flags).

### 3. PARAR — snapshot Neon

Crear branch/snapshot del branch Neon **antes** de la carga real.

### 4. Import real

```bash
python ../scripts/import_legacy_juano.py --user-id 1
```

### 5. Validar

```bash
python ../scripts/validate_legacy_juano.py --user-id 1
```

| Check | Esperado |
|-------|----------|
| Pagos importados | 351 |
| Suma USD | 255699.99 |
| Pagos julio 2026 | 211 / 163195.80 |
| Leads importados | 2478 |
| presento = Sí | 366 |
| Cuotas | 20 |

### 6. Idempotencia

Correr el importador **una segunda vez** — los conteos no deben cambiar.

### 7. Rollback (si hace falta)

```bash
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
python ../scripts/rollback_legacy_juano.py --user-id 1
```

---

## Advertencia

No replicar métricas del CRM viejo (cierres 336, close rate 129,9%).  
**Ancla de confianza:** Cash Collected = **255699,99 USD**.

---

## Referencias

- `docs/EXPORT_CSV_SUPABASE_JUANO.md` — queries SQL para exportar CSV
- `docs/HANDOFF_DRYRUN_JUANO.md` — handoff dry-run / bloqueadores
- `prompt-cursor-migracion-juano.md` — especificación original
- `respuesta-mapeo-juano.md` — aprobación y correcciones
- `docs/MIGRACION_JUANO.md` — mapeo técnico detallado
