# Handoff único — Migración CRM juano → ATV

**Este es el ÚNICO archivo para pasarle a Claude.** Contiene migración, reconciliación, verificación UI y fixes pendientes.

**Audiencia:** Claude (revisión y decisiones). **Ejecución:** Cursor + operador humano.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Tenant:** `user_id = 1`, username `juano`  
**Fecha cierre técnico:** 2026-08-09  
**Estado:** **MIGRACIÓN CERRADA (técnica)** · fix doble conteo **implementado** (§10.2) · captura UI mayo pendiente

> Claude **no ejecuta** comandos. Cursor ejecuta scripts.

---

## 0. Resumen ejecutivo

| Métrica | Valor |
|---------|------:|
| **Ancla USD total** | **257.309,99** ✅ |
| **Ancla USD julio 2026** | **163.195,80** ✅ |
| Pagos importados | 357 |
| Leads procesados (`legacy_lead_ref`) | 2488 |
| ├─ merge_winner | 1328 |
| ├─ merge_absorbed | 29 |
| └─ new | 1131 |
| Cuotas importadas | 21 |
| Huérfanos pagos reconciliados | **15 / 24** |
| Huérfanos restantes (auditables) | **9** |
| Validación | `validate_legacy_juano.py` **exit 0** ✅ |

**Snapshot Neon rollback:** branch `pre-migracion-juano-2026-08-09`

**Pendiente bloqueante:** doble conteo Cash Collected en dashboard (§10.2) · captura UI mayo (§10.3).

---

## 1. Arquitectura y reglas clave

### Stack
- **Origen:** CSVs en `data/legacy/` (CRM Supabase schema `juano`)
- **Destino:** ATV — FastAPI + Pony ORM + Neon PostgreSQL + Next.js

### Modelo de datos
- **Contacto = `Lead`** · Pagos = **`lead_payment`** · Trazabilidad CSV = **`legacy_lead_ref`**
- Cuotas históricas = **`legacy_cuota_ref`** (snapshot, no fuente de saldos)
- Idempotencia: `UNIQUE (legacy_id)` + skip en re-import

### Deduplicación leads.csv vs ATV (crítico)
- **Unidad en ATV:** la **cita** (`ghl_appointment_id` 1:1), no la persona
- Matcheo: `ghl_contact_id` + **fecha llamada/agenda ±1 día**
- Matchear solo por contacto colapsaría **156** citas distintas
- **156** filas ATV comparten contacto GHL; **0** extras por `ghl_appointment_id`

### Política merge colisiones (implementada)
1. **Tokens de nombre:** `{A} ⊆ {B}` o viceversa → misma persona; si apellidos contradicen → separar
2. **Desempate:** fila que coincide con nombre ATV gana (evita caso 1855)
3. Perdedora incompatible → `create` (lead nuevo), no `absorb`
4. **`NEVER_TOUCH`** en merge: `status`, `estado`, `closer`, `setter`, `notas` — excepto backup (§5)

### Matcheo pagos → lead (fix post-import)
Orden: tel completo → tel10 → email → nombre+fecha ±30d → nombre exacto → tokens.  
Si falla: lead nuevo con `legacy_meta.lead_huerfano = true`.

---

## 2. Import real (2026-08-09T22:23:43Z)

| Métrica | Valor |
|---------|------:|
| Leads CSV | 2499 |
| Excluidos `es_prueba` | 11 |
| Neto `legacy_lead_ref` | 2488 |
| Colisiones resueltas | 30 grupos |
| Idempotencia 2.ª corrida | 2488 skipped ✅ |

**11 leads excluidos:** PRUEBA 5, x, Nicholas/PRUEBA MEDICOS…, DFS, Juan, Oko, Uuaq, yuyu, Veran, dsfd (emails prueba).

---

## 3. Colisiones — decisiones y correcciones

### Auditoría similitud (30 colisiones)
- OK (sim > 0.75): 23 · DUDOSO: 7 · REVISAR: 0
- **Criterio correcto:** tokens de nombre, no similitud global

### Casos decididos

| Lead | Decisión | Estado |
|------|----------|--------|
| **1855** Miguel Calderon / Arango | **REVERTIR** — apellidos distintos, merge invertido | ✅ lead **6989** (Arango), pago 509 |
| **1307** Jhoan Galvis / Jhoan y Anthuan | **NO revertir** — mismo evento, backup post-llamada | ✅ absorbido OK |
| **1663, 1313, 1578, 1469, 1714** | No tocar — nombre corto ⊂ largo | ✅ |

