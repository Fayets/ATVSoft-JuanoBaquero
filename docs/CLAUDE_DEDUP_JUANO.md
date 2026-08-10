# Handoff para Claude — deduplicación juano → ATV (actualizado post-implementación)

**Fecha:** 2026-08-09  
**Estado:** Implementación Cursor completada (pasos 1–5). **Pendiente:** export operador + `--report-duplicates` + dry-run.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero` · rama `develop`

---

## 1. Verificación `ghlId` — CONCLUSIÓN

### Query A (Supabase)

| métrica | valor |
|---------|------:|
| total | 2.496 |
| con_ghlid | 2.462 |
| **ghlid_distintos** | **1.284** |
| con_contactid | 2.462 |
| contactid_distintos | 2.414 |

**`ghlId` NO es appointment id** — se repite ~2× por fila. Descartado como matcheo exacto.

### Test C (30 ghlId legacy vs Neon)

**0/30 coincidencias (0%)** — confirma descarte.

### Vínculo válido confirmado

`leads.csv.ghl_contact_id` ↔ `ATV.notas` / columna `ghl_contact_id`  
Ejemplo: Alfredo Alberto → `r75RFijE3f3N9yvNS8ZY` + `alfa_tec@hotmail.com` en ambos sistemas.

### Matcheo implementado

1. `ghl_contact_id` + `fecha_llamada` ±1 día (candidato único)
2. `ghl_contact_id` + `fecha_agenda` ±1 día
3. Teléfono dígitos → tel10 → email
4. Solo nombre → **no merge** (`posible_duplicado`)
5. >1 candidato en ventana → **no merge** (`match_ambiguo`)

---

## 2. Hallazgo CRM legacy vivo

- Conteo original leads: 2.478 → **ahora 2.496+** (+18)
- Pagos/cuotas también pueden haber crecido
- **Solución:** `expected_counts.json` al exportar (no hardcodear en código)
- Regla: control + 3 CSV en **misma sesión**
- Idempotencia por `legacy_id` permite segunda pasada incremental

---

## 3. Implementado en repo (Cursor)

| Componente | Archivo | Qué hace |
|------------|---------|----------|
| Migración SQL | `backend/src/db.py` | Columna `ghl_contact_id` + índice NO único + backfill desde `notas` |
| Modelo | `backend/src/models.py` | Campo `ghl_contact_id` en `Lead` |
| GHL sync | `backend/src/controllers/ghl_controller.py` | Escribe `ghl_contact_id` en columna al crear/actualizar |
| Importador | `backend/src/services/legacy_juano_import.py` | Matcheo, merge, agendo fallback, `--report-duplicates` |
| CLI | `scripts/import_legacy_juano.py` | Flag `--report-duplicates` |
| Validación | `scripts/validate_legacy_juano.py` | Lee `expected_counts.json` |
| Export doc | `docs/EXPORT_CSV_SUPABASE_JUANO.md` | §0 query control + regla sesión única |
| Ejemplo JSON | `data/legacy/expected_counts.json.example` | Plantilla conteos |

### Política merge (P2)

- Solo completar vacíos: `email`, `telefono`, `nombre`, `origen`, `keyword`
- **Nunca tocar:** `status`, `estado`, `closer`, `setter`, `notas`
- `pre_import_snapshot` + `legacy_meta.legacy_lead` + `imported_legacy_ids[]`

### Fallback agendo (Q3)

```
fecha_agenda → fecha → created_at (legacy_meta.agendo_inferido)
```

### Validación post-import

- `Leads CSV aplicados` = nuevos `source=legacy_juano` + sum(`imported_legacy_ids`)
- No comparar solo `COUNT(source='legacy_juano')` — merges no crean filas legacy

---

## 4. Comandos operador

```bash
# 1. Supabase: §0 expected_counts.json + 3 CSV (misma sesión)
# 2. Copiar a data/legacy/

cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --report-duplicates
# 🛑 PARAR — revisar desglose por mes

python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
# 🛑 PARAR — revisar resumen

# Tras snapshot Neon + OK:
python ../scripts/import_legacy_juano.py --user-id 1 --yes
python ../scripts/validate_legacy_juano.py --user-id 1
```

### Control de sanidad del reporte

| Mes | Esperado |
|-----|----------|
| Abr–May 2026 | Casi todo **nuevo** (ATV no existía) |
| Jun 2026 | Zona transición |
| Jul–Ago 2026 | **Alta tasa de merge** |
| 2.478 nuevos + 0 merge | Matcheo roto |
| Matches en abril | Sospechoso |

---

## 5. Orden de ejecución actual

| Paso | Estado |
|------|--------|
| Verificación ghlId | ✅ Descartado |
| Implementación matcheo + SQL + validate | ✅ |
| Congelar CRM viejo con cliente | ⏳ Operador |
| Export control + CSV | ⏳ Operador |
| `--report-duplicates` | ⏳ |
| `--dry-run` | ⏳ |
| Snapshot Neon | ⏳ Operador |
| Import real + validate | ⏳ |

---

## 6. Neon post-migración columna

Backfill `ghl_contact_id`: ~1.556 filas con valor (desde `notas`).

---

## 7. Rol Claude vs Cursor

- **Claude:** revisar outputs de reporte/dry-run, decidir go/no-go
- **Cursor:** ejecutar scripts, ajustar código
- **Operador:** Supabase export, snapshot Neon, congelar CRM legacy
