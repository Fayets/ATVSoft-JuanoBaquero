# Handoff — Huérfanos de pagos y reconciliación juano

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único.**

**Audiencia:** Claude (revisión y go/no-go). **Ejecución:** Cursor + operador humano.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Fecha:** 2026-08-09  
**Origen:** `Desktop/decision-huerfanos-reconciliacion.md`  
**Estado previo:** Import completado · reversión 1855 aplicada · auditoría ventas hecha

> Claude **no ejecuta** comandos. Revisa conteo y decisiones; Cursor implementa script + dry-run.

---

## 0. Resumen ejecutivo

La migración **financiera es sólida** (USD **257.309,99**, 357 pagos, idempotencia OK). El problema descubierto es de **atribución**: el import de **pagos** crea leads `source=legacy_juano` **sin** fila en `legacy_lead_ref` cuando no matchea un lead existente.

| Métrica | Valor |
|---------|------:|
| Huérfanos de pagos (medido) | **24** |
| USD en huérfanos | **17.748,50** |
| Escenario doc (§1) | **6–50 → script de reconciliación dirigido** |
| Ancla post-reversión 1855 | **257.309,99** ✅ |
| `legacy_lead_ref` | **2488** (1328 winner + 29 absorbed + 1131 new) |

**Nada de reconciliación aplicado aún** — solo alcance medido. Esperando go para pasos 3–7.

---

## 1. Problema de fondo

Leads **6969** (Jhoan y Anthuan) y **6972** (David Esteban Arevalo Fajardo) no venían de `leads.csv`; los creó el path de **pagos** al fallar el matcheo.

| Aspecto | Efecto |
|---------|--------|
| Ancla financiera | ✅ intacta |
| Atribución | 🔴 pago en lead fantasma |
| Conteo leads | 🔴 +24 duplicados invisibles |
| Vista cliente | 🔴 misma persona: llamada en un lead, pago en otro |

**Identificación SQL** (huérfano = `legacy_juano` sin `legacy_lead_ref`):

```sql
SELECT COUNT(*) AS huerfanos_de_pagos
FROM lead l
WHERE l.user_id = 1
  AND l.source = 'legacy_juano'
  AND NOT EXISTS (
    SELECT 1 FROM legacy_lead_ref r WHERE r.lead_id = l.id
  );
-- Resultado: 24
```

Script: `scripts/audit_pago_huerfanos.py`

---

## 2. Alcance completo — 24 huérfanos (2026-08-09)

| id | nombre | teléfono | status | pagos | USD |
|---:|--------|----------|--------|------:|----:|
| 6965 | Brayan Rengifo Rojas / Dylan Rengifo Rojas | 3106331660 | Cerrado | 1 | 3.076 |
| **6972** | **David Esteban Arevalo Fajardo** | — | Cerrado | 1 | **1.500** |
| 6976 | Catalina Andrea Kroll López | — | Cerrado | 1 | 1.500 |
| 6977 | Edgar René Inamagua alvacora | 6127565808 | Cerrado | 1 | 1.500 |
| 6979 | David Santiago Mosquera Sabogal | 3124344022 | Cerrado | 1 | 1.500 |
| 6983 | Juliana Gallo Giraldo | 3005721999 | Cerrado | 1 | 1.500 |
| 6980 | Leidy Marcela Zuluaga | 573143681984 | Cerrado | 3 | 1.415 |
| 6964 | Jorge Luis Banol Duran | 573167090429 | Cerrado | 1 | 1.168 |
| 6970 | Ryan | 573011461219 | Pendiente | 2 | 1.000 |
| 6982 | Yeison Vargas | — | Cerrado | 1 | 1.000 |
| 6967 | Kamilo Guayra | 3207450008 | Pendiente | 1 | 600 |
| 6968 | Stiven Echavarria Zuleta | stivene544@gmail.com / 3116092491 | Cerrado | 1 | 463 |
| 6981 | David Santiago Arias Cruz (…) | 3173919223 | Pendiente | 1 | 350 |
| 6974 | Julieth Lorena Cortés Henao | 3102328156 | Cerrado | 1 | 312 |
| **6969** | **Jhoan y Anthuan** | — | Cerrado | 1 | **150** |
| 6971 | Fabián Alexander Vasquez Vegas | 51987186303 | Pendiente | 1 | 150 |
| 6966 | Jhon Fredy orozco | 3152953695 | Cerrado | 1 | 100 |
| 6978 | Gabriel Ortega | 573167717440 | Cerrado | 1 | 99 |
| 6975 | Jesus gonzales | — | Cerrado | 1 | 80 |
| 6962 | Santiago Rodriguez | 524779094763 | Cerrado | 2 | 78,50 |
| 6985 | Camilo Alberto Garzon | 3177952242 | Pendiente | 1 | 64 |
| 6984 | Maria Camila Valencia | 3173603223 | Pendiente | 1 | 63 |
| 6973 | Sebastian Mosquera | 573226220357 | Cerrado | 1 | 50 |
| 6963 | Bryan Muñoz | 3185397022 | Pendiente | 1 | 30 |