### Lead 1307 (resuelto)
- Mismo tel, misma `fecha_llamada`; winner = reserva GHL; absorbed = venta backup 19/07
- Pago $150 estaba en huérfano **6969** → reconciliado a **1307**
- Estado final: **Cerrado**, producto **Premium 6 meses** (gana pago, no EXPRESS del payload)
- ⚠️ $150 PIF vs lista ~$1.200 — anotar al cliente, no corregir

### Lead 1855 (revertido)
- **1855** = Miguel Calderon (merge_winner ref `130c030b…`)
- **6989** = Miguel Arango (new), pago 509 ($5 Fee)

---

## 4. Auditoría ventas backup (11 filas)

Origen `recuperado backup 2026-07-19`, todas `cierre=Sí`:

| Resultado | Cant. |
|-----------|------:|
| OK (Cerrado + pagos en lead) | 9 |
| Reconciliados post-audit | 2 (**1307**, **1313**) |

**Política backup aprobada (acotada):** si `origen` contiene `recuperado backup` y `cierre=Sí` → sobrescribir status/producto con `pre_import_snapshot`. Solo esas 11 filas. **No** extender a 43 filas con status GHL desactualizado (deuda preexistente).

---

## 5. Huérfanos de pagos (24 total)

**Problema:** import de pagos creó leads `source=legacy_juano` sin `legacy_lead_ref` cuando falló matcheo.

**Impacto:** ancla USD intacta; atribución incorrecta; duplicados invisibles en UI.

### Estado final

| Categoría | Cant. | USD | Notas |
|-----------|------:|----:|-------|
| Reconciliados pasada 1 | 13 | 7.632 | AUTO 7 + REVISIÓN 6 |
| Reconciliados pasada 2 | 2 | 3.000 | 6976→1539, 6977→1838 |
| **Total reconciliado** | **15** | **10.632** | |
| Legítimos (solo pagos.csv) | 4 | 1.744 | 6980, 6971, 6978, 6975 |
| Sin evidencia | 4 | 2.296,50 | 6970, 6962, 6964, 6973 |
| Bloqueado cliente | 1 | 3.076 | **6965** Brayan/Dylan |

Huérfanos vaciados: **no borrados** — `legacy_meta.merged_into`, `status=merged`.  
Restantes: `legacy_meta.lead_huerfano = true`.

### Pasada 1 — 13 reconciliados (aplicado)

| Huérfano | → Destino | USD |
|---------:|-----------|----:|
| 6972 | 1313 David Arevalo | 1.500 |
| 6979 | 1837 David Mosquera | 1.500 |
| 6983 | 1625 Juliana Gallo | 1.500 |
| 6974 | 1457 Julieth Lorena Cortes | 312 |
| 6969 | 1307 Jhoan Galvis | 150 |
| 6985 | 1675 Camilo Garzón | 64 |
| 6984 | 2413 Camila valencia | 63 |
| 6982 | 1645 Yeison Vargas perez | 1.000 |
| 6967 | 6278 Kamilo Guayara | 600 |
| 6968 | 1275 Stiven Echavarria | 463 |
| 6981 | 2007 David Santiago Arias Cruz | 350 |
| 6966 | 6161 Jhon Fredy Orozco Norena | 100 |
| 6963 | 6136 Brayan Muñoz | 30 |

### Pasada 2 — 2 reconciliados (aplicado)

| Huérfano | → Destino | USD | Nota |
|---------:|-----------|----:|------|
| 6976 | 1539 Catalina | 1.500 | ±7d OK (Δcall=2d) |
| 6977 | 1838 Edgar René Inamagua | 1.500 | nombre+fecha Δ0d; **tel distinto** (612…) |

### NO aplicados (confirmado)

| ID | USD | Razón |
|----|----:|-------|
| 6970 Ryan | 1.000 | Δ 36–41d vs call |
| 6962 Santiago Rodriguez | 78,50 | Δ 21–50d |
| 6964 Jorge Luis Banol Duran | 1.168 | 3× "Jorge", tel distintos |
| 6973 Sebastian Mosquera | 50 | tel distintos, nombre genérico |
| 6965 Brayan/Dylan Rengifo | 3.076 | dos nombres — revisión cliente |

