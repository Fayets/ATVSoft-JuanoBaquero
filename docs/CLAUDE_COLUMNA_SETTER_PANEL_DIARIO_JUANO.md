# Columna Setter — panel diario (prueba funcional)

**Tenant:** `user_id = 1` (juano)  
**Estado:** ✅ **PROBADO OK** — pendiente commit  
**Fecha prueba:** 2026-08-12  
**Spec origen:** `columna-setter-diario.md` (Desktop operador)

---

## Resumen ejecutivo

Columna **Setter** con desplegable dinámico desde `TeamMember` (`rol='setter'`), ubicada a la derecha de **Triajer**. Persistencia instantánea vía `PATCH /leads/{id}`. Valores huérfanos (ej. `Setter IA`) se muestran aunque no estén en el catálogo. Prueba API OK; anclas de pagos intactas.

---

## 1. Implementación

| Capa | Archivo | Cambio |
|---|---|---|
| Lectura | `agent_closer_service.py` → `_llamada_item()` | devuelve `setter` |
| Schema | `schemas.py` → `AgentLlamadaHoyItemOut` | campo `setter: str = ""` |
| Patch | `leads_controller.py` → `patch_lead` | ya existía bloque `setter` |
| Opciones | `GET /api/team/members` | ya devuelve `setters[]` — se usa vía `getTeamSetters()` |
| API client | `daily-panel-service.ts` | `getTeamSetters`, `patchLeadSetter`, mapeo en `getDailyCalls` |
| Orquestación | `daily-panel-page.tsx` | `setterOptions`, `handleSetterChange` |
| UI | `daily-calls-table.tsx` | `SetterSelect` con **"Sin especificar"** |
| CSS | `daily-panel.css` | grid **14 columnas** |
| Admin | `admin-panel-service.ts` | mapeo `setter` + `outbound` en modo admin |

---

## 2. Datos iniciales

```sql
SELECT COALESCE(NULLIF(setter,''),'(sin setter)') AS setter, COUNT(*)
FROM lead WHERE user_id=1 AND call IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;
```

| setter | llamadas |
|---|---:|
| (sin setter) | **2.656** |
| Setter IA | **146** |

```sql
SELECT id, nombre, rol FROM teammember WHERE user_id=1 AND rol='setter';
```

| Resultado |
|---|
| **0 setters** en TeamMember al inicio (esperado) |

---

## 3. Prueba funcional (API)

**Script:** `scripts/test_setter_column.py`  
**Evidencia:** `data/legacy/test_setter_column_result.json`

| # | Paso | Resultado |
|---|---|---|
| 1 | `GET /llamadas-hoy?fecha=2026-08-12` incluye `setter` | ✅ |
| 2 | `POST /team/members` `{ rol: setter, nombre: __Test Setter QA__ }` | ✅ id 16 |
| 3 | `GET /team/members` → aparece en `setters[]` | ✅ **requisito central** |
| 4 | `PATCH /leads/6991` `{ setter: __Test Setter QA__ }` | ✅ persiste |
| 5 | Re-GET llamadas-hoy | ✅ refleja el valor |
| 6 | `PATCH { setter: "" }` → Sin especificar | ✅ desasigna |
| 7 | Restaurar estado + `DELETE /members/16` | ✅ cleanup OK |

**Lead de prueba:** 6991 — Jesualdo Quintero Martinez (2026-08-12).

**Setter IA:** 146 llamadas en BD con ese valor; ninguna cae en el día 2026-08-12 del panel. El componente `SetterSelect` incluye la opción huérfana cuando el valor no está en el catálogo (mismo patrón que Triajer).

---

## 4. Anclas intactas

| Pagos | Monto |
|---:|---:|
| **393** | **$291.232,87** |

---

## 5. Commits locales (sin push)

| Commit | Descripción |
|---|---|
| `04e3a1c` | Ocultar comprobantes Cobranzas |
| `ccaf5af` | Columna Outbound |
| *(pendiente)* | **Columna Setter** ← este |

Los tres van juntos al deploy.

---

## 6. Reproducir

```powershell
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
python ..\scripts\test_setter_column.py
```
