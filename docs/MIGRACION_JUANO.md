# Migración CRM legacy (juano) → ATV

> **⚠️ Para Claude usar solo [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md)** — este archivo es referencia operativa local.

**Estado: MIGRACIÓN CERRADA — 2026-08-09** (import + reconciliación huérfanos)

Referencia: `prompt-cursor-migracion-juano.md` · Aprobación: `respuesta-mapeo-juano.md`

**Snapshot Neon:** branch `pre-migracion-juano-2026-08-09` (operador)

---

## Reconciliación huérfanos de pagos (cierre)

| Pasada | Reconciliados | USD movido (atribución) |
|--------|-------------:|------------------------:|
| 1 (AUTO 7 + REVISIÓN 6) | 13 | 7.632 |
| 2 (6976, 6977→1838) | 2 | 3.000 |
| **Total** | **15** | **10.632** |

**9 restantes** como leads propios auditables (`legacy_meta.lead_huerfano = true`): 4 solo en pagos.csv + 4 sin evidencia + 6965 bloqueado cliente.

**USD post-reconciliación:** **257.309,99** ✅ · `validate_legacy_juano.py` exit 0 ✅

Correcciones post-import:
- Reversión colisión **1855** → lead **6989** (Miguel Arango), pago 509
- **1307** Jhoan Galvis: Cerrado, Premium 6 meses, pago $150
- **1313** David Arevalo: Cerrado, Premium 6 meses, pago $1.500

Scripts: `scripts/reconcile_pago_huerfanos.py` · Handoff Claude: **`docs/CLAUDE_JUANO.md`** (documento único)

---
## Resultado del import real

| Métrica | Valor |
|---------|------:|
| **Fecha/hora import** | 2026-08-09T22:23:43Z (user_id=1, username `juano`) |
| Pagos importados | 357 |
| Suma USD total | **257.309,99** |
| Suma USD julio 2026 | **163.195,80** |
| Leads CSV origen | 2499 |
| Excluidos es_prueba | 11 |
| Neto procesado | **2488** (`legacy_lead_ref`) |
| ├─ merge_winner | 1328 |
| ├─ merge_absorbed | 29 |
| └─ new | 1131 |
| Cuotas importadas | 21 (1 excluida: `fgghhhh`) |
| Colisiones resueltas | 30 grupos (30 ganadoras + 30 absorbidas) |
| Idempotencia 2.ª corrida | 2488 leads skipped, 357 pagos skipped, 21 cuotas skipped ✅ |
| Validación post-import | **exit 0** ✅ |

---

## Contexto

- **Origen:** CRM Supabase schema `juano` — CSVs en `./data/legacy/`
- **Destino:** ATV — FastAPI + Pony ORM + PostgreSQL (Neon)
- **Idempotencia:** `UNIQUE (legacy_id)` en `legacy_lead_ref`, `lead_payment`, `legacy_cuota_ref` + skip en importador
- **Trazabilidad leads:** tabla **`legacy_lead_ref`** (ganador / absorbida / new) con `payload` JSON completo

**Contacto = `Lead`.** Pagos = **`lead_payment`**. Cuotas históricas = **`legacy_cuota_ref`**.

---

## Leads excluidos (`es_prueba`) — 11

| Nombre | Email |
|--------|-------|
| PRUEBA 5 | ws@gmail.com |
| x | x@gmail.com |
| Nicholas MEDICOS Y SEGURIDAD INDUSTRIAL LATAM SAS | nicholas@gmail.com |
| PRUEBA MEDICOS Y SEGURIDAD INDUSTRIAL LATAM SAS | prueba12@gmail.com |
| DFS | awm@oytk.com |
| Juan | djjej@gmail.com |
| Oko | oko@gmail.com |
| Uuaq | uuq@gmail.com |
| yuyu | yuyu@gmail.com |
| Veran | veran@gmail.com |
| dsfd | alfggh9._@hotmail.com |

---

## Colisiones de merge (30) — ganadora + absorbida

Política: misma persona/misma fecha en CRM legacy → **una fila gana** (más campos no nulos; empate → `created_at` más reciente). La perdedora queda en `legacy_lead_ref` con `rol=merge_absorbed` — **sin lead duplicado en UI**.