### Casos especiales documentados
- **6968 → 1275:** pagos distintos ($463 15/07 + $837 24/07) — no duplicado
- **6967 → 6278:** posible explicación sobrepago cuotas Kamilo — no corregir
- **6977 → 1838 vs 2111:** probable duplicado GHL Edgar — **no fusionar ahora**
- **6965:** patrón Jhoan y Anthuan, $3.076 — preguntar si hermanos o error

---

## 6. Cuotas — flags

| Flag | Casos |
|------|-------|
| `duplicado_probable` | Dania Sanchez ×2, Juan Hernandez ×2 |
| `sobrepago` | Kamilo Guayara −500, Juan Hernandez −125 |

---

## 7. Scripts y comandos

```powershell
cd backend

# Validación ancla (siempre)
python ../scripts/validate_legacy_juano.py --user-id 1

# Auditoría huérfanos restantes
python ../scripts/audit_pago_huerfanos.py

# Reconciliación (ya ejecutada; referencia)
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --dry-run
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6976 --force 6977:1838 --finalize

# Reversión colisión (1855 — ya hecho)
python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --yes

# Import / rollback
python ../scripts/import_legacy_juano.py --user-id 1 --yes
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
```

**Criterio control:** USD debe ser **exactamente 257.309,99** tras cualquier movimiento de pagos entre leads.

---

## 8. SQL útil

```sql
-- Conteo legacy_lead_ref
SELECT rol, COUNT(*) FROM legacy_lead_ref WHERE user_id = 1 GROUP BY rol;

-- Huérfanos activos (sin merged_into)
SELECT l.id, l.nombre, l.status,
  l.legacy_meta->>'lead_huerfano' AS huerfano,
  l.legacy_meta->>'merged_into' AS merged_into,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos,
  (SELECT SUM(p.monto) FROM lead_payment p WHERE p.lead_id = l.id) AS usd
FROM lead l
WHERE l.user_id = 1 AND l.source = 'legacy_juano'
  AND NOT EXISTS (SELECT 1 FROM legacy_lead_ref r WHERE r.lead_id = l.id)
  AND COALESCE(l.legacy_meta->>'merged_into', '') = ''
ORDER BY usd DESC NULLS LAST;

-- Payload colisión
SELECT rol, legacy_id, motivo, payload
FROM legacy_lead_ref
WHERE user_id = 1 AND lead_id = 1307 ORDER BY rol;

-- Ancla pagos
SELECT COUNT(*), SUM(monto) FROM lead_payment WHERE user_id = 1 AND source = 'legacy_juano';
```

---

## 9. Lista para el cliente (no corregimos a propósito)

| Caso | Pregunta |
|------|----------|
| **6965** Brayan/Dylan ($3.076) | ¿Hermanos que compraron juntos o error de carga? |
| **Edgar** leads 1838 + 2111 | ¿Fusionar duplicado GHL? |
| **Kamilo Guayara** | Sobrepago cuotas; pago huérfano $600 |
| **Juan Hernandez** (cuotas) | Duplicado 375 vs 1.500 |
| **Dania Sanchez** (cuotas) | Duplicado programa/closer |
| **Jhoan Galvis** | $150 PIF etiquetado Premium 6 meses |
| **39 pagos sin producto** | ¿Clasificar Sin especificar/Otro? |
| **CRM viejo activo** | Fecha de corte / import incremental |

---

## 10. Verificación UI — datos OK, presentación con problemas

Capturas dashboard ATV (julio 2026) + análisis BD/código (2026-08-10).

### 10.1 ✅ La migración llegó — confirmado

| Elemento | Valor UI | Esperado / BD |
|---|---:|---:|
| **Cuotas (julio)** | **$163.196** | **$163.195,80** ✅ (211 filas legacy) |
| Pago (julio) | $157.763 | $156.263 native `Lead.pago` (leads con `call` en jul) ≈ ✅ |
| Cash Collected total julio | ~~$320.959~~ → **~$168.958** | Fix fuente única (§10.2) ✅ |
| Ancla USD total | — | **257.309,99** ✅ (`validate_legacy_juano.py` exit 0) |

**Los datos están en ATV.** Ancla julio cuadra. Cash julio corregido con fuente única (§10.2).

### 10.2 🔴 Doble conteo Cash Collected — **FIX IMPLEMENTADO** (2026-08-10)

**Diagnóstico:** `Lead.pago` = acumulado denormalizado de `LeadPayment`. El dashboard sumaba ambos → duplicación. La migración pobló las dos y expuso el bug de diseño.

