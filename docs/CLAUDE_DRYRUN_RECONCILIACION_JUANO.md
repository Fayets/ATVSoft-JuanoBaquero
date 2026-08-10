# Handoff — Dry-run reconciliación 24 huérfanos

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único.**

**Audiencia:** Claude (revisión y go/no-go). **Ejecución:** Cursor + operador humano.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Fecha:** 2026-08-09  
**Origen:** `Desktop/go-reconciliacion-huerfanos.md`  
**Estado:** Fix matcheo implementado · script creado · **dry-run hecho · `--yes` NO aplicado**

> Claude **no ejecuta** comandos. Aprueba casos REVISIÓN; Cursor ejecuta `--yes`.

---

## 0. Resumen ejecutivo

| Métrica | Valor |
|---------|------:|
| Huérfanos totales | 24 |
| USD en huérfanos | 17.748,50 |
| AUTO (aplicar con `--yes` solo) | **7** casos · **7** pagos |
| REVISIÓN (espera aprobación caso a caso) | **12** |
| REVISIÓN MANUAL (bloqueados) | **1** (6965) |
| SIN MATCH (quedan como lead + `lead_huerfano`) | **4** |
| USD control dry-run | **257.309,99** antes = después ✅ |

**Criterio de control post-apply:** USD debe seguir en **257.309,99** exacto.

---

## 1. Qué se implementó en esta ejecución

### 1.1 Fix preventivo — `backend/src/services/legacy_juano_import.py`

Cadena de matcheo antes de crear lead huérfano en `import_pagos`:

1. Teléfono normalizado (dígitos completos)
2. Teléfono últimos 10 dígitos (`tel10`)
3. Email
4. Nombre + fecha pago ±30 días de `agendo`/`call`/`fecha_bot`/`created_at`
5. Nombre exacto normalizado
6. Nombre por tokens (`mismo_nombre`)

Si todo falla → lead nuevo con `legacy_meta.lead_huerfano = true`.

Nuevas piezas: `PaymentLeadMatch`, `resolve_lead_for_payment()`, `PAYMENT_MATCH_DATE_WINDOW_DAYS = 30`, `IdentityIndex.build_from_leads()`.

### 1.2 Script — `scripts/reconcile_pago_huerfanos.py`

```powershell
cd backend
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --dry-run
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6968,6982,6967
python ../scripts/validate_legacy_juano.py --user-id 1
```

**Guardrails aplicados en script:**

| Señal | Acción dry-run |
|-------|----------------|
| Tel / email | AUTO |
| Pre-aprobados 6969→1307, 6972→1313 | AUTO |
| Nombre+fecha / tokens | REVISIÓN |
| Tel match pero destino ya tiene pagos | REVISIÓN (verificar duplicado) |
| 6965 (dos nombres, $3.076) | REVISIÓN MANUAL — bloqueado |
| Sin match | SIN MATCH — marcar `lead_huerfano` |
| Tokens incompatibles | REVISIÓN — no auto |

Huérfanos vaciados: **no se borran** — `legacy_meta.merged_into = <target_id>`, `status = merged`.

**Backup 1307/1313:** al aplicar, `apply_backup_state()` + producto gana el pago (1307: Premium 6 meses del pago 425, no EXPRESS del payload).

---

## 2. Output dry-run completo

