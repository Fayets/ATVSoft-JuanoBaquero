# Handoff — Reconciliación pasada 1 (13/24 huérfanos)

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único.**

**Audiencia:** Claude · **Fecha:** 2026-08-09  
**Origen:** `Desktop/aprobacion-revision-huerfanos.md`  
**Estado:** **13 reconciliados aplicados** · validación OK · **11 pendientes**

---

## 0. Resumen ejecutivo

| Métrica | Valor |
|---------|------:|
| Aplicado (AUTO 7 + REVISIÓN 6) | **13** huérfanos · **13** pagos movidos |
| USD antes / después | **257.309,99** / **257.309,99** ✅ |
| `validate_legacy_juano.py` | **exit 0** ✅ |
| Huérfanos activos restantes | **11** (24 total − 13 `merged_into`) |
| Bloqueado manual | **6965** ($3.076) |

**Comando ejecutado:**

```powershell
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6982,6967,6968,6981,6966,6963
python ../scripts/validate_legacy_juano.py --user-id 1
```

---

## 1. Verificación casos clave post-apply

| Lead | status | producto | pagos | cierre meta | backup_reconciliado |
|------|--------|----------|------:|-------------|---------------------|
| **1307** Jhoan Galvis | Cerrado | Premium 6 meses | 1 ($150 PIF) | Sí | ✅ |
| **1313** David Arevalo | Cerrado | Premium 6 meses | 1 ($1.500 PIF) | Sí | ✅ |

Huérfanos vaciados: `legacy_meta.merged_into = <target>`, `status = merged` (no borrados).

---

## 2. Los 13 aplicados en esta pasada

### AUTO (7)

| Huérfano | → Destino | USD |
|---------:|-----------|----:|
| 6972 | 1313 David Arevalo | 1.500 |
| 6979 | 1837 David Mosquera | 1.500 |
| 6983 | 1625 Juliana Gallo | 1.500 |
| 6974 | 1457 Julieth Lorena Cortes | 312 |
| 6969 | 1307 Jhoan Galvis | 150 |
| 6985 | 1675 Camilo Garzón | 64 |
| 6984 | 2413 Camila valencia | 63 |

### REVISIÓN aprobados (6)

| Huérfano | → Destino | USD | Nota |
|---------:|-----------|----:|------|
| 6982 | 1645 Yeison Vargas perez | 1.000 | colisión nombres |
| 6967 | 6278 Kamilo Guayara | 600 | ⚠️ sobrepago cuotas — no corregir |
| 6968 | 1275 Stiven Echavarria | 463 | 2 pagos distintos ($463 + $837) |
| 6981 | 2007 David Santiago Arias Cruz | 350 | nombre idéntico + tel |
| 6966 | 6161 Jhon Fredy Orozco Norena | 100 | tel + tokens |
| 6963 | 6136 Brayan Muñoz | 30 | Bryan/Brayan + tel |

---

## 3. Filtro ±7 días — nombres genéricos (6976, 6970, 6962)

| Huérfano | → Destino | Resultado | Detalle |
|---------:|-----------|-----------|---------|
| **6976** Catalina Andrea Kroll López | 1539 Catalina | **✅ PASA** | pago 29/07 · Δagendo=3d · Δcall=2d · destino call 27/07 |
| **6970** Ryan | 6342 Ryan butler | **❌ NO PASA** | pagos 16/07 y 21/07 · destino call **10/06** (36–41d) |
| **6962** Santiago Rodriguez | 6344 Santiago | **❌ NO PASA** | pagos 01/07 y 30/07 · destino call **10/06** (21–50d) |

**Recomendación Claude:** incluir **6976** en próximo `--include-review 6976`. Dejar **6970** y **6962** sin aplicar (timing incompatible).

---

## 4. Candidatos ambiguos — detalle para decisión

### 6977 Edgar René Inamagua alvacora — $1.500 PIF 2026-07-29

Huérfano tel: **6127565808**

| lead_id | nombre | teléfono | email | call | Δcall | pagos |
|--------:|--------|----------|-------|------|------:|------:|
| **1838** | Edgar René Inamagua | +16124080049 | sinche16@gmail.com | 2026-07-29 15:15 | **0d** | 0 |
| **2111** | Edgar René Inamagua | — | — | 2026-07-28 10:15 | 1d | 0 |
| 1302 | Edgar | +528124178844 | ev996347@gmail.com | 2026-07-16 | 13d | 0 |

