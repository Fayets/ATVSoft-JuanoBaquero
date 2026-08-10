# Decisiones — catálogo legacy y lista blanca

**Fecha:** 2026-08-10 · **Tenant:** juano (user_id=1)

---

## 1. $0 en PROGRAMAS — NO mapear legacy → TIY

**Diagnóstico:** `program_price_usd` queda null porque nombres legacy no existen en `OfferedProgram`.

**Decisión:** ❌ **No** crear tabla legacy → TIY. Son productos y precios distintos:

| Legacy | Precio | TIY | Precio |
|--------|-------:|-----|-------:|
| Premium 6 meses | 1.200 | TIY PREMIUM PIF | 1.500 |
| VIP 6 meses | 3.000 | TIY VIP PIF | 3.500 |

Mapear distorsionaría ingresos históricos.

**Solución acordada:** ampliar `OfferedProgram` con productos legacy e **precios históricos reales**, marcados inactivos para ventas nuevas:

| Nombre | Precio USD |
|--------|----------:|
| Premium 6 meses | 1.200 |
| VIP 6 meses | 3.000 |
| VIP Anual (12 meses) | 5.500 |
| Imperio Studio | 4.500 |
| Imperio Studio Pro | 5.500 |
| Express / Downsell | 300 |

⏸️ **Pendiente confirmación del cliente** antes de insertar en BD.  
(`OfferedProgram` aún no tiene flag `activo` — evaluar sort_order alto o migración menor.)

**Sin precio a propósito:** `Sin especificar`, `Otro`, `Herramienta 3 meses` — cash real en `lead_payment`.

---

## 2. Backfill complementario desde payload / CSV ✅

Para leads `source=legacy_juano` con `programa_ofrecido` vacío:

1. `legacy_lead_ref.payload->>'producto'`
2. Si vacío → `leads.csv` vía `legacy_id` (CSV vigente)

No pisa los ~79 ya llenados desde `lead_payment`.

**Resultado aplicado:** **2 leads** (Santiago Monares, Lida maria tovar) — únicos con producto en CSV y vacío en BD.

**Hallazgo:** los **284 de mayo sin programa** no tienen `producto` ni en payload (snapshot import) ni en CSV actual. El backfill complementario **no los resuelve**; quedaron sin oferta registrada en origen.

**Script:** `scripts/backfill_programa_from_payload.py`  
**Reporte:** `CLAUDE_BACKFILL_PROGRAMAS_PAYLOAD_JUANO.md`

---

## 3. Desglose leads modificados ✅

**Reporte:** `docs/CLAUDE_MODIFIED_LEADS_BREAKDOWN_JUANO.md`

| campo | leads | Notas |
|-------|------:|-------|
| **status (derivado ATV)** | **1.325** | Ruido: `lead.status` vs `map_situacion(CSV)` — **no upsertar** |
| presento | 28 | Cambios reales en payload vs CSV |
| producto | 32 | Mayoría `''` → valor en CSV (altas recientes) |
| setter / fuente | 32 c/u | Filas Thomas Gamba backfill julio |
| closer | 20 | Alias (`Catalina` → `Catalina Zarlenga`) |
| situacion | 16 | Edición real |
| calificado | 6 | |
| fecha_llamada | 1 | |
| cierre / correo / tel | 0 | |

**Leads con ≥1 diff payload vs CSV:** 1.327 — pero **~1.325 son status derivado**, no payload stale.

**Gap validate Presento Sí:** 2 filas (Lida maria tovar, Alejandro Basantes Rubio).

---

## 4. Presento bidireccional

53 cambios en `presento` (Sí↔No, Por tomar↔Sí) indican **corrección activa** en CRM viejo → priorizar congelamiento del origen.

**Gap validate (2 filas):** Lida maria tovar, Alejandro Basantes Rubio — `Por tomar` → `Sí`.

---

## 5. Estado

| # | Acción | Estado |
|---|--------|--------|
| 1 | 2 leads borrados marcados | ✅ |
| 2 | Backfill desde `lead_payment` | ✅ |
| 3 | Backfill desde payload/CSV | ✅ 2 leads |
| 4 | Catálogo legacy histórico | ⏸️ confirmar cliente |
| 5 | Desglose por campo | ✅ |
| 6 | Lista blanca + upsert leads | ⏳ tras desglose |

**Anclas intactas:** $265.526,99 total · julio $163.195,80.
