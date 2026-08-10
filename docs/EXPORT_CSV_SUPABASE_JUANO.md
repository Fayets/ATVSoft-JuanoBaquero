# Exportación de CSVs desde Supabase — schema `juano`

Correr en **SQL Editor** del proyecto `crm-juanovent`, cuenta de Jorge Quesada.

⚠️ **Antes de cada query: cambiar `Limit 100 rows` → `No limit`** (arriba a la derecha, al lado del botón Run). Si no, el export sale truncado a 100 filas.

Después de correr: **Export → Download CSV** y guardar con el nombre indicado.

Las tres consultas son solo lectura. No modifican nada en el origen.

Destino local:

```
data/legacy/expected_counts.json
data/legacy/pagos.csv
data/legacy/leads.csv
data/legacy/cuotas.csv
```

⚠️ **Regla operativa:** correr la query de control (§0) y los tres exports **en la misma sesión**, uno tras otro. Si pasan días, rehacer todo — el CRM legacy sigue en uso y los números cambian.

---

## 0 · Query de control → `expected_counts.json` (OBLIGATORIO, primero)

Correr **antes** de exportar los CSV. Copiar el resultado a `data/legacy/expected_counts.json`.

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

Ejemplo `expected_counts.json` (valores ilustrativos — usar los de tu export):

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

`validate_legacy_juano.py` y el importador leen este archivo. **No hardcodear conteos en código.**

### Nota `ghlId` (verificado 2026-08-09)

`data->>'ghlId'` **NO** es `ghl_appointment_id` (1.284 ids distintos / 2.462 filas). Matcheo = `ghlContactId` + fecha ±1 día. **No incluir `ghlId` en el export.**

---

## 1 · `pagos.csv`

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

---

## 2 · `leads.csv`

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

Conteo de filas = `leads_total` en `expected_counts.json` (ej. **2496** al 2026-08-09).

---

## 3 · `cuotas.csv`

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

---

## Verificación después de copiar a `data/legacy/`

PowerShell:

```powershell
Get-Content data\legacy\pagos.csv  | Measure-Object -Line
Get-Content data\legacy\leads.csv  | Measure-Object -Line
Get-Content data\legacy\cuotas.csv | Measure-Object -Line
```

| Archivo | Líneas = datos + header |
|---------|-------------------------|
| `expected_counts.json` | generado en §0 |
| `pagos.csv` | `pagos_total + 1` |
| `leads.csv` | `leads_total + 1` |
| `cuotas.csv` | `cuotas_total + 1` |

Si alguno da **101** → se exportó truncado, volver a exportar con `No limit`.

---

## Siguiente paso (ATV)

```bash
cd backend
python ../scripts/import_legacy_juano.py --list-users
python ../scripts/import_legacy_juano.py --user-id 1 --report-duplicates
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
```

Ver también: `docs/HANDOFF_DRYRUN_JUANO.md`, `docs/MIGRACION_JUANO.md`
