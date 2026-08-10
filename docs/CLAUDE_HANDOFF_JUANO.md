# Handoff único — Migración CRM juano → ATV

> **⚠️ Supersedido por [`CLAUDE_JUANO.md`](CLAUDE_JUANO.md) — documento único consolidado.**

**Audiencia:** Claude (revisión y decisiones). **Ejecución:** Cursor + operador humano.  
**Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero` · rama `develop`  
**Fecha:** 2026-08-09  
**Estado:** Importador + deduplicación **implementados**. Pendiente: export operador → `--report-duplicates` → dry-run → snapshot Neon → import real.

> Claude **no ejecuta** comandos ni accede al repo. Revisa outputs y decide go/no-go. Cursor ejecuta scripts.

---

## 0. Resumen ejecutivo

Migrar datos históricos del CRM Supabase (schema `juano`, proyecto `crm-juanovent`) a ATV (FastAPI + Pony ORM + Neon + Next.js).

- **Tenant destino:** `user_id = 1`, username `juano`
- **ATV hoy:** ~1.577 leads (jun–ago 2026, origen GHL sync)
- **CSV legacy:** ~2.496+ leads (abr–ago 2026) — **el CRM viejo sigue en uso** (+18 filas desde el conteo original)
- **Riesgo principal resuelto en código:** deduplicación leads.csv vs ATV (sin esto, 2.478 inserts ciegos)
- **Unidad de identidad en ATV:** la **cita** (`ghl_appointment_id` 1:1), no la persona
- **Ancla financiera:** suma pagos USD del snapshot exportado (ya no hardcodeada — ver `expected_counts.json`)

---

## 1. Problema crítico de deduplicación (resuelto en código)

`UNIQUE (legacy_id)` evita reimportar el mismo CSV, **pero no** evita duplicar personas ya en ATV.

### Investigación Neon (ATV, user_id=1)

| Hallazgo | Valor |
|----------|------:|
| Leads totales | 1.577 |
| Con `GHL contact_id` en notas | 1.556 |
| `ghl_contact_id` distintos | 1.400 |
| Filas extra (misma persona, varias citas) | **156** |
| `ghl_appointment_id` distintos | 1.556 (= filas, **0 extras**) |

**Conclusión:** matchear solo por `ghl_contact_id` colapsaría 156 filas. Matcheo = contacto + **fecha ±1 día**.

### Verificación `ghlId` (Supabase) — DESCARTADO

| métrica | valor |
|---------|------:|
| total leads | 2.496 |
| con_ghlid | 2.462 |
| **ghlid_distintos** | **1.284** |
| contactid_distintos | 2.414 |

Test cruzado Neon: **0/30** ghlId legacy coinciden con `ghl_appointment_id` ATV.

**`ghlId` = persona (repite). `ghlContactId` = casi 1 por fila.** No incluir `ghlId` en export.

### Vínculo confirmado

`leads.csv.ghl_contact_id` ↔ columna `ghl_contact_id` / `notas` en ATV.  
Ejemplo: Alfredo Alberto → `r75RFijE3f3N9yvNS8ZY` + `alfa_tec@hotmail.com`.

---

## 2. Cadena de matcheo implementada (`leads.csv → lead`)

| # | Criterio | Acción |
|---|----------|--------|
| 1 | `ghl_contact_id` + `fecha_llamada` ±1 día | Merge si **1 candidato** |
| 2 | `ghl_contact_id` + `fecha_agenda` ±1 día | Fallback |
| — | >1 candidato en ventana | **No merge** → `match_ambiguo` + lista ids |
| 3 | Teléfono solo dígitos | Merge |
| 4 | Teléfono últimos 10 dígitos | Merge |
| 5 | Email exacto | Merge |
| 6 | Solo nombre | **Crear nuevo** + `posible_duplicado` + `candidato_lead_id` |
| 7 | Sin match | Crear nuevo |

Registrar `legacy_meta.match_method` y `legacy_meta.match_score`.

### Política de merge (al matchear lead ATV existente)

**Completar solo si vacío:** `email`, `telefono`, `nombre`, `origen`, `keyword`

**Nunca tocar:** `status`, `estado`, `closer`, `setter`, `notas`

**Auditoría:** `pre_import_snapshot`, `legacy_meta.legacy_lead`, `imported_legacy_ids[]` (idempotencia de filas mergeadas)

**Pagos:** siempre se agregan (registros nuevos).

### Fallback `agendo`

```
agendo = fecha_agenda
si vacío → agendo = fecha (columna CSV)
si vacío → agendo = created_at + legacy_meta.agendo_inferido = 'created_at'
```

Nunca usar `created_at` como primer fallback.

### Identidad pagos → lead (sin cambio)

1. tel_norm → 2. email → 3. nombre → 4. crear nuevo

---

## 3. CRM legacy sigue vivo — regla operativa

Conteo original leads: **2.478** → ahora **2.496+**. Pagos/cuotas también pueden haber crecido.

**No hardcodear conteos en código.** Flujo:

1. Query de control en Supabase → `data/legacy/expected_counts.json`
2. Exportar 3 CSV **en la misma sesión**, seguidos
3. Importador y validador leen ese JSON

Si pasan días entre export e import → **rehacer todo**.

Ideal: congelar CRM viejo → export → migrar → equipo solo en ATV.  
Alternativa: segunda pasada incremental (idempotencia por `legacy_id`).

---

## 4. Export desde Supabase

Proyecto: **`crm-juanovent`** · Schema: **`juano`** · SQL Editor  
⚠️ **`Limit 100 rows` → `No limit`** antes de cada query.

### 4.0 Query de control (PRIMERO) → `expected_counts.json`

```sql
SELECT
  (SELECT COUNT(*) FROM juano.pagos)                                    AS pagos_total,
  (SELECT ROUND(SUM(usd)::numeric, 2) FROM juano.pagos)                 AS pagos_usd_total,
  (SELECT COUNT(*) FROM juano.pagos
     WHERE fecha >= '2026-07-01' AND fecha < '2026-08-01')              AS pagos_julio,
  (SELECT ROUND(SUM(usd)::numeric, 2) FROM juano.pagos
     WHERE fecha >= '2026-07-01' AND fecha < '2026-08-01')              AS pagos_usd_julio,
  (SELECT COUNT(*) FROM juano.leads)                                    AS leads_total,
  (SELECT COUNT(*) FROM juano.leads WHERE data->>'presento' = 'Sí')     AS leads_presento_si,
  (SELECT COUNT(*) FROM juano.cuotas)                                   AS cuotas_total,
  NOW()                                                                 AS exportado_en;