| ATV lead_id | Nombre ATV | Ganadora (CSV) | Absorbida (CSV) | Motivo |
|------------:|------------|----------------|-----------------|--------|
| 1134 | Sebastián Galviz | Sebastián Galviz | Sebastian Galvis | score=8 |
| 1207 | Juan Pablo Grisales | Juan Pablo Grisales | Juan Pablo Grisales | score=8 |
| 1307 | Jhoan Galvis | Jhoan Galvis | Jhoan y Anthuan | score=8 |
| 1313 | David Arevalo | David Esteban Arevalo Fajardo | David Arevalo | empate score=8, created_at |
| 1383 | Julián Rendon | Julián Rendon | Julian Rendon | score=8 |
| 1439 | Walter Matos | Walter Matos | Walter Matos | score=8 |
| 1467 | Dylan Martinez | Dylan Martinez | Dylan Martinez | score=8 |
| 1469 | Cristian Rios Rios Ortiz | Cristian Rios Rios Ortiz | Cristian Rios | score=8 |
| 1472 | clinton daniel hernandez | clinton daniel hernandez | Clinton Daniel Hernandez | score=8 |
| 1481 | Juan Andrés Arjona | Juan Andrés Arjona | Juan Andres Arjona | score=8 |
| 1482 | Cristian Chavez | Cristian Chavez | Cristian Chavez | score=8 |
| 1483 | Juan Toro | Juan Toro | Juan Toro | score=8 |
| 1542 | Julián Chávez | Julián Chávez | Julian Chavez | score=8 |
| 1568 | Alex Obando | Alex Obando | Alex Obando | score=8 |
| 1578 | Jackson Ricardo Moncada Sanchez | Jackson Ricardo Moncada Sanchez | Jackson Moncada | score=8 |
| 1645 | Yeison Vargas perez | Yeison Vargas | Yeison Vargas perez | empate score=8, created_at |
| 1632 | Shirley Muñoz | Shirley Muñoz | Shirley Muñoz | score=8 |
| 1584 | Danna Silva | Danna Silva | Danna Silva | score=8 |
| 1687 | Juan Vargas | Juan Vargas | Juan Vargas | score=8 |
| 1625 | Juliana Gallo | Juliana Gallo Giraldo | Juliana Gallo | empate score=8, created_at |
| 1587 | Juan Carlos Gonzalez | Juan Carlos Gonzalez | Juan Carlos Gonzalez | score=8 |
| 1714 | Jose David | Jose David | Jose David Sevilla | score=8 |
| 1712 | Nicolás Acero | Nicolás Acero | Nicolas Acero Montoya | score=8 |
| 1663 | Montse Payan | Montserrat Payan Leon Bonilla | Montse Payan | empate score=8, created_at |
| 1855 | Miguel Calderon | Miguel Calderon | Miguel Arango | **revertida** — Arango → lead 6989 |
| 1825 | Adrian Rodriguez | Adrian Rodriguez | Adrian Rodriguez | empate score=8, created_at |
| 2133 | Renato Segura | Renato Segura | Renato Segura | empate score=8, created_at |
| 2547 | Ronald barrios | Ronald Barrios | Ronald barrios | empate score=8, created_at |
| 2363 | Juan Felipe Rodríguez Cruz | Juan Felipe Rodríguez Cruz | Juan Felipe Rodriguez | score=9 |
| 1893 | Steeven Ordonez | Steeven Ordonez | Steeven Ordonez | empate score=9, created_at |

Auditoría SQL:

```sql
SELECT rol, COUNT(*) FROM legacy_lead_ref WHERE user_id = 1 GROUP BY rol;
SELECT * FROM legacy_lead_ref WHERE user_id = 1 AND rol = 'merge_absorbed';
```

---

## Cuotas — flags post-migración

### `duplicado_probable` (4 filas)

| Alumno | Notas |
|--------|-------|
| Dania Sanchez ×2 | mismo alumno, `siguiente_cobro` vacío, ~3 min entre `created_at`; distinto programa/closer |
| Juan Hernandez ×2 | cargas duplicadas 2026-08-09 (~2 min); montos distintos (375 vs 1500) |

### `sobrepago` / saldo negativo (2)

| Alumno | Saldo |
|--------|------:|
| Kamilo Guayara | −500 |
| Juan Hernandez | −125 (probablemente consecuencia del duplicado) |

---

## Pendientes post-migración (no bloqueantes)

| # | Tema | Acción |
|---|------|--------|
| 1 | **74 `posible_dup` por nombre** | Revisión manual — creados como nuevos a propósito |
| 2 | **60 `match_ambiguo`** | Revisión manual |
| 3 | **4 `duplicado_probable` cuotas** | Decidir fila correcta con cliente |
| 4 | **2 `sobrepago` cuotas** | Revisar tras decidir #3 |
| 5 | **Pagos Sin especificar / Otro** | Clasificación manual opcional |
| 6 | **CRM viejo sigue vivo** | Definir fecha congelamiento; re-import incremental soportado |
| 7 | **Métricas Cierres/Revenue** | ATV usa fórmula propia; no replicar close rate 129,9% del CRM viejo |

---

## Rollback

**Confiable:** restore branch Neon `pre-migracion-juano-2026-08-09`.

**Acotado (dev):**

```bash
cd backend
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
python ../scripts/rollback_legacy_juano.py --user-id 1
```

Verificación:

```sql
SELECT COUNT(*) FROM lead WHERE source = 'legacy_juano';              -- 0
SELECT COUNT(*) FROM lead_payment WHERE source = 'legacy_juano';      -- 0
SELECT COUNT(*) FROM legacy_cuota_ref WHERE source = 'legacy_juano'; -- 0
SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = 1;               -- 0
```

---

## Verificación funcional UI (operador) — pendiente humano

- [ ] Cash Collected total → **$257.309,99**
- [ ] Cash Collected julio 2026 → **$163.195,80**
- [ ] Filtrar **abril o mayo 2026** → leads históricos visibles (`agendo`/`call`)
- [ ] **Jhoan Galvis** (1307) → un solo lead, Cerrado, pago $150 PIF
- [ ] Un solo lead para: Sebastián Galviz (1134), Juan Pablo Grisales (1207), David Arevalo (1313)

---

## Ejecución (referencia)

```bash
cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --report-duplicates
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
python ../scripts/import_legacy_juano.py --user-id 1 --yes    # import real
python ../scripts/validate_legacy_juano.py --user-id 1
python ../scripts/import_legacy_juano.py --user-id 1 --yes    # idempotencia
python ../scripts/validate_legacy_juano.py --user-id 1
```

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `backend/src/services/legacy_juano_import.py` | Import + colisiones + `legacy_lead_ref` |
| `backend/src/models.py` | `LegacyLeadRef`, `LegacyCuotaRef` |
| `scripts/import_legacy_juano.py` | CLI |
| `scripts/validate_legacy_juano.py` | Validación post-import |
| `scripts/rollback_legacy_juano.py` | Rollback acotado |
| `data/legacy/expected_counts.json` | Ancla conteos origen |
| `data/legacy/import_summary.json` | Resumen última corrida |

**Ancla financiera:** Cash Collected = **257.309,99 USD** (julio: **163.195,80 USD**).