→ **Candidato fuerte: 1838** (nombre completo + call mismo día). 2111 posible duplicado GHL.

### 6964 Jorge Luis Banol Duran — $1.168 PIF 2026-07-06

| lead_id | nombre | teléfono | email | call | Δcall | pagos |
|--------:|--------|----------|-------|------|------:|------:|
| 6439 | jorge | 573205381335 | jo0rge@hotmail.es | 2026-06-16 | 20d | 0 |
| 6528 | Jorge | 573043810920 | jtabordafr@… | 2026-06-21 | 15d | 0 |
| 1669 | Jorge | +573108366028 | rinconmontejo17@… | 2026-07-28 | 22d | 0 |

→ **Ninguno convence** — solo nombre de pila, fechas lejanas al pago (06/07). **Dejar sin aplicar** o pedir dato al cliente.

### 6973 Sebastian Mosquera — $50 1ra Cuota 2026-07-25

| lead_id | nombre | teléfono | email | call | Δcall | pagos |
|--------:|--------|----------|-------|------|------:|------:|
| 1192 | Sebastian | +13653235887 | snieto@utp.edu.co | 2026-07-11 | 14d | 0 |
| **1858** | Sebastian | +573246855285 | aguilargiraldo102@… | 2026-07-29 | **4d** | 0 |

→ **1858** mejor timing. **No es 1837 David Mosquera** (6979 ya reconciliado a 1837 — personas distintas ✅).

---

## 5. SIN MATCH — `lead_huerfano` confirmado ✅

| lead_id | nombre | pagos | USD | lead_huerfano |
|--------:|--------|------:|----:|:--------------:|
| 6980 | Leidy Marcela Zuluaga | 3 | 1.415 | ✅ true |
| 6971 | Fabián Alexander Vasquez Vegas | 1 | 150 | ✅ true |
| 6978 | Gabriel Ortega | 1 | 99 | ✅ true |
| 6975 | Jesus gonzales | 1 | 80 | ✅ true |

---

## 6. Pendientes pasada 2 (11 activos)

| ID | Categoría | Acción sugerida |
|----|-----------|-----------------|
| **6976** | Condicionado | ✅ PASA ±7d → `--include-review 6976` |
| **6970** | Condicionado | ❌ NO PASA → dejar |
| **6962** | Condicionado | ❌ NO PASA → dejar |
| **6977** | Ambiguo | Probable **1838** — confirmar |
| **6964** | Ambiguo | Sin candidato claro — revisión cliente |
| **6973** | Ambiguo | Probable **1858** — confirmar |
| **6965** | Manual | Bloqueado — hermanos/error carga |
| 6980, 6971, 6978, 6975 | Sin match | Legítimos auditables |

---

## 7. Comandos pasada 2 (cuando aprueben)

```powershell
# Ejemplo si aprueban 6976 + 6977→1838 + 6973→1858 (requiere override manual en script o --include-review con destino fijo)
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6976
python ../scripts/validate_legacy_juano.py --user-id 1
```

*(6977 y 6973 son ambiguos — pueden necesitar override explícito en script si el match sigue siendo `nombre_fecha_ambiguo`.)*

---

## 8. Referencias

| Recurso | Ruta |
|---------|------|
| Aprobación humana | `Desktop/aprobacion-revision-huerfanos.md` |
| Dry-run previo | `docs/CLAUDE_DRYRUN_RECONCILIACION_JUANO.md` |
| Reporte pending | `scripts/report_huerfanos_pending.py` |
| Reconciliar | `scripts/reconcile_pago_huerfanos.py` |
| Validar | `scripts/validate_legacy_juano.py` |

---

## 9. Notas cliente (no corregir datos)

- **1307:** $150 PIF etiquetado Premium 6 meses — anotar inconsistencia
- **6967:** Kamilo Guayara sobrepago cuotas — posible explicación del $600 huérfano
- **6965:** Brayan/Dylan $3.076 — preguntar si compra conjunta o error