```
RECONCILIACIÓN — DRY RUN

AUTO (teléfono/email/pre-aprobado) : 7 casos
  6972 David Esteban Arevalo Fajardo → 1313 David Arevalo  aprobado  1 pago  $1500.00
    · id=453 legacy=50ac6c00… $1500.00 2026-07-22 PIF
  6979 David Santiago Mosquera Sabogal → 1837 David Mosquera  [tel 3124344022]  1 pago  $1500.00
    · id=527 legacy=3c2f66f1… $1500.00 2026-07-30 PIF
  6983 Juliana Gallo Giraldo → 1625 Juliana Gallo  [tel 3005721999]  1 pago  $1500.00
    · id=557 legacy=cced9ab9… $1500.00 2026-08-03 PIF
  6974 Julieth Lorena Cortés Henao → 1457 Julieth Lorena Cortes  [tel 3102328156]  1 pago  $312.00
    · id=467 legacy=8e4b9b51… $312.00 2026-07-25 1ra Cuota
  6969 Jhoan y Anthuan → 1307 Jhoan Galvis  pre-aprobado  1 pago  $150.00
    · id=425 legacy=ff612157… $150.00 2026-07-16 PIF
  6985 Camilo Alberto Garzon → 1675 Camilo Garzón  [tel 3177952242]  1 pago  $64.00
    · id=582 legacy=53be25e2… $64.00 2026-08-08 Fee
  6984 Maria Camila Valencia → 2413 Camila valencia  [tel 3173603223]  1 pago  $63.00
    · id=565 legacy=7603c83f… $63.00 2026-08-05 Fee

REVISIÓN (nombre+fecha/tokens/destino con pagos) : 12 casos
  6976 Catalina Andrea Kroll López → 1539 Catalina  [nombre_fecha]  $1500.00
  6977 Edgar René Inamagua alvacora → ambiguo (3 candidatos)  $1500.00
  6964 Jorge Luis Banol Duran → ambiguo (3 candidatos)  $1168.00
  6970 Ryan → 6342 Ryan butler  [nombre_fecha]  2 pagos  $1000.00
  6982 Yeison Vargas → 1645 Yeison Vargas perez  [nombre_fecha]  $1000.00
  6967 Kamilo Guayra → 6278 Kamilo Guayara  [tel10, destino ya tiene 2 pagos]  $600.00
  6968 Stiven Echavarria Zuleta → 1275 Stiven Echavarria  [tel10, destino ya tiene 1 pago]  $463.00
  6981 David Santiago Arias Cruz → 2007 David Santiago Arias Cruz  [tel10, destino 2 pagos]  $350.00
  6966 Jhon Fredy orozco → 6161 Jhon Fredy Orozco Norena  [tel10, destino 1 pago]  $100.00
  6962 Santiago Rodriguez → 6344 Santiago  [nombre_fecha]  2 pagos  $78.50
  6973 Sebastian Mosquera → ambiguo (2 candidatos)  $50.00
  6963 Bryan Muñoz → 6136 Brayan Muñoz  [tel10, destino 1 pago]  $30.00

REVISIÓN MANUAL (bloqueados) : 1 caso
  6965 Brayan Rengifo Rojas / Dylan Rengifo Rojas  $3076.00

SIN MATCH (quedan como lead) : 4 casos
  6980 Leidy Marcela Zuluaga  3 pagos  $1415.00
  6971 Fabián Alexander Vasquez Vegas  $150.00
  6978 Gabriel Ortega  $99.00
  6975 Jesus gonzales  $80.00

CONTROL
  USD antes  : 257309.99
  USD después: 257309.99
  Pagos movidos (si --yes AUTO): 7
  Huérfanos vaciados: 7
```

---

## 3. Casos destacados para decisión Claude

### 3.1 Pre-aprobados (van en AUTO)

| Huérfano | → Destino | Pago | Notas |
|---------:|-----------|------|-------|
| **6969** Jhoan y Anthuan | **1307** Jhoan Galvis | 425 · $150 PIF | Backup: status Venta + producto **Premium 6 meses** (gana pago). ⚠️ $150 PIF vs lista ~$1.200 — anotar al cliente, no corregir |
| **6972** David Esteban Arevalo Fajardo | **1313** David Arevalo | 453 · $1.500 PIF | Colisión nombres OK; solo desconectaba pago |

### 3.2 Matches probables del GO — verificados en dry-run

| Huérfano | Destino dry-run | Tier | Evidencia |
|---------:|-----------------|------|-----------|
| 6983 Juliana Gallo Giraldo | 1625 Juliana Gallo | **AUTO** | tel 3005721999 · colisión nombre corto/largo |
| 6982 Yeison Vargas | 1645 Yeison Vargas perez | **REVISIÓN** | sin tel · nombre+fecha |
| 6967 Kamilo Guayra | 6278 Kamilo Guayara | **REVISIÓN** | tel · destino ya 2 pagos (cuotas) |
| 6968 Stiven Echavarria Zuleta | 1275 Stiven Echavarria | **REVISIÓN** | tel · destino ya 1 pago |