**Consulta previa (julio, user_id=1):**

| Métrica | Valor |
|---|---:|
| `lp_legacy` | $163.195,80 |
| `lp_nativo` | $0 |
| `leads_sin_lp` (pago solo en `Lead.pago`) | 5 leads · **$5.762** |

**Regla de fuente única** (`leads-analytics.ts` + API `/cobranzas/pagos/month`):

```
cash = SUM(LeadPayment.monto, fecha ∈ mes)
     + SUM(Lead.pago, call ∈ mes, lead SIN ningún LeadPayment)
```

**Buckets por `concepto`:**

| concepto | Bucket |
|---|---|
| PIF, 1ra Cuota, Otro | Pago |
| 2da Cuota, 3ra Cuota | Cuotas |
| Fee | Seguimiento (+ SeguimientoReport nativo) |

**Cifras julio post-fix (control ✅):**

| Bucket | USD |
|---|---:|
| Pago (legacy + $5.762 nativo sin historial) | $144.554 |
| Cuotas | $15.316 |
| Seguimiento (Fee) | $9.087,80 |
| **Legacy en buckets** | **$163.195,80** exacto |
| **Total cash julio** | **$168.957,80** |

**Archivos tocados:** `frontend/src/features/leads/services/leads-analytics.ts`, `backend/src/controllers/cobranzas_controller.py` (campo `concepto` + `lead_ids_with_history`). **No se tocó `Lead.pago` ni ancla 257.309,99.**

Solapamiento eliminado: ~~$143.369~~ (177 pagos).

### 10.3 ✅ `Lead.pago` nativo — no se pisó (2026-08-10)

**Preocupación:** el import recalcula `Lead.pago` en merges; ATV registraba cash solo en `Lead.pago` (0 filas nativas en `LeadPayment` julio).

**Verificación vs `pre_import_snapshot`:**

| Métrica | Valor |
|---|---:|
| Leads mergeados con snapshot | 1.337 |
| Tenían `pago` nativo > 0 | **6** (no 1.353) |
| `pago` reducido vs snapshot | **0** |
| USD previo (esos 6) | $5.024 |
| USD actual | $6.224 |
| **`usd_perdido`** | **$0** ✅ |

**Conclusión:** el recálculo **nunca redujo** un valor nativo. Algunos subieron (legacy sumó pagos). Los **5 leads** julio con pago solo en `Lead.pago` ($5.762) son nativos sin historial `LeadPayment` — correctos en el fix de fuente única.

**Mensaje cliente (cash jul $320k → $169k):** *el dashboard contaba el mismo dinero dos veces; ahora cada pago cuenta una vez.*

```sql
-- Repetir verificación
SELECT COUNT(*) FILTER (WHERE snap_pago > 0 AND l.pago < snap_pago) AS pago_reducido,
       COALESCE(SUM(snap_pago - COALESCE(l.pago,0))
         FILTER (WHERE snap_pago > 0 AND l.pago < snap_pago), 0) AS usd_perdido
FROM (
  SELECT l.*, NULLIF(l.legacy_meta->'pre_import_snapshot'->>'pago','')::numeric AS snap_pago
  FROM lead l WHERE l.user_id = 1 AND l.legacy_meta ? 'pre_import_snapshot'
) l;
-- Resultado: 0, 0
```

### 10.4 Checklist operador (pendiente visual)

- [x] Cash Collected julio cuotas → ancla cuadra
- [ ] Cash Collected **total** → **$257.309,99**
- [ ] **Captura dashboard "Mayo De 2026"** → esperado ~$32.113 cash / 328 leads (mejor que abril: 3 leads)
- [ ] **Jhoan Galvis** (1307): un lead, Cerrado, pago $150 PIF
- [ ] Un solo lead: Sebastián Galviz (1134), Juan Pablo Grisales (1207), David Arevalo (1313)

### 10.5 🔴 Funnel roto — causa raíz (⏸️ no tocar sin cliente)

**Síntoma en UI (julio 2026):**

| Métrica | UI | Problema |
|---|---:|---|
| Conversaciones | **0** | — |
| Agendas | **0** | Contradice Shows 213 |
| Shows | 213 | Parece OK |
| Cierres | **2** | Imposible con $320.959 cobrados |
| Close Rate | 0,9% | Consecuencia |
| Show Up Rate | 0,0% | Agendas 0 en denominador |

**Causa raíz (corrección importante):** el sales dashboard **no lee leads**; suma reportes diarios:

