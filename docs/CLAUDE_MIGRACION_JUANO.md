# Migración CRM juano → ATV — documento único para Claude

**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`  
**Estado:** Importador listo · **bloqueado por CSV faltantes** · dry-run pendiente · **NO ejecutar carga real** sin snapshot Neon  
**Fecha:** 2026-08-09

---

## 1. Objetivo

Migrar datos históricos del CRM Supabase (schema `juano`) al sistema ATV (FastAPI + Pony ORM + Neon PostgreSQL + Next.js).

- **Origen:** solo lectura, no modificar Supabase
- **Ancla de confianza:** Cash Collected = **255699,99 USD** (351 pagos)
- **No replicar** métricas del CRM viejo (cierres 336, close rate 129,9%, etc.)

---

## 2. Estado actual

| Item | Estado |
|------|--------|
| Migración SQL (columnas + `legacy_cuota_ref`) | ✅ Aplicada en Neon |
| Modelos Pony + servicio import | ✅ |
| Scripts CLI | ✅ |
| CSV en `data/legacy/` | ❌ **FALTAN** |
| Dry-run | ❌ No ejecutado (sin CSV) |
| Import real | 🛑 **PROHIBIDO** hasta snapshot Neon + aprobación |

### Usuario ATV (verificado)

```bash
cd backend && python ../scripts/import_legacy_juano.py --list-users
```

| id | username | leads actuales (~) |
|----|----------|-------------------|
| **1** | `juano` | 1.563 |

Usar **`--user-id 1`** salvo confirmación contraria del cliente.

---

## 3. Bloqueador: exportar y copiar CSV

### 3.1 Export desde Supabase

Proyecto: **`crm-juanovent`** · Schema: **`juano`** · SQL Editor

⚠️ **Antes de cada query:** `Limit 100 rows` → **`No limit`**

Después: **Export → Download CSV**

#### `pagos.csv` — 351 filas

```sql
SELECT
  p.id,
  p.fecha,
  p.cliente,
  regexp_replace(trim(p.tel), '[^0-9+]', '', 'g')      AS tel_norm,
  p.usd,
  p.concepto,
  p.metodo,
  p.closer,
  p.setter,
  p.producto                                            AS producto_original,
  CASE
    WHEN p.producto ILIKE 'imperio studio pro%' THEN 'Imperio Studio Pro'
    WHEN p.producto ILIKE 'imperio%'            THEN 'Imperio Studio'
    WHEN p.producto ILIKE 'vip anual%'          THEN 'VIP Anual (12 meses)'
    WHEN p.producto ILIKE 'vip%'                THEN 'VIP 6 meses'
    WHEN p.producto ILIKE 'premium%'            THEN 'Premium 6 meses'
    WHEN p.producto ILIKE 'express%'            THEN 'Express / Downsell'
    WHEN p.producto ILIKE 'herramienta%'        THEN 'Herramienta 3 meses'
    WHEN p.producto ILIKE 'programa ($%'        THEN 'Premium 6 meses'
    WHEN p.producto = 'Programa'                THEN 'Sin especificar'
    ELSE 'Otro'
  END                                                   AS producto_norm,
  NULLIF(regexp_replace(p.producto, '^.*\(\$([0-9]+)\).*$', '\1'), p.producto)::numeric
                                                        AS precio_contrato,
  (p.notas ILIKE 'Import GHL%')                         AS origen_ghl,
  NULLIF(regexp_replace(COALESCE(p.notas,''), '^.*Revenue \$([0-9]+).*$', '\1'), COALESCE(p.notas,''))::numeric
                                                        AS revenue_ghl,
  p.notas,
  p.created_at
FROM juano.pagos p
ORDER BY p.fecha, p.created_at;
```

#### `leads.csv` — 2478 filas

```sql
SELECT
  id, fecha, closer, setter, situacion, cierre,
  data->>'nombre'         AS nombre,
  data->>'correo'         AS correo,
  data->>'telefono'       AS telefono,
  regexp_replace(COALESCE(data->>'telefono',''), '[^0-9+]', '', 'g') AS tel_norm,
  data->>'producto'       AS producto,
  data->>'presento'       AS presento,
  data->>'fuente'         AS fuente,
  data->>'origen'         AS origen,
  data->>'medioAgenda'    AS medio_agenda,
  data->>'fechaAgenda'    AS fecha_agenda,
  data->>'fechaLlamada'   AS fecha_llamada,
  data->>'calificado'     AS calificado,
  data->>'ghlContactId'   AS ghl_contact_id,
  created_at