```

Ejemplo JSON (usar valores reales del export):

```json
{
  "pagos_total": 351,
  "pagos_usd_total": 255699.99,
  "pagos_julio": 211,
  "pagos_usd_julio": 163195.80,
  "leads_total": 2496,
  "leads_presento_si": 366,
  "cuotas_total": 20,
  "exportado_en": "2026-08-09T20:00:00Z"
}
```

Plantilla: `data/legacy/expected_counts.json.example`

### 4.1 `pagos.csv`

```sql
SELECT
  p.id, p.fecha, p.cliente,
  regexp_replace(trim(p.tel), '[^0-9+]', '', 'g') AS tel_norm,
  p.usd, p.concepto, p.metodo, p.closer, p.setter,
  p.producto AS producto_original,
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
  END AS producto_norm,
  NULLIF(regexp_replace(p.producto, '^.*\(\$([0-9]+)\).*$', '\1'), p.producto)::numeric AS precio_contrato,
  (p.notas ILIKE 'Import GHL%') AS origen_ghl,
  NULLIF(regexp_replace(COALESCE(p.notas,''), '^.*Revenue \$([0-9]+).*$', '\1'), COALESCE(p.notas,''))::numeric AS revenue_ghl,
  p.notas, p.created_at
FROM juano.pagos p
ORDER BY p.fecha, p.created_at;
```

### 4.2 `leads.csv`

```sql
SELECT
  id, fecha, closer, setter, situacion, cierre,
  data->>'nombre'       AS nombre,
  data->>'correo'       AS correo,
  data->>'telefono'     AS telefono,
  regexp_replace(COALESCE(data->>'telefono',''), '[^0-9+]', '', 'g') AS tel_norm,
  data->>'producto'     AS producto,
  data->>'presento'     AS presento,
  data->>'fuente'       AS fuente,
  data->>'origen'       AS origen,
  data->>'medioAgenda'  AS medio_agenda,
  data->>'fechaAgenda'  AS fecha_agenda,
  data->>'fechaLlamada' AS fecha_llamada,
  data->>'calificado'   AS calificado,
  data->>'ghlContactId' AS ghl_contact_id,
  created_at
