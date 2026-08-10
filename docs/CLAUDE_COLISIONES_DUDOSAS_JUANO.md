# Handoff — Colisiones dudosas post-import juano

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único.**

**Audiencia:** Claude (revisión y decisiones). **Ejecución:** Cursor + operador humano.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Fecha:** 2026-08-09  
**Contexto:** Import real completado (`docs/MIGRACION_JUANO.md`). Auditoría de 30 colisiones hecha. Decisiones humanas en `decision-colisiones-dudosas.md` (Escritorio).

> Claude **no ejecuta** comandos ni accede al repo. Revisa payloads y decide go/no-go. Cursor ejecuta scripts.

---

## 0. Resumen ejecutivo

| Clasificación auditoría (similitud) | Cantidad |
|-------------------------------------|--------:|
| OK (sim > 0.75) | 23 |
| DUDOSO (0.45–0.75) | 7 |
| REVISAR (sim < 0.45) | 0 |

**Decisión humana (2026-08-09):**

| Lead | Acción |
|------|--------|
| **1855** | **REVERTIR** — Arango y Calderon son personas distintas; merge invertido |
| **1307** | **Investigar** — esperar decisión con payloads |
| **1663, 1313, 1578, 1469, 1714** | **No tocar** — patrón nombre corto ⊂ largo (misma persona) |

**Criterio correcto (reemplaza umbral de similitud):** comparación por **tokens** de nombre. Si `{tokens A} ⊄ {tokens B}` y viceversa → personas distintas. Desempate: fila que coincide con nombre ATV gana.

---

## 1. Lead 1307 — payloads (pendiente decisión)

**Lead ATV:** `Jhoan Galvis` · `jhoan03galvis@gmail.com` · `+573212677978` · **0 pagos**

### merge_winner — `Jhoan Galvis`

`legacy_id`: `6b985f3a-846a-4dd1-b32a-d43ce937c89e` · motivo: `ghl_contact_call`

| Campo | Valor |
|-------|-------|
| correo | jhoan03galvis@gmail.com |
| telefono / tel_norm | +573212677978 |
| fecha_llamada | 2026-07-16 |
| fecha_agenda | 2026-07-16 |
| cierre | **No** |
| situacion | Nuevo |
| presento | Por tomar |
| producto | *(vacío)* |
| origen | *(vacío)* |
| ghl_contact_id | p5CQNv26XUHtkNuF3i31 |
| closer | Thomas Gamba |
| fuente | TU IMPERIO YOUTUBE \| Calendario 2026 |
| created_at | 2026-07-16 17:48:33 UTC |

### merge_absorbed — `Jhoan y Anthuan`

`legacy_id`: `123eb135-905f-462d-a5dc-8f452d1ed93b` · motivo: `collision_absorbed:score=8 campos no nulos`

| Campo | Valor |
|-------|-------|
| correo | *(vacío)* |
| telefono / tel_norm | +573212677978 |
| fecha_llamada | 2026-07-16 |
| fecha_agenda | *(vacío)* |
| cierre | **Sí** |
| situacion | **Venta** |
| presento | **Sí** |
| producto | **EXPRESS** |
| origen | recuperado backup 2026-07-19 |
| ghl_contact_id | *(vacío)* |
| closer | Thomas Gamba |
| fuente | Ads |
| created_at | 2026-07-20 06:10:48 UTC |

### Análisis para Claude

- **Tokens:** `{jhoan, galvis}` vs `{jhoan, anthuan}` → no subconjuntos → **no misma persona** con regla nueva.
- **Mismo teléfono y misma fecha_llamada**, pero perfiles opuestos: pipeline vs venta cerrada.
- Una fila tiene correo + ghl; la otra no (backup recuperado).
- Con regla preventiva ya implementada, en un re-import **no se absorberían**; quedarían como leads separados.

**Pregunta abierta:** ¿revertir como 1855 (Galvis winner en 1307, Anthuan → lead nuevo), dejar absorbido, u otro criterio?

---

## 2. Lead 1855 — payloads + reversión aprobada

**Lead ATV:** `Miguel Calderon` · `calderonesteb23@gmail.com` · `+573012089067` · **1 pago**

### merge_winner (incorrecto) — `Miguel Arango`

`legacy_id`: `1429fc42-783b-423e-a591-3ed76e014630` · motivo: `tel_norm`

| Campo | Valor |
|-------|-------|
| correo | *(vacío)* |
| telefono / tel_norm | +573012089067 |
| cierre | **Sí** |
| situacion | **Fee** |
| presento | Sí |
| producto | Premium 6 meses |
| ghl_contact_id | *(vacío)* |
| setter | Setter IA |
| created_at | 2026-07-30 02:51:58 UTC *(más reciente → ganó por score)* |

### merge_absorbed (debería ser winner) — `Miguel Calderon`

`legacy_id`: `130c030b-79f6-40b2-b860-1f5832d9ac37` · motivo: `collision_absorbed:empate score=8, gana created_at más reciente`

| Campo | Valor |
|-------|-------|
| correo | calderonesteb23@gmail.com |
| telefono / tel_norm | +573012089067 |
| cierre | No |
| situacion | Nuevo |
| presento | Por tomar |
| ghl_contact_id | UU6WjgPkJlsJrnrgUdif |
| created_at | 2026-07-28 02:13:51 UTC |

### Pago mal asignado

| Campo | Valor |
|-------|-------|
| lead_payment.id | **509** |
| monto | $5 |
| concepto | Fee |
| fecha | 2026-07-29 |
| legacy_id | `004c559e-b5c2-4a70-a730-24c20b5e7dd1` |
| cliente en pagos.csv | **Miguel Arango** |

