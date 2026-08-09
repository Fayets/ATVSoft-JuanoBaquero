# Exportación de CSVs desde Supabase — schema `juano`

Correr en **SQL Editor** del proyecto `crm-juanovent`, cuenta de Jorge Quesada.

⚠️ **Antes de cada query: cambiar `Limit 100 rows` → `No limit`** (arriba a la derecha, al lado del botón Run). Si no, el export sale truncado a 100 filas.

Después de correr: **Export → Download CSV** y guardar con el nombre indicado.

Las tres consultas son solo lectura. No modifican nada en el origen.

Destino local:

```
data/legacy/pagos.csv
data/legacy/leads.csv
data/legacy/cuotas.csv
```

---

## 1 · `pagos.csv` — debe devolver **351 filas**

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

## 2 · `leads.csv` — debe devolver **2478 filas**

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

---

## 3 · `cuotas.csv` — debe devolver **20 filas**

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

| Archivo | Líneas esperadas (datos + encabezado) |
|---------|----------------------------------------|
| `pagos.csv` | **352** |
| `leads.csv` | **2479** |
| `cuotas.csv` | **21** |

Si alguno da **101** → se exportó truncado, volver a exportar con `No limit`.

---

## Siguiente paso (ATV)

```bash
cd backend
python ../scripts/import_legacy_juano.py --list-users
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
```

Ver también: `docs/HANDOFF_DRYRUN_JUANO.md`, `docs/MIGRACION_JUANO.md`
