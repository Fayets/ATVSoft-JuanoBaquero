# Handoff — Cierre migración juano

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — usar ese documento único.**

**Audiencia:** Claude + operador · **Fecha:** 2026-08-09  
**Origen:** `Desktop/decision-final-cierre-migracion.md`  
**Estado:** **MIGRACIÓN CERRADA (técnica)** · UI pendiente operador

---

## 0. Resumen ejecutivo

| Métrica | Valor |
|---------|------:|
| Ancla USD | **257.309,99** ✅ |
| Julio USD | **163.195,80** ✅ |
| Pagos importados | 357 |
| `legacy_lead_ref` | 2488 |
| Huérfanos reconciliados | **15 / 24** |
| Huérfanos restantes (auditables) | **9** |
| `validate_legacy_juano.py` | **exit 0** ✅ |

**Pendiente único bloqueante humano:** verificación dashboard ATV (§4).

---

## 1. Pasada 2 — aplicada ✅

```powershell
python ../scripts/reconcile_pago_huerfanos.py --user-id 1 --yes --include-review 6976 --force 6977:1838 --finalize
python ../scripts/validate_legacy_juano.py --user-id 1
```

| Control | Resultado |
|---------|-----------|
| Pagos movidos | **2** (6976 → 1539, 6977 → 1838) |
| USD antes / después | 257.309,99 / 257.309,99 ✅ |
| `lead_huerfano` marcados (--finalize) | 5 adicionales |

**6977:** match por **nombre + fecha** (Δcall=0d), **no** por teléfono (`6127565808` ≠ `+16124080049`). Queda registrado.

**1838 vs 2111:** probable duplicado GHL del mismo Edgar — **no fusionar ahora**; lista cliente.

---

## 2. Estado final 24 huérfanos

| Categoría | Cant. | USD | IDs |
|-----------|------:|----:|-----|
| Reconciliados pasada 1 | 13 | 7.632 | ver `CLAUDE_RECONCILIACION_PASADA1_JUANO.md` |
| Reconciliados pasada 2 | 2 | 3.000 | 6976→1539, 6977→1838 |
| **Total reconciliado** | **15** | **10.632** | |
| Leads legítimos (solo pagos.csv) | 4 | 1.744 | 6980, 6971, 6978, 6975 |
| Sin evidencia suficiente | 4 | 2.296,50 | 6970, 6962, 6964, 6973 |
| Bloqueado cliente | 1 | 3.076 | **6965** Brayan/Dylan |

Los 9 restantes: `legacy_meta.lead_huerfano = true`, pagos intactos, **ningún centavo perdido**.

---

## 3. NO aplicados (confirmado)

| ID | USD | Razón |
|----|----:|-------|
| 6970 Ryan | 1.000 | Δ 36–41d vs call destino |
| 6962 Santiago Rodriguez | 78,50 | Δ 21–50d |
| 6964 Jorge Luis Banol Duran | 1.168 | 3× "Jorge", tel distintos |
| 6973 Sebastian Mosquera | 50 | tel distintos, nombre genérico |
| 6965 Brayan/Dylan | 3.076 | dos nombres — revisión cliente |

---

## 4. Checklist UI (solo operador)

- [ ] Cash Collected → **$257.309,99**
- [ ] Cash Collected julio → **$163.195,80**
- [ ] Filtro **abril/mayo 2026** → leads históricos visibles
- [ ] **Jhoan Galvis** (1307): un lead, Cerrado, pago $150

---

## 5. Lista para el cliente (no corregimos a propósito)

| Caso | Pregunta |
|------|----------|
| **6965** Brayan/Dylan ($3.076) | ¿Hermanos que compraron juntos o error de carga? |
| **Edgar** leads 1838 + 2111 | ¿Fusionar duplicado GHL? |
| **Kamilo Guayara** | Sobrepago cuotas; pago huérfano $600 relacionado |
| **Juan Hernandez** (cuotas) | Duplicado 375 vs 1.500 — ¿cuál vale? |
| **Dania Sanchez** (cuotas) | Duplicado programa/closer distinto |
| **Jhoan Galvis** | $150 PIF etiquetado Premium 6 meses (~$1.200 lista) |
| **39 pagos sin producto** | ¿Clasificar Sin especificar/Otro? |
| **CRM viejo activo** | Fecha de corte / import incremental |

---

## 6. Sin tocar (a propósito)

| Pendiente | Por qué |
|-----------|---------|
| 74 `posible_dup` | Detectables; fusionar mal es peor |
| 60 `match_ambiguo` | Ídem |
| 43 status GHL desactualizado | Preexistente, no migración |
| Métricas Cierres/Revenue CRM viejo | Close rate 129,9% imposible; ATV fórmula propia |

---

## 7. Timeline técnico completo

1. Import real 2488 leads + 357 pagos ✅
2. Reversión colisión 1855 ✅
3. Reconciliación huérfanos pasada 1 (13) ✅
4. Reconciliación pasada 2 (2) ✅
5. Validación final exit 0 ✅

---

## 8. Referencias

| Doc | Contenido |
|-----|-----------|
| `docs/MIGRACION_JUANO.md` | Doc maestro actualizado |
| `docs/CLAUDE_DRYRUN_RECONCILIACION_JUANO.md` | Dry-run inicial |
| `docs/CLAUDE_RECONCILIACION_PASADA1_JUANO.md` | Pasada 1 |
| `scripts/reconcile_pago_huerfanos.py` | Reconciliación |
| `scripts/validate_legacy_juano.py` | Control ancla |

**Rollback nuclear:** branch Neon `pre-migracion-juano-2026-08-09`