**6968 — detalle pagos (no duplicado por legacy_id/fecha/monto):**

| | Huérfano 6968 | Destino 1275 existente |
|--|---------------|------------------------|
| legacy_id | `3989e140-3b53-4ad0-a606-c56d77649653` | `f6258858-4715-4707-908f-fc71286785b8` |
| monto | $463 PIF | $837 PIF |
| fecha | 2026-07-15 | 2026-07-24 |

→ Probablemente 2 pagos reales; requiere OK humano antes de `--include-review 6968`.

### 3.3 Ambiguos — necesitan decisión manual

| Huérfano | Candidatos | USD |
|---------:|------------|----:|
| 6977 Edgar René Inamagua alvacora | 3 | 1.500 |
| 6964 Jorge Luis Banol Duran | 3 | 1.168 |
| 6973 Sebastian Mosquera | 2 | 50 |

### 3.4 Bloqueado

**6965** — "Brayan Rengifo Rojas / Dylan Rengifo Rojas" · $3.076 · patrón Jhoan y Anthuan · **no auto**.

### 3.5 Sin match — personas solo en pagos.csv

6980 ($1.415), 6971 ($150), 6978 ($99), 6975 ($80) — dejar como lead propio auditado.

---

## 4. Secuencia aprobada — estado

| # | Acción | Estado |
|---|--------|--------|
| 1 | Fix matcheo import pagos | ✅ |
| 2 | `reconcile_pago_huerfanos.py --dry-run` | ✅ |
| 3 | **PARAR** — output a Claude | ✅ este doc |
| 4 | Claude aprueba IDs REVISIÓN | ⏳ |
| 5 | `--yes` AUTO (+ `--include-review` aprobados) | ⏳ |
| 6 | Política backup 1307/1313 (en script apply) | ⏳ con paso 5 |
| 7 | `validate_legacy_juano.py` → 257.309,99 | ⏳ |

---

## 5. Comandos pendientes (post-aprobación)

```powershell
# Paso 1: solo AUTO (7 casos)
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes

# Paso 2: agregar REVISIÓN aprobados (ejemplo)
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6968,6982,6967,6976

# Validación obligatoria
python ../scripts/validate_legacy_juano.py --user-id 1
```

**Si USD ≠ 257.309,99 → abortar / rollback branch Neon `pre-migracion-juano-2026-08-09`.**

---

## 6. Contexto previo (ya hecho)

- Import real completado · ancla USD validada
- Reversión colisión **1855** aplicada (lead **6989** Miguel Arango, pago 509)
- Lead **1307** — no revertir colisión (misma persona, backup post-llamada)
- Regla tokens + desempate ATV en colisiones leads.csv

---

## 7. Referencias

| Recurso | Ruta |
|---------|------|
| GO humano | `Desktop/go-reconciliacion-huerfanos.md` |
| Huérfanos alcance | `docs/CLAUDE_HUERFANOS_RECONCILIACION_JUANO.md` |
| Auditoría ventas | `docs/CLAUDE_AUDITORIA_VENTAS_JUANO.md` |
| Colisiones | `docs/CLAUDE_COLISIONES_DUDOSAS_JUANO.md` |
| Migración | `docs/MIGRACION_JUANO.md` |
| Audit conteo | `scripts/audit_pago_huerfanos.py` |
| Reconciliar | `scripts/reconcile_pago_huerfanos.py` |

---

## 8. Post-cierre migración (no urgente)

| Pendiente | Decisión |
|-----------|----------|
| 74 `posible_dup` por nombre | Dejar |
| 60 `match_ambiguo` | Dejar |
| 4 `duplicado_probable` cuotas | Revisar con cliente |
| 43 status GHL desactualizado | **No tocar** — preexistente |
| Congelamiento CRM viejo | Conversación cliente |

Con reconciliación aplicada + verificación dashboard → **migración cerrada**.
