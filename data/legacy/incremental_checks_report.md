# Reporte checks fallidos — incremental 2026-08-10

## 1. +2 legacy_lead_ref — leads borrados en origen ✅

**Hipótesis confirmada:** CSV +22 neto, import +24 refs → 2 filas borradas en CRM viejo.

| legacy_id | nombre | lead_id | fecha | pagos | USD |
|-----------|--------|---------|-------|------:|----:|
| 916c9ef6… | Ronald Barrios | 2547 | 2026-08-09 | 0 | 0 |
| a86b44cc… | Roberto Fernández | 2250 | 2026-08-03 | 0 | 0 |

**Acción:** marcados `legacy_meta.eliminado_en_origen = "2026-08-10"` (sin pagos asociados).

---

## 2. −2 Presento Sí — leads modificados ✅

**Gap validate:** CSV 371 · BD payload 369 · diferencia exacta 2.

| legacy_id | nombre | BD (payload) | CSV |
|-----------|--------|--------------|-----|
| 277cd35a… | Lida maria tovar | Por tomar | **Sí** |
| 8a47b40e… | Alejandro Basantes Rubio | Por tomar | **Sí** |

Ambos ya migrados (omitidos en incremental). Import no actualiza `legacy_lead_ref.payload`.

**Comparador amplio** (`detect_modified_leads.py`):
- 1.329 leads con algún campo distinto vs CSV
- 53 con cambio en `presento` (bidireccional: Sí↔No, Por tomar↔Sí, etc.)
- El gap de validate son **solo** las 2 filas arriba (CSV=Sí, payload≠Sí)

🛑 **Pendiente §4:** lista blanca + upsert selectivo leads (sin aplicar aún).

---

## 3. Backfill programa_ofrecido ✅

**Aplicado:** 79 leads `source=legacy_juano` actualizados desde `lead_payment.producto`.

Ejemplos: `PREMIUM (6 MESES) ($1200)` → `Premium 6 meses`, `EXPRESS ($250)` → `Express / Downsell`.

**Mayo 2026 post-backfill (legacy):**
- 284 sin programa (vacío)
- 14 Premium 6 meses
- 3 EXPRESS / 2 VIP 6 meses / 1 Express / Downsell
- Ya no hay 11 variantes sucias con `($1200)` en leads con pago

---

## 4. §4.2 — Por qué PROGRAMAS muestra $0

**No es bug de columna vacía.** El dashboard lee:

`program_offered` → `program_price_usd` vía catálogo `OfferedProgram` (`normalize_program_lookup_key`).

**Catálogo actual juano (user_id=1):**
- TIY PREMIUM PIF ($1500)
- TIY PREMIUM CUOTAS ($2000)
- TIY VIP PIF ($3500)
- … (6 programas TIY)

**Legacy normalizado:** `Premium 6 meses`, `Express / Downsell`, `VIP 6 meses` — **no matchean** ningún nombre del catálogo → `program_price_usd = null` → ingresos $0 en fila PROGRAMAS.

Cash Collected ($32.113 mayo) viene de **pagos**, no de precio catálogo × programa.

**Próximo paso (fuera de backfill):** tabla de mapeo legacy → catálogo TIY, o ampliar catálogo con alias. El backfill resolvió consolidación de nombres; el $0 requiere cruce explícito con TIY.

---

## Scripts nuevos

| Script | Uso |
|--------|-----|
| `detect_deleted_leads.py` | Refs en BD ausentes en CSV |
| `detect_modified_leads.py` | Diff campos leads migrados |
| `backfill_programa_ofrecido_legacy.py` | Backfill `--yes` |
