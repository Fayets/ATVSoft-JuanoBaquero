# Handoff — Auditoría ventas no reflejadas + reversión 1855

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único.**

**Audiencia:** Claude · **Fecha:** 2026-08-09  
**Origen:** `Desktop/decision-1307-auditoria-ventas.md`  
**Script:** `scripts/audit_ventas_legacy.py`

> **No se aplicó reconciliación de estados** — solo reporte.

---

## 1. Reversión 1855 — APLICADA ✅

```powershell
python ../scripts/revert_collision_absorption.py --user-id 1 --lead-id 1855 --yes
python ../scripts/validate_legacy_juano.py --user-id 1
```

**Resultado:**

| Elemento | Antes | Después |
|----------|-------|---------|
| Lead 1855 | Miguel Calderon (datos de Arango) | **Miguel Calderon** — `merge_winner` ref `130c030b…` |
| Miguel Arango | absorbido en 1855 | **Lead nuevo id=6989**, ref `1429fc42…` rol=`new` |
| Pago 509 ($5 Fee) | lead 1855 | **lead 6989** (Miguel Arango) |

**Validación:** exit 0 · USD **257.309,99** intacto · `legacy_lead_ref` = **2488** (merge_absorbed **29**, new **1131**).

---

## 2. Lead 1307 — NO revertir (decidido)

Absorción correcta: misma persona, mismo tel, misma fecha_llamada; fila backup = resultado post-llamada.

---

## 3. Auditoría Q2 — conteo por origen

| origen | total refs | con `cierre = Sí` |
|--------|----------:|------------------:|
| *(vacío)* | 2430 | 212 |
| GHL calendario - backfill Thomas 2026-07-19 | 47 | 4 |
| **recuperado backup 2026-07-19** | **11** | **11** |

---

## 4. Subgrupo backup (11 leads, todos `cierre = Sí`)

| lead_id | nombre ATV | status ATV | pagos ATV | rol ref | ¿OK? |
|--------:|------------|------------|----------:|---------|------|
| 1146 | Edwuin Garmendy loaiza | Cerrado | 1 | merge_winner | ✅ |
| 1154 | Jeniffer Yulieth Barrera Muñoz | Cerrado | 1 | merge_winner | ✅ |
| 1219 | Anderson Hernandez Bermudez | Cerrado | 1 | merge_winner | ✅ |
| 1254 | Cristian Rafael Delgado Villamizar | Cerrado | 1 | merge_winner | ✅ |
| 1269 | Carlos Rodríguez | Cerrado | 1 | merge_winner | ✅ |
| 1274 | Gustavo Betancourt | Cerrado | 2 | merge_winner | ✅ |
| 1275 | Stiven Echavarria | Cerrado | 1 | merge_winner | ✅ |
| 1293 | Estefania Acevedo | Cerrado | 1 | merge_winner | ✅ |
| 1295 | Kevin Gilberto Vargas Gómez | Cerrado | 1 | merge_winner | ✅ |
| **1307** | **Jhoan Galvis** | **Agendado** | **0** | merge_absorbed | 🔴 |
| **1313** | **David Arevalo** | **Agendado** | **0** | merge_winner | 🔴 |

**9/11 backup OK.** Solo **2** con venta legacy sin reflejar en el lead mergeado.

---

## 5. Verificación pagos Jhoan (§4)

`lead_payment` **no tiene columna `cliente`** — búsqueda por nota/meta no encontró nada.

**Pero el pago SÍ existe** en ATV, en un **lead huérfano** creado por import de pagos:

| Campo | Valor |
|-------|-------|
| pago id | **425** |
| legacy_id | `ff612157-913b-4f5f-ad1a-1fe30ad828ee` |
| cliente pagos.csv | **Jhoan y Anthuan** |
| monto | **$150** PIF |
| producto | Premium 6 meses |
| lead_id | **6969** (nombre `Jhoan y Anthuan`, sin email/tel, source=`legacy_juano`) |

**Lead 1307** (Jhoan Galvis): 0 pagos, status Agendado.  
**Lead 6969**: 1 pago $150, status Cerrado.

→ La venta es real, pero **desconectada** del lead mergeado 1307.

**Inconsistencia producto:** payload absorbido en 1307 dice **EXPRESS**; pago dice **Premium 6 meses**.

---

## 6. Patrón idéntico en 1313 (Arevalo)

| Campo | Valor |
|-------|-------|
| Lead mergeado | **1313** David Arevalo — Agendado, 0 pagos |
| Pago legacy | id **453**, $1500 PIF, `50ac6c00…` |
| Lead del pago | **6972** David Esteban Arevalo Fajardo (huérfano) |

1313 estaba en la lista “no tocar” por colisión de nombres, pero comparte el mismo bug de **pago en lead separado**.

---

## 7. Q1 ampliada — legacy `cierre=Sí` sin status Cerrado/Seguimiento

**43 filas** (consulta adaptada: ATV usa `status`/`estado`, no columna `situacion`).

Muchas tienen **pagos en el lead** pero status sigue **Agendado** (GHL no actualizó post-venta). No son necesariamente “ventas perdidas” — es deuda de **status desactualizado**.

Casos backup con **0 pagos en lead mergeado** (accionables): **1307**, **1313**.

---

## 8. Escenario según tabla del doc

| Escenario doc | Realidad |
|---------------|----------|
| Pocos (< 20) manual | **2 leads backup** + posible merge pago→lead |
| Muchos (> 20) script | Q1 amplia = 43, pero mayoría tienen pagos; problema backup = **2** |
| Cero fuera 1307 | **No** — también **1313** |

**Recomendación pendiente Claude:**

1. **1307:** reasignar pago 425 de lead 6969 → 1307; aplicar estado Venta/EXPRESS desde payload absorbido; eliminar o fusionar lead 6969.
2. **1313:** mismo patrón (pago 453, lead 6972) — ¿incluir aunque colisión fuera “OK”?
3. **Política merge backup:** cuando `origen` contiene `recuperado backup` y `cierre=Sí`, **sobrescribir** status/producto aunque ATV tenga valor (excepción a NEVER_TOUCH).
4. **Import pagos:** matchear pagos sin tel a lead existente por nombre+fecha antes de crear lead huérfano.

---

## 9. Estado acciones

| # | Acción | Estado |
|---|--------|--------|
| 1 | Reversión 1855 | ✅ |
| 2 | 1307 no revertir | ✅ |
| 3 | Auditoría §3 | ✅ este doc |
| 4 | Pagos Jhoan §4 | ✅ pago en 6969, no en 1307 |
| 5 | Reconciliación estados | 🛑 **no aplicada — espera decisión** |