**Total USD en listado:** 17.748,50 (no altera ancla global).

Patrón: muchos tienen teléfono en el huérfano pero el matcheo actual no los enlazó al lead GHL/mergeado.

---

## 3. Decisiones humanas aprobadas

### 3.1 Lead 1307 — ✅ aprobado (reconciliar, NO revertir colisión)

Colisión absorbida correcta (misma persona). Problema = pago desconectado.

| Acción | Detalle |
|--------|---------|
| Reasignar pago | **425** ($150 PIF) de lead **6969** → lead **1307** |
| Estado | `cierre = Sí`, status → Venta/Cerrado (desde payload absorbido) |
| Producto | **Gana el pago:** Premium 6 meses (no EXPRESS del payload) |
| Huérfano | Eliminar 6969 vacío o `legacy_meta.merged_into = 1307` |

⚠️ **Revisión cliente (no corregir datos):** $150 PIF etiquetado Premium 6 meses (lista ~$1.200) — posible mal etiquetado o PIF parcial.

Payload absorbido (`123eb135…`): Venta, EXPRESS, presento Sí, origen `recuperado backup 2026-07-19`.  
Lead ATV: Jhoan Galvis, Agendado, 0 pagos.

### 3.2 Lead 1313 — ✅ incluir

Mismo tratamiento que 1307. Colisión de nombres (David Arevalo ⊂ David Esteban Arevalo Fajardo) **sigue OK**.

| Acción | Detalle |
|--------|---------|
| Reasignar pago | **453** ($1.500 PIF) de lead **6972** → lead **1313** |
| Estado backup | aplicar desde payload winner backup |

### 3.3 Política merge backup — ✅ acotada a 11 filas

```
SI  origen contiene 'recuperado backup'
Y   cierre = 'Sí'
ENTONCES sobrescribir status/situacion/producto en lead ATV
         guardando pre_import_snapshot
```

**No extender** a las 43 filas de Q1 ampliada (status Agendado con pagos = deuda GHL preexistente).

**11 leads backup** (todos `cierre=Sí` en payload):

| lead_id | status ATV | pagos ATV | Notas |
|--------:|------------|----------:|-------|
| 1146 | Cerrado | 1 | OK |
| 1154 | Cerrado | 1 | OK |
| 1219 | Cerrado | 1 | OK |
| 1254 | Cerrado | 1 | OK |
| 1269 | Cerrado | 1 | OK |
| 1274 | Cerrado | 2 | OK |
| 1275 | Cerrado | 1 | OK |
| 1293 | Cerrado | 1 | OK |
| 1295 | Cerrado | 1 | OK |
| **1307** | Agendado | 0 | 🔴 reconciliar |
| **1313** | Agendado | 0 | 🔴 reconciliar |

### 3.4 Matcheo pagos → lead — ✅ corregir en import + reconciliar existentes

Antes de crear lead huérfano, intentar en orden:

1. Teléfono normalizado (dígitos completos)
2. Teléfono últimos 10 dígitos
3. Email
4. **Nombre + fecha pago ±30 días de `agendo`/`call` del lead**
5. Nombre exacto normalizado

Si todo falla: crear lead con `legacy_meta.lead_huerfano = true`.

**Archivo a modificar:** `backend/src/services/legacy_juano_import.py` (path `import_payments` / resolución lead para pago).

Luego **script de reconciliación** sobre los 24 huérfanos — **no** re-import completo.

---

## 4. Reversión 1855 — hecha (contexto)

