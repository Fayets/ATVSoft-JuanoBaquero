## Backfill links Fathom — APLICADO 2026-08-11

Branch respaldo Neon: **`pre-backfill-links-2026-08-11`**

### Resultado

```
BACKFILL LINKS FATHOM — APLICADO

CSV                             : 390 filas
  ├─ URLs válidas               : 346
  └─ texto libre descartado     :  44

URLs válidas — desglose:
  ├─ escritas (campo vacío)     : 341   (leads distintos)
  ├─ mismo link ya presente     :   3
  ├─ link distinto (no se pisa) :   2   → leads 1542, 2533
  ├─ comparte lead (merge CSV)  :   0
  └─ sin match legacy_lead_ref  :   0

Secundarias (2 URLs en celda)     : 5   → legacy_meta.link_llamada_secundario
URLs duplicadas entre leads       : 5   → call_report UNIQUE al conectar Claude
Escrituras aplicadas              : 341

Leads con link_llamada: 12 → 353
Idempotencia (2.ª dry-run)        : 0 escrituras
```

### Verificación SQL

| Check | Esperado | Obtenido |
|---|---:|---:|
| `leads_con_link` | ~342 (dry-run viejo) / **353** (real) | **353** |
| Pagos legacy | 362 / $265.526,99 | **362 / $265.526,99** ✅ |
| Leads con audit `backfill_links_fathom` | ~330+ | **343** |
| `link_llamada_secundario` | 5 | **5** ✅ |

**Anclas intactas.** Diferencia vs proyección dry-run inicial (342): el apply escribió **341** links (vs 330 proyectados) porque el desglose por lead ganador matcheó más refs vacíos; total **12 + 341 = 353**.

### Conflictos (no sobrescritos)

| lead_id | legacy_id | Notas |
|---:|---|---|
| 1542 | `d082759e…` | Link manual ATV ≠ CSV legacy |
| 2533 | `9e6cc26c…` | Link manual ATV ≠ CSV legacy |

Valores CSV guardados en `legacy_meta.link_llamada_legacy`.

### URLs secundarias (5 celdas con 2 links)

| lead_id | legacy_id |
|---:|---|
| 5980 | `527b9f07…` |
| 6108 | `c9ef78f8…` |
| 6112 | `c1a033e8…` |
| 6161 | `9141ad1a…` |
| 5876 | `ae6edc84…` |

### URLs duplicadas (mismo link, 2 legacy_ids)

- `_hzWss8jFzpzp5K…` → `46922ae8`, `9e6cc26c`
- `zxhAxvCYnQT1_F5B…` → `48ff6b0f`, `5013f3b9`
- `s3rxxTX4vyPe9G8…` → `56e66ba1`, `926aa861`
- `QAGz2RzMwdaWi-Fb…` → `7f325997`, `eda388c9`
- `fG_TxjpsTy56dds…` → `92469707`, `981556af`

### Comandos

```bash
cd backend
python ../scripts/backfill_links_fathom.py --user-id 1 --yes
python ../scripts/backfill_links_fathom.py --user-id 1 --dry-run
python ../scripts/verify_backfill_links.py
```

### Pendiente

- Conectar **API key Claude** en Conexiones → re-procesar `call_report` (12 en error hoy + futuros links).
- Los 5 pares duplicados: solo uno podrá tener análisis Fathom por constraint UNIQUE.

---

*Generado: 2026-08-11 · tenant user_id=1 · `backfill_links_fathom.py`*