| Métrica | Tabla | Campo | Archivo |
|---|---|---|---|
| Conversaciones | `SetterReport` | `conversaciones` | `frontend/src/features/leads/services/leads-analytics.ts` |
| Agendas | `SetterReport` | `agendas` | idem |
| Shows | `CloserReport` | `shows` | idem |
| Cierres | `CloserReport` | `cierres` | idem |

**Julio 2026 en BD (`user_id=1`):**

| Fuente | conv | agendas | shows | cierres |
|---|---:|---:|---:|---:|
| Reportes (lo que ve la UI) | 0 | 0 | **213** | **2** |
| Leads con `call` en jul (real) | — | — | **1.319** | **128** |

- **Shows 213** = suma de **11 `CloserReport`** nativos ATV (panel-diario), **no** leads migrados ni pagos.
- **Agendas 0 / Conversaciones 0** = **0 `SetterReport`** en julio.
- **Cierres 2** = solo esos 11 reportes; ignora 128 leads `status=Cerrado`.

Leads migrados **sí tienen** `agendo` y `call` (mayo: 328 legacy).

**El funnel NO lo rompió la migración.** Julio ya estaba así antes:

| Julio 2026 | Valor |
|---|---:|
| Shows según reportes (UI) | **213** |
| Leads ATV nativos con `agendo` en jul | **1.222** |
| Leads total `agendo` jul | **1.436** |

Los 11 `CloserReport` son **nativos ATV** — el equipo cargó 11 reportes manuales en un mes con 1.222+ citas. El dashboard suma **declaraciones del equipo**, no leads.

**Decisión (§11):** ⏸️ **NO backfillear** `SetterReport`/`CloserReport` (serían sintéticos, sumarían a los 11 reales → doble conteo). **NO cambiar analytics** sin conversación con cliente — es cambio de producto ATV, no alcance migración.

**Acción:** documentar hallazgo al cliente (213 reportados vs 1.222 agendas reales) y que decida.

### 10.6 🟡 Buckets cash — **incluido en fix §10.2**

Reclasificación por `concepto` implementada junto con fuente única. Ya no es fix separado.

### 10.7 🟢 Productos duplicados — backfill aprobado (pendiente)

**Síntoma UI:** `Premium 6 meses` (124) vs `PREMIUM (6 MESES)` (52) como programas separados.

**Causa:** `LeadPayment.producto` normalizado ✅; `Lead.programa_ofrecido` crudo en legacy.

**Fix:** backfill `programa_ofrecido` solo `source='legacy_juano'`. **Pendiente.**

### 10.8 Orden de ejecución

| # | Acción | Estado |
|---|--------|--------|
| 1 | Fix doble conteo + buckets | ✅ |
| 2 | Verificar `Lead.pago` nativo no pisado | ✅ `usd_perdido = 0` |
| 3 | Backfill `programa_ofrecido` legacy | 🟢 pendiente |
| 4 | Captura UI **mayo 2026** | operador |
| 5 | Funnel | ⏸️ decisión cliente |

### 10.9 SQL verificación UI

```sql
-- Doble conteo julio
SELECT COUNT(*) AS pagos, SUM(p.monto) AS usd_doble_conteo
FROM lead_payment p JOIN lead l ON l.id = p.lead_id
WHERE p.user_id = 1 AND p.source = 'legacy_juano'
  AND p.fecha >= '2026-07-01' AND p.fecha < '2026-08-01'
  AND l.call >= '2026-07-01' AND l.call < '2026-08-01'
  AND COALESCE(l.pago, 0) > 0;

-- Productos por source (lead_payment)
SELECT source, producto, COUNT(*)
FROM lead_payment WHERE user_id = 1
GROUP BY source, producto ORDER BY source, COUNT(*) DESC;

-- Funnel julio (reportes vs realidad)
SELECT 'setter' AS tipo, SUM(conversaciones), SUM(agendas)
FROM setter_report WHERE user_id = 1 AND fecha BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'closer', SUM(shows), SUM(cierres)
FROM closer_report WHERE user_id = 1 AND fecha BETWEEN '2026-07-01' AND '2026-07-31';

-- Leads julio por call
SELECT COUNT(*) AS leads,
  SUM(CASE WHEN LOWER(COALESCE(status, estado, '')) != 'no show' THEN 1 ELSE 0 END) AS shows,
  SUM(CASE WHEN LOWER(COALESCE(status, estado, '')) = 'cerrado' THEN 1 ELSE 0 END) AS cierres
FROM lead WHERE user_id = 1 AND call >= '2026-07-01' AND call < '2026-08-01';

-- Abril / mayo legacy
SELECT DATE_TRUNC('month', call)::date AS mes, COUNT(*) AS leads,
  SUM(CASE WHEN source = 'legacy_juano' THEN 1 ELSE 0 END) AS legacy
FROM lead WHERE user_id = 1 AND call >= '2026-04-01' AND call < '2026-06-01'
GROUP BY 1;
```