FROM juano.leads
ORDER BY fecha, created_at;
```

**No incluir `ghlId`.**

### 4.3 `cuotas.csv`

```sql
SELECT id, alumno, programa, monto_total, abonado,
  (COALESCE(monto_total,0) - COALESCE(abonado,0)) AS saldo,
  ultimo_cobro, siguiente_cobro, closer, situacion, cuota, created_at
FROM juano.cuotas
ORDER BY siguiente_cobro NULLS LAST;
```

### 4.4 Copiar a repo

```
data/legacy/expected_counts.json
data/legacy/pagos.csv
data/legacy/leads.csv
data/legacy/cuotas.csv
```

Líneas CSV = valor en JSON + 1 header. Si algún CSV da **101 líneas** → truncado, re-exportar.

---

## 5. Mapeo destino

| CSV | Tabla ATV |
|-----|-----------|
| leads.csv | `lead` |
| pagos.csv | `lead_payment` + link a `lead` |
| cuotas.csv | `legacy_cuota_ref` (snapshot, no saldos operativos) |

No hay entidad Contact — **Lead = contacto**.

### Columnas clave

**lead:** `source`, `legacy_id`, `ghl_contact_id`, `ghl_appointment_id`, `closer_norm`, `legacy_meta`  
**lead_payment:** `source`, `legacy_id`, `concepto`, `producto`, `metodo`, `legacy_meta`  
Históricos importados: `source = 'legacy_juano'`. Resto: `source = 'atv'`.

### Fechas y dashboards

Backend filtro mensual (`GET /leads?month=`): **`call > agendo > fecha_bot > created_at`**

Import mapea: `fecha`→`fecha_bot`, `fecha_agenda`→`agendo`, `fecha_llamada`→`call`

Grilla excluye leads sin `agendo` → fallback agendo crítico.

### Reglas de negocio (pagos)

- Cierre nuevo: `concepto IN ('PIF', '1ra Cuota')`
- Cash collected: suma `usd`
- Pagos futuros → `legacy_meta.es_programado`
- Pagos $0 → flag `monto_cero`
- Montos $1–$14 → flag `monto_atipico`
- Sin contrato → `debe = NULL`
- Sobrepago: `debe = 0` + `legacy_meta.sobrepago` + `sobrepago_monto = abs(excedente)`
- `Herramienta 3 meses` → producto `Otro`
- Tel inválido → importar, tel en `legacy_meta.telefono_invalido`

### Situacion → status (leads)

Venta→Cerrado · En Seguimiento→Seguimiento · No Show→No show · Lead Descartado→Descalificado · Reagendó→Re-agenda · Nuevo/No agendó→Pendiente · Fee/No cerró→Seguimiento

### Leads de prueba

Nombres: PRUEBA 5, x, DFS, Uuaq, Oko, yuyu, veran… Emails: x@gmail.com, ws@gmail.com, prueba12@gmail.com…

---

## 6. Implementado en repo (Cursor)

| Componente | Archivo |
|------------|---------|
| Migración SQL legacy + `ghl_contact_id` | `backend/src/db.py` |
| Modelos Pony | `backend/src/models.py` |
| GHL sync escribe `ghl_contact_id` | `backend/src/controllers/ghl_controller.py` |
| Import + matcheo + merge + report | `backend/src/services/legacy_juano_import.py` |
| CLI import | `scripts/import_legacy_juano.py` |
| Validación | `scripts/validate_legacy_juano.py` |
| Rollback | `scripts/rollback_legacy_juano.py` |

**Neon:** backfill `ghl_contact_id` ~1.559 filas desde `notas`. Índice **NO único**.

**Restricciones técnicas:** Python 3.13 — no lambdas en queries Pony; idempotencia `UNIQUE (legacy_id)`; credenciales en `backend/.env` (gitignored).

---

## 7. Comandos — orden de ejecución

```bash
cd backend

