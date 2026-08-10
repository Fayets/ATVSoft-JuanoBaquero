# CSV de migración CRM juano

## 1. Exportar desde Supabase (misma sesión)

Seguí **`docs/EXPORT_CSV_SUPABASE_JUANO.md`**.

1. **§0** — Query de control → guardar como `expected_counts.json`
2. Exportar `pagos.csv`, `leads.csv`, `cuotas.csv` (sin pausa larga entre pasos)

Proyecto: `crm-juanovent` · Schema: `juano`  
⚠️ SQL Editor: **`Limit 100 rows` → `No limit`**

## 2. Archivos en esta carpeta

```
expected_counts.json   ← query §0 (obligatorio)
import_summary.json    ← generado por import/dry-run (para validate)
pagos.csv
leads.csv
cuotas.csv
```

Conteos = valores en `expected_counts.json` + 1 línea de header por CSV.

## 3. Verificar líneas (PowerShell)

```powershell
Get-Content data\legacy\pagos.csv  | Measure-Object -Line
Get-Content data\legacy\leads.csv  | Measure-Object -Line
Get-Content data\legacy\cuotas.csv | Measure-Object -Line
```

Si alguno da **101** → export truncado, repetir con `No limit`.

## 4. Reporte duplicados (antes del dry-run)

```bash
cd backend
python ../scripts/import_legacy_juano.py --user-id 1 --report-duplicates
```

## 5. Dry-run

```bash
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run
```