---

## 11. Decisiones fixes presentación (2026-08-10)

Documento operador consolidado aquí. Resumen:

1. **Doble conteo cash** — confirmado **$143.369,30** solapamiento julio. Fix en dashboard (`leads-analytics.ts`), no en BD. **Primero.**
2. **Funnel** — preexistente ATV (213 reportados vs 1.222 agendas nativas jul). **No backfill reportes.** **No cambiar analytics** sin OK cliente.
3. **Buckets** — Opción A (`concepto` en frontend) **aprobada**, después de #1.
4. **Productos** — backfill `programa_ofrecido` legacy **aprobado**.
5. **Verificación fechas** — BD OK mayo (328 / $32.113). Falta **captura UI mayo**.

**Ancla USD 257.309,99 intacta** — el doble conteo es bug de presentación del dashboard, no duplicación real de pagos en BD.

---

## 12. Sin tocar (a propósito)

| Pendiente | Por qué |
|-----------|---------|
| 74 `posible_dup` por nombre | Detectables; fusionar mal es peor |
| 60 `match_ambiguo` | Ídem |
| 43 status GHL desactualizado | Preexistente, no de la migración |
| Métricas Cierres/Revenue CRM viejo | Close rate 129,9% imposible; ATV fórmula propia |
| 9 huérfanos no reconciliados | Sin evidencia o bloqueados — auditables con flag |

---

## 13. Rollback

**Nuclear:** restore branch Neon `pre-migracion-juano-2026-08-09`

**Acotado:** `scripts/rollback_legacy_juano.py --user-id 1`

Verificación post-rollback:
```sql
SELECT COUNT(*) FROM lead WHERE source = 'legacy_juano';           -- 0
SELECT COUNT(*) FROM lead_payment WHERE source = 'legacy_juano';   -- 0
SELECT COUNT(*) FROM legacy_lead_ref WHERE user_id = 1;            -- 0
```

---

## 14. Archivos clave

| Archivo | Rol |
|---------|-----|
| `backend/src/services/legacy_juano_import.py` | Import, colisiones, matcheo pagos |
| `backend/src/models.py` | `LegacyLeadRef`, `LegacyCuotaRef` |
| `scripts/import_legacy_juano.py` | CLI import |
| `scripts/validate_legacy_juano.py` | Validación ancla |
| `scripts/reconcile_pago_huerfanos.py` | Reconciliación huérfanos |
| `scripts/revert_collision_absorption.py` | Reversión colisión |
| `scripts/audit_pago_huerfanos.py` | Conteo huérfanos |
| `scripts/report_huerfanos_pending.py` | Reporte ±7d / ambiguos |
| `data/legacy/expected_counts.json` | Ancla conteos origen |

---

## 15. Timeline completo

| Fecha | Hito |
|-------|------|
| 2026-08-09 | Import real 2488 leads + 357 pagos ✅ |
| 2026-08-09 | Auditoría 30 colisiones |
| 2026-08-09 | Reversión 1855 → lead 6989 ✅ |
| 2026-08-09 | Decisión 1307: no revertir; backup = misma persona ✅ |
| 2026-08-09 | Auditoría ventas backup (9/11 OK) |
| 2026-08-09 | Reconciliación huérfanos pasada 1 (13) ✅ |
| 2026-08-09 | Reconciliación pasada 2 (6976, 6977) ✅ |
| 2026-08-09 | Validación final exit 0 ✅ |
| 2026-08-10 | Verificación UI + doble conteo **$143.369** confirmado |
| 2026-08-10 | Verificación `Lead.pago` nativo: **usd_perdido = 0** ✅ |
| Pendiente | Backfill productos · captura UI mayo |

---

*Documento único para Claude. Supersedes todos los demás `CLAUDE_*.md`, `verificacion-ui-hallazgos.md` y `MIGRACION_JUANO.md` para handoff.*
