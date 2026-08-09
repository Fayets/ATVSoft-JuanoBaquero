# Handoff — dry-run migración juano (para Claude / operador)

**Generado:** 2026-08-08  
**Estado:** Bloqueado — faltan CSV en `data/legacy/`

---

## Qué se pidió ejecutar

Archivo fuente: `pre-dryrun-juano.md`

1. Verificar `--user-id` correcto  
2. Verificar integridad CSV (351 / 2478 / 20 filas)  
3. Mejoras al importador (seguridad + conteo + sobrepago)  
4. Correr dry-run con user confirmado  
5. **PARAR** — no carga real  

---

## Qué ya se hizo en el repo

| Item | Estado |
|------|--------|
| Listar usuarios (`--list-users`) | ✅ |
| Validar user_id existe antes de importar | ✅ |
| Confirmación interactiva en import real | ✅ |
| Validación conteo CSV al arrancar | ✅ |
| Corrección `debe` + flag `sobrepago` en legacy_meta | ✅ |
| Resumen dry-run con matches y flags | ✅ |

---

## Usuario ATV verificado

Consulta a Neon (`authuser`):

| id | username | leads actuales |
|----|----------|----------------|
| **1** | `juano` | ~1.563 |

**Pendiente:** confirmación explícita del cliente de que `user_id=1` es correcto.

Comando para re-verificar:

```bash
cd backend
python ../scripts/import_legacy_juano.py --list-users
```

---

## Bloqueador actual: CSV faltantes

Los archivos **no están** en el repo ni en Desktop:

```
data/legacy/pagos.csv   ← FALTA (351 filas de datos)
data/legacy/leads.csv   ← FALTA (2478 filas)
data/legacy/cuotas.csv  ← FALTA (20 filas)
```

### Qué necesitamos del operador

1. Exportar desde Supabase schema `juano` los 3 CSV **sin truncar** (cuidado límite 100 filas del dashboard).
2. Copiarlos a:

```
ATVSoft-JuanoBaquero/data/legacy/pagos.csv
ATVSoft-JuanoBaquero/data/legacy/leads.csv
ATVSoft-JuanoBaquero/data/legacy/cuotas.csv
```

3. Verificar líneas (incluye header):

| Archivo | Líneas esperadas |
|---------|------------------|
| pagos.csv | **352** |
| leads.csv | **2479** |
| cuotas.csv | **21** |

Si alguno da **101** → export truncado, no continuar.

PowerShell:

```powershell
Get-Content data\legacy\pagos.csv | Measure-Object -Line
Get-Content data\legacy\leads.csv | Measure-Object -Line
Get-Content data\legacy\cuotas.csv | Measure-Object -Line
```

---

## Comandos a ejecutar cuando existan los CSV

```bash
cd backend

# 1. Usuarios
python ../scripts/import_legacy_juano.py --list-users

# 2. Dry-run (NO escribe)
python ../scripts/import_legacy_juano.py --user-id 1 --dry-run

# 3. PARAR — revisar resumen, crear snapshot branch Neon

# 4. Import real (solo después de snapshot)
python ../scripts/import_legacy_juano.py --user-id 1

# 5. Validar
python ../scripts/validate_legacy_juano.py --user-id 1
```

---

## Validaciones post-import esperadas

| Check | Valor |
|-------|-------|
| Pagos | 351 |
| Suma USD | 255699.99 |
| Pagos julio 2026 | 211 / 163195.80 |
| Leads | 2478 |
| presento = Sí | 366 |
| Cuotas | 20 |

---

## Contexto técnico

- **Repo:** `c:\Users\Win10\Desktop\ATVSoft-JuanoBaquero`
- **BD:** Neon PostgreSQL, credenciales en `backend/.env` (gitignored)
- **Stack:** FastAPI + Pony ORM + Next.js
- **Docs:** `docs/MIGRACION_JUANO.md`, `docs/ESTADO_MIGRACION_JUANO.md`
- **Scripts:** `scripts/import_legacy_juano.py`, `scripts/validate_legacy_juano.py`, `scripts/rollback_legacy_juano.py`
- **Lógica:** `backend/src/services/legacy_juano_import.py`

### Reglas clave

- Idempotencia vía `legacy_id` + `source='legacy_juano'`
- Pagos → `lead_payment`; leads → `lead`; cuotas → `legacy_cuota_ref`
- `debe = NULL` si no hay contrato; sobrepago → `legacy_meta.sobrepago`
- No replicar métricas del CRM viejo; ancla = Cash Collected 255699.99 USD

---

## Resumen dry-run

**No ejecutado** — abortó con:

```
Faltan CSV en data/legacy: leads.csv, pagos.csv, cuotas.csv
```

Cuando los CSV estén, el dry-run debe reportar:
- insertados / omitidos por tabla
- matches: tel_norm, email, nombre, contacto nuevo
- flags: es_prueba, fecha_inferida, monto_atipico, es_programado, monto_cero, telefono_invalido, saldo_inconsistente, sobrepago, precio_contrato_conflicto

---

## Confirmaciones pendientes del cliente

- [ ] `user_id=1` (juano) es el tenant correcto  
- [ ] CSV copiados y conteos verificados  
- [ ] Revisión del resumen dry-run  
- [ ] Snapshot branch Neon antes de import real  