FROM juano.leads
ORDER BY fecha, created_at;
```

#### `cuotas.csv` — 20 filas

```sql
SELECT
  id,
  alumno,
  programa,
  monto_total,
  abonado,
  (COALESCE(monto_total,0) - COALESCE(abonado,0)) AS saldo,
  ultimo_cobro,
  siguiente_cobro,
  closer,
  situacion,
  cuota,
  created_at
FROM juano.cuotas
ORDER BY siguiente_cobro NULLS LAST;
```

### 3.2 Copiar a repo

```
data/legacy/pagos.csv
data/legacy/leads.csv
data/legacy/cuotas.csv
```

### 3.3 Verificar (PowerShell)

```powershell
Get-Content data\legacy\pagos.csv  | Measure-Object -Line
Get-Content data\legacy\leads.csv  | Measure-Object -Line
Get-Content data\legacy\cuotas.csv | Measure-Object -Line
```

| Archivo | Líneas (datos + header) |
|---------|-------------------------|
| pagos.csv | **352** |
| leads.csv | **2479** |
| cuotas.csv | **21** |

Si alguno da **101** → truncado, re-exportar con `No limit`.

---

## 4. Archivos del repo

| Archivo | Rol |
|---------|-----|
| `backend/src/services/legacy_juano_import.py` | Lógica import |
| `backend/src/models.py` | Lead, LeadPayment, LegacyCuotaRef |
| `backend/src/db.py` | `_migrate_postgres_legacy_juano` |
| `scripts/import_legacy_juano.py` | CLI import |
| `scripts/validate_legacy_juano.py` | Validaciones |
| `scripts/rollback_legacy_juano.py` | Rollback + restore snapshots |
| `backend/.env` | Credenciales Neon (gitignored) |

**Restricciones:**
- Python 3.13: **no lambdas en queries Pony** — usar `rows_for_user()`
- Idempotencia: `UNIQUE (legacy_id) WHERE legacy_id IS NOT NULL`
- BD: env vars `DB_PROVIDER`, `DB_USER`, `DB_PASS`, `DB_HOST`, `DB_NAME`

---

## 5. Mapeo destino

| CSV | Filas | Tabla ATV |
|-----|-------|-----------|
| leads.csv | 2478 | `lead` |
| pagos.csv | 351 | `lead_payment` + link a `lead` |
| cuotas.csv | 20 | `legacy_cuota_ref` (snapshot, no saldos) |

No hay entidad Contact separada — **Lead = contacto**.

### Columnas nuevas

**lead:** `source`, `legacy_id`, `closer_norm`, `legacy_meta`  
**lead_payment:** `source`, `legacy_id`, `concepto`, `producto`, `metodo`, `legacy_meta`  
**legacy_cuota_ref:** tabla completa + trazabilidad

Históricos: `source = 'legacy_juano'`. Resto: `source = 'atv'`.

### Decisiones aprobadas

1. `legacy_cuota_ref` para cuotas — sí  
2. `producto`, `metodo`, `concepto` = **columnas** (no jsonb); flags en `legacy_meta`  
3. `Herramienta 3 meses` → producto `Otro`  
4. Tel inválido → importar fila, tel en `legacy_meta.telefono_invalido`  
5. `debe = NULL` si no hay contrato (no cero)  
6. Sobrepago: `debe = 0` en columna + `legacy_meta.sobrepago` + `sobrepago_monto`  
7. Snapshot `pre_import_snapshot` en leads ATV tocados por pagos legacy  

### Identidad (pagos → lead)

1. `tel_norm` exacto  
2. Email (regex en `notas` o `correo`)  
3. Nombre normalizado (NFKC, sin tildes)  
4. Crear lead nuevo si no matchea  

### Reglas negocio pagos

- **Cierre nuevo:** `concepto IN ('PIF', '1ra Cuota')`  
- **Cash collected:** suma de `usd`  
- Pagos futuros → `legacy_meta.es_programado = true`  
- Pagos $0 → importar, flag `monto_cero`  
- Montos $1–$14 → flag `monto_atipico`  
- `'Sin especificar'` / `'Otro'` → no forzar Premium  

### Closers (alias → `closer_norm`)

| Original | Normalizado |
|----------|-------------|
| Catalina | Catalina Zarlenga |
| Ignacio | Ignacio Claveria |
| Matias | Matías Sandobal |

### Leads situacion → status ATV

| Origen | Status |
|--------|--------|
| Venta | Cerrado |
| En Seguimiento / Adentro en seguimiento | Seguimiento |
| No Show | No show |
| Lead Descartado | Descalificado |
| Reagendó | Re-agenda |
| Nuevo / No agendó | Pendiente |
| Llamada Cancelada / Canceló | Pendiente |
| Fee / No cerró / Adentro en llamada | Seguimiento |

### Leads de prueba (`es_prueba`, excluir métricas)

Nombres: PRUEBA 5, x, DFS, Uuaq, Oko, yuyu, veran, dsfd, fgghhhh, etc.  
Emails: x@gmail.com, ws@gmail.com, prueba12@gmail.com, etc.

---

## 6. Comandos — orden de ejecución

```bash
cd backend