| Elemento | Estado |
|----------|--------|
| Lead 1855 | Miguel Calderon, merge_winner ref `130c030b…` |
| Lead 6989 | Miguel Arango (new), pago 509 ($5 Fee) |
| Validación | exit 0, USD intacto |

Script: `scripts/revert_collision_absorption.py`

---

## 5. Orden de ejecución

| # | Acción | Estado |
|---|--------|--------|
| 1 | Consulta alcance huérfanos | ✅ **24** |
| 2 | PARAR — pasar conteo | ✅ |
| 3 | Corregir matcheo pagos (§3.4) | ⏳ pendiente |
| 4 | Script reconciliación `--dry-run` | ⏳ pendiente |
| 5 | Aplicar 1307 + 1313 (+ resto matcheables) | ⏳ pendiente |
| 6 | Política backup 11 filas | ⏳ pendiente |
| 7 | Validar USD = **257.309,99** exacto | ⏳ pendiente |

**Criterio de control:** mover pagos entre leads, **cero cambio de montos**. Un centavo de diferencia = abortar.

```powershell
cd backend
python ../scripts/validate_legacy_juano.py --user-id 1
```

---

## 6. Qué debe hacer Cursor (propuesta técnica)

1. **`reconcile_pago_huerfanos.py`**
   - `--user-id 1 --dry-run` / `--yes`
   - Para cada huérfano: re-ejecutar cadena de matcheo contra leads con `legacy_lead_ref` o GHL
   - Log: `orphan_id → target_lead_id`, pagos movidos, huérfano vaciado/merged_into
   - Casos hardcoded aprobados: 6969→1307 (pago 425), 6972→1313 (pago 453)

2. **Fix preventivo** en import pagos (misma cadena de matcheo + flag `lead_huerfano`)

3. **Backup policy** en merge post-import o paso dedicado:
   - Solo refs con `payload.origen ILIKE '%recuperado backup%'` y `cierre=Sí`
   - `snapshot_lead_if_atv()` antes de sobrescribir

4. **Dry-run obligatorio** — output tabular para Claude antes de `--yes`

---

## 7. SQL útil

```sql
-- Detalle huérfanos
SELECT l.id, l.nombre, l.telefono, l.status,
  (SELECT COUNT(*) FROM lead_payment p WHERE p.lead_id = l.id) AS pagos,
  (SELECT SUM(p.monto) FROM lead_payment p WHERE p.lead_id = l.id) AS usd
FROM lead l
WHERE l.user_id = 1 AND l.source = 'legacy_juano'
  AND NOT EXISTS (SELECT 1 FROM legacy_lead_ref r WHERE r.lead_id = l.id)
ORDER BY usd DESC NULLS LAST;

-- Pagos casos aprobados
SELECT id, lead_id, monto, concepto, producto, legacy_id
FROM lead_payment WHERE id IN (425, 453);

-- Refs backup
SELECT lead_id, rol, payload->>'nombre', payload->>'origen', payload->>'cierre'
FROM legacy_lead_ref
WHERE user_id = 1 AND payload->>'origen' ILIKE '%backup%'
ORDER BY lead_id;
```

---

## 8. Referencias cruzadas

| Doc / script | Contenido |
|--------------|-----------|
| `docs/MIGRACION_JUANO.md` | Import completado, métricas |
| `docs/CLAUDE_COLISIONES_DUDOSAS_JUANO.md` | Colisiones, 1855, tokens |
| `docs/CLAUDE_AUDITORIA_VENTAS_JUANO.md` | Backup 9/11 OK, 1307/1313 |
| `scripts/audit_pago_huerfanos.py` | Conteo 24 huérfanos |
| `scripts/audit_ventas_legacy.py` | Auditoría ventas / backup |
| `scripts/validate_legacy_juano.py` | Control ancla USD |
| `scripts/revert_collision_absorption.py` | Reversión colisión (1855 hecho) |
| Rollback nuclear | branch Neon `pre-migracion-juano-2026-08-09` |

---

## 9. Nota para explicar al cliente

> La migración de montos está validada al centavo. Lo que corregimos es **a qué contacto/leads cuelga cada pago** y el **estado de venta** en filas recuperadas del backup del 19/07 — no estamos re-importando ni cambiando totales de Cash Collected.