**Problema:** merge invertido. Calderon coincide con ATV; Arango es otra persona (`{miguel, arango}` ⊄ `{miguel, calderon}`).

### Plan de corrección (aprobado, no ejecutado en real)

1. `Miguel Calderon` → `merge_winner` en lead **1855**
2. `Miguel Arango` → **lead nuevo**, `legacy_lead_ref.rol='new'`, `motivo='colision_revertida_apellido_distinto'`
3. Reasignar pago **509** al lead nuevo de Arango
4. Refrescar datos del lead 1855 desde payload Calderon

---

## 3. Dry-run reversión 1855 (2026-08-09)

Script: `scripts/revert_collision_absorption.py`

```powershell
cd backend
python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --dry-run
```

**Output:**

```
=== REVERT COLISIÓN lead_id=1855 user_id=1 ===
Modo: DRY-RUN
Lead ATV actual: id=1855 nombre='Miguel Calderon'
  merge_winner ref: 1429fc42… nombre='Miguel Arango'
  merge_absorbed ref: 130c030b… nombre='Miguel Calderon'

Plan:
  1. 'Miguel Calderon' → merge_winner en lead 1855 (coincide con ATV)
  2. 'Miguel Arango' → lead NUEVO + legacy_lead_ref rol=new
  3. Reasignar pagos de 'Miguel Arango' colgando del lead 1855

Pagos en lead 1855: 1
  → reasignar pago id=509 monto=5.0 fecha=2026-07-29 concepto='Fee'
    legacy_id=004c559e-b5c2-4a70-a730-24c20b5e7dd1
```

**Aplicar (solo cuando operador apruebe):**

```powershell
python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --yes
```

Post-apply: correr `scripts/validate_legacy_juano.py --user-id 1` y verificar Cash Collected / lead 1855 en UI.

---

## 4. Los 5 casos OK — no tocar

1663, 1313, 1578, 1469, 1714: nombre corto contenido en el largo (diminutivo / nombre incompleto). Absorción correcta.

| Lead | Ejemplo tokens |
|------|----------------|
| 1663 | {montse, payan} ⊂ {montserrat, payan, leon, bonilla} |
| 1313 | {david, arevalo} ⊂ {david, esteban, arevalo, fajardo} |
| 1578 | {jackson, moncada} ⊂ {jackson, ricardo, moncada, sanchez} |
| 1469 | {cristian, rios} ⊂ {cristian, rios, ortiz} |
| 1714 | {jose, david} ⊂ {jose, david, sevilla} |

1663 confirmado externamente: **Montserrat Payan Leon Bonilla** en `data/legacy/cuotas.csv`.

---

## 5. Regla preventiva (implementada en código)

**Archivo:** `backend/src/services/legacy_juano_import.py`

1. **`name_tokens()` / `mismo_nombre()`** — tokens lowercase sin tildes; conectores filtrados (`y`, `and`, `de`, `del`, `la`, `los`, `las`, `e`, `o`). Uno ⊆ otro → misma persona.
2. **`pick_collision_winner()`** — si una fila coincide por tokens con nombre ATV → gana esa (`coincide_nombre_atv`).
3. **`resolve_merge_collisions()`** — si perdedora no `mismo_nombre` con ganadora → `action='create'` (lead nuevo), `colision_rechazada_por_apellido=True`, no absorb.

Esto evitaría repetir 1855 en futuros imports; 1307 quedaría como dos leads separados.

---

## 6. Tabla de acciones

| # | Acción | Estado |
|---|--------|--------|
| 1 | Payloads 1307 y 1855 | ✅ este doc |
| 2 | Script reversión 1855 + `--dry-run` | ✅ hecho; **no aplicado en real** |
| 3 | Decidir 1307 | ⏳ espera Claude / operador |
| 4 | Regla tokens + desempate ATV | ✅ implementada |
| 5 | 1663, 1313, 1578, 1469, 1714 | ✅ no tocar |
| 6 | Aplicar reversión 1855 (`--yes`) | ✅ **aplicado** — lead nuevo **6989**, pago 509 reasignado |
| 7 | 1307 — no revertir | ✅ decidido |
| 8 | Auditoría ventas (§3) | ✅ ver `docs/CLAUDE_AUDITORIA_VENTAS_JUANO.md` |
| 9 | Verificación pagos Jhoan (§4) | ✅ ver doc auditoría |

---

## 7. Referencias

| Recurso | Ubicación |
|---------|-----------|
| Decisión humana original | `Desktop/decision-colisiones-dudosas.md` |
| Import completado | `docs/MIGRACION_JUANO.md` |
| Auditoría similitud | `scripts/audit_collision_pairs.py` |
| Reversión colisión | `scripts/revert_collision_absorption.py` |
| Validación post-cambios | `scripts/validate_legacy_juano.py` |
| Rollback nuclear | branch Neon `pre-migracion-juano-2026-08-09` o `scripts/rollback_legacy_juano.py` |

---

## 8. SQL útil (Neon)

```sql
-- Payloads de una colisión
SELECT rol, legacy_id, motivo, payload
FROM legacy_lead_ref
WHERE user_id = 1 AND lead_id = 1307  -- o 1855
ORDER BY rol;

-- Pagos de un lead
SELECT id, monto, fecha, concepto, nota, legacy_id, legacy_meta
FROM lead_payment
WHERE lead_id = 1855
ORDER BY fecha;
```