# Listar usuarios
python ../scripts/import_legacy_juano.py --list-users

# 🛑 1. Reporte duplicados (requiere CSV completos)
python ../scripts/import_legacy_juano.py --user-id 1 --report-duplicates

# 🛑 2. Dry-run (no escribe)
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run

# 🛑 PARAR — operador crea snapshot branch Neon

# 3. Import real (post-snapshot)
python ../scripts/import_legacy_juano.py --user-id 1 --yes

# 4. Validar contra expected_counts.json
python ../scripts/validate_legacy_juano.py --user-id 1

# 5. Idempotencia — segunda corrida import, conteos iguales

# Rollback si hace falta
python ../scripts/rollback_legacy_juano.py --user-id 1 --dry-run
python ../scripts/rollback_legacy_juano.py --user-id 1
```

Import parcial: `--only leads|pagos|cuotas`

---

## 8. Validaciones (`validate_legacy_juano.py`)

Requiere `expected_counts.json` + `import_summary.json` (generado por import/dry-run).

**Pagos:** comparación directa (sin resta) — ancla USD exacta.

**Leads / cuotas:** comparación contra **esperado neto** = origen − excluidos (`es_prueba`).

```
LEADS
  Origen (expected_counts)  : 2496
  Excluidos (es_prueba)     :   10
  Esperado neto             : 2486
  Aplicados en ATV          : 2486   OK
    nuevos / merges         : desglose
```

Alerta si excluidos > **1%** del origen (filtro mal escrito).

Leads aplicados = nuevos `source=legacy_juano` + Σ `imported_legacy_ids`.

---

## 9. Control de sanidad — `--report-duplicates`

| Mes CSV | Esperado |
|---------|----------|
| Abr–May 2026 | Casi todo **nuevo** |
| Jun 2026 | Transición |
| Jul–Ago 2026 | **Alta tasa merge** |

Señales de alarma:
- Casi todo nuevo + 0 merges en jul/ago → matcheo roto
- Muchos merges en abril → sospechoso
- Reporte incluye: por método, por mes, `match_ambiguo`, `posible_duplicado_nombre`, muestra 30 matches

---

## 10. Dry-run — qué debe reportar

- Leads: nuevos vs merge ATV vs ambiguo vs posible_dup nombre
- Por método y por mes
- Pagos/cuotas: insertados, omitidos
- Flags: es_prueba, fecha_inferida, agendo_inferido, monto_atipico, es_programado, monto_cero, telefono_invalido, sobrepago…

---

## 11. Rollback

1. Restaurar `pre_import_snapshot` en leads ATV modificados  
2. DELETE `source = 'legacy_juano'` en lead_payment, legacy_cuota_ref, lead  
3. Verificar counts = 0  

**Alternativa confiable:** restore branch Neon.

---

## 12. Checklist pendiente

- [ ] Congelar CRM legacy con cliente (ideal)
- [ ] Query control → `expected_counts.json`
- [ ] Export 3 CSV misma sesión → `data/legacy/`
- [ ] `--report-duplicates` → revisar Claude/operador
- [ ] `--dry-run` → revisar Claude/operador
- [ ] Snapshot branch Neon
- [ ] Import real + validate + idempotencia

---

## 13. Qué NO hacer

- No import real sin CSV + `expected_counts.json` verificados
- No import real sin snapshot Neon
- No asumir `ghlId` = appointment id
- No matchear solo por `ghl_contact_id` sin fecha
- No merge automático por nombre solo
- No hardcodear conteos de validación
- No commitear `.env` ni CSV con PII sin permiso del cliente

---

## 14. Rol de Claude en este punto

1. Revisar output de `--report-duplicates` (desglose por mes coherente)
2. Revisar output de `--dry-run`
3. Decidir **go / no-go** para import real
4. Escalar dudas al operador (congelar CRM, segunda pasada incremental, etc.)

Cursor ejecuta scripts y ajusta código según feedback.
