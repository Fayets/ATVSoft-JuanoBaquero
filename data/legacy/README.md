# CSV de migración CRM juano

## 1. Exportar desde Supabase

Seguí las queries en **`docs/EXPORT_CSV_SUPABASE_JUANO.md`**.

Proyecto: `crm-juanovent` · Schema: `juano`  
⚠️ En SQL Editor: **`Limit 100 rows` → `No limit`** antes de cada export.

## 2. Guardar aquí

```
data/legacy/pagos.csv   (351 filas + header = 352 líneas)
data/legacy/leads.csv   (2478 filas + header = 2479 líneas)
data/legacy/cuotas.csv  (20 filas + header = 21 líneas)
```

## 3. Verificar

```powershell
Get-Content data\legacy\pagos.csv  | Measure-Object -Line
Get-Content data\legacy\leads.csv  | Measure-Object -Line
Get-Content data\legacy\cuotas.csv | Measure-Object -Line
```

Si alguno da **101** → export truncado, repetir con `No limit`.

## 4. Dry-run

```bash
cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
```