# A. Listar usuarios
python ../scripts/import_legacy_juano.py --list-users

# B. Dry-run (NO escribe)
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run

# 🛑 PARAR — revisar resumen, cliente crea snapshot branch Neon

# C. Import real (solo post-snapshot)
python ../scripts/import_legacy_juano.py --user-id 1
# Pide confirmación interactiva; o --yes para saltar

# D. Validar
python ../scripts/validate_legacy_juano.py --user-id 1

# E. Idempotencia — correr import de nuevo, conteos iguales

# Rollback si hace falta
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
python ../scripts/rollback_legacy_juano.py --user-id 1
```

Import parcial: `--only leads|pagos|cuotas`

---

## 7. Validaciones obligatorias (validate_legacy_juano.py)

| Check | Esperado |
|-------|----------|
| Pagos importados | 351 |
| Suma total USD | 255699.99 |
| Pagos julio 2026 (count) | 211 |
| Suma julio 2026 | 163195.80 |
| Leads importados | 2478 |
| Leads `presento = 'Sí'` | 366 |
| Cuotas | 20 |
| `legacy_id IS NULL` en legacy | 0 |
| Segunda corrida | conteos iguales |

Exit code ≠ 0 si falla alguna.

---

## 8. Dry-run — qué debe reportar

- Leads / pagos / cuotas: insertados, omitidos, excluidos  
- Leads creados desde pagos  
- Pagos matcheados a leads ATV preexistentes  
- **Matches:** tel_norm, email, nombre, contacto nuevo  
- **Flags:** es_prueba, fecha_inferida, monto_atipico, es_programado, monto_cero, telefono_invalido, saldo_inconsistente, sobrepago, precio_contrato_conflicto  

---

## 9. Rollback

1. Restaurar `legacy_meta.pre_import_snapshot` en leads ATV modificados  
2. `DELETE` filas `source = 'legacy_juano'` en lead_payment, legacy_cuota_ref, lead  
3. Verificar counts = 0  

**Alternativa confiable:** restore branch Neon.

---

## 10. Checklist pendiente del cliente

- [ ] Exportar 3 CSV desde Supabase (`No limit`)  
- [ ] Copiar a `data/legacy/` y verificar líneas (352 / 2479 / 21)  
- [ ] Confirmar `user_id=1` (juano)  
- [ ] Dry-run + revisar resumen  
- [ ] Snapshot branch Neon  
- [ ] Import real + validate + segunda corrida idempotente  

---

## 11. Qué NO hacer

- No ejecutar import real sin CSV verificados  
- No ejecutar import real sin snapshot Neon  
- No usar `--user-id` sin verificar con `--list-users`  
- No commitear `.env` ni CSV con datos sensibles si el cliente no lo pide  
- No replicar fórmulas de dashboard del CRM viejo  

---

## 12. Tarea inmediata para Claude

1. Confirmar que existen los 3 CSV en `data/legacy/` con conteos correctos  
2. Ejecutar dry-run: `python ../scripts/import_legacy_juano.py --user-id 1 --dry-run`  
3. Presentar resumen completo al cliente  
4. **PARAR** — esperar snapshot Neon antes de import real  

Si faltan CSV, indicar al operador que ejecute las queries SQL de la sección 3.
