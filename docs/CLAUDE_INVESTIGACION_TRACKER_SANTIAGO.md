## Contexto

Santiago Torrico reportó el **11/08 ~07:25** que *«se borró todo en el tracker, en la parte de los fathoms»*. La captura muestra el modal **«Editar lead»** con **¿Se hizo triaje?**, **Contexto triaje** y **Contexto setter (pre call)**.

Branch de referencia Neon: **`recuperacion-prefathom`** (snapshot 10/08 12:00 ART).

## 1. Filas — sin pérdida (confirmado)

| Métrica | Branch 10/08 | Production 11/08 |
|---|---:|---:|
| `call_report` | 9 | **12** |
| `closer_report` | 11 | **17** |
| `setter_report` | 0 | **0** |
| Leads con `link_llamada` | 9 | **12** |

Production actual (consulta directa):
- `call_report`: **12**
- `closer_report`: **17**
- `setter_report`: **0**
- leads con `link_llamada`: **12**

El import legacy **no** causó borrado masivo: tasas de `link_llamada` equivalentes entre leads tocados y no tocados (~0,7%).

## 2. Hallazgo principal — Fathom vacío = análisis en error, no borrado

Los **12** `call_report` en production tienen **contenido de texto vacío** (`closer_report`, `resumen`, `dolores_llamada` = NULL/vacío).

**Estado de análisis:**

- `error`: **12**

**Mensaje de error (todos):**

> Configurá tu API key de Claude en Conexiones API antes de analizar llamadas.

Conclusión: los links Fathom **siguen en `lead.link_llamada`** (12 leads). Lo que Santiago ve vacío en la parte de Fathoms es el **resultado del análisis Claude**, que **nunca se completó** por falta de API key — no un wipe de datos.

## 3. Campos tracker en production (user_id=1)

| Campo | Leads/registros con dato |
|---|---:|
| `link_llamada` | **12** |
| `calificacion_llamada` | **17** |
| `dolores_llamada` | **0** |
| `programada_ofrecido_llamada` | **10** |
| `notas` | **1604** |
| `triaje_hecho` | **10** |
| `triajer` | **356** |
| `closer_report (lead)` | **0** |
| `dolores_setting` | **0** |
| `setter_report (tabla)` | **0** |

## 4. Diff contenido branch vs production (3.1)

**Pendiente:** requiere connection string del branch `recuperacion-prefathom` (Neon → Branches → Connect). Script listo:

```bash
cd backend
export BRANCH_DATABASE_URL='postgresql://...'
python ../scripts/investigate_tracker_content_diff.py --user-id 1
```

**Proxy parcial (solo production):** audit `legacy_meta.actualizaciones[]` con campo que pasó de valor → vacío: **0** eventos.

## 5. Frontend — campos de la captura (3.2)

En **`master` / `ff29c43`** no existe un modal titulado **«Editar lead»** con las etiquetas **«Contexto triaje»** ni **«Contexto setter (pre call)»**. Esas strings **no aparecen en el repo** (ni en historial git).

Mapeo probable vs código actual:

| Etiqueta captura | Campo / fuente en código | Notas |
|---|---|---|
| ¿Se hizo triaje? | `lead.triaje_hecho` (bool) | Panel diario (`/panel-diario`), columna checkbox |
| Contexto triaje | **No existe** campo homónimo | Podría ser `triajer` (nombre) o UI no desplegada |
| Contexto setter (pre call) | **No existe** campo homónimo | Candidato: `lead.dolores_setting` (0 con dato) o `setter_report` (**0 filas siempre**) |
| Links / Fathoms | `lead.link_llamada` + tabla `call_report` | 12 links OK; análisis en `call_report` vacío por error Claude |

**Tracker operativo hoy:** `/panel-diario` (Dashboard diario) — tabla con Triajer, Triaje, Link Fathom, calificación. Reportes Fathom analizados: `/call-reports`.

**Falso positivo probable:** si «Contexto setter» apuntara a `setter_report`, esa tabla tiene **0 filas** en branch y production → el campo **nunca tuvo datos**.

## 6. Cambios de código recientes (3.3)

Commits desde 05/08 en `frontend/` + `backend/`:

- `ff29c43` — upsert leads legacy (payload refresh, propagación selectiva)
- `7e4ee21` — fix dashboard cash (`leads-analytics.ts`, `cobranzas_controller.py`)
- `c7d9fa4` — CRM clientes + importador legacy

**Ninguno** modifica modal de lead, panel diario, campos triaje/Fathom ni serializers de esos campos. El fix de doble conteo **no afecta** el tracker.

## 7. Deploy (3.4)

- Rama **`master`** en GitHub: **`ff29c43`** (sync con `migracion`)
- VPS (`72.60.244.220`): **no verificado** desde este entorno (SSH timeout puerto 22)
- Confirmar en VPS: `git log -1 --oneline` + rebuild docker tras pull

## 8. Diagnóstico

| Hipótesis | Evidencia | Probabilidad |
|---|---|---|
| Borrado masivo de filas | Conteos subieron; links intactos | **Descartada** |
| Import legacy vació campos | Audit import: 0 clears; tasas link_llamada OK | **Descartada** |
| Fathom «vacío» = análisis fallido | 12/12 `call_report` en `error`, sin API key Claude | **Alta** |
| Modal lee campo inexistente / UI distinta al repo | Labels no están en master | **Media** (verificar build VPS) |
| setter_report nunca poblado | 0 filas en ambas ramas | **Alta** (falso positivo) |
| Pérdida campo a campo pre-10/08 | Sin diff branch aún | **Abierta** |

## 9. Acciones recomendadas

1. **Configurar API key Claude** en Conexiones → re-procesar los 12 `call_report` en error.
2. **Pedir a Santiago** nombre de cliente concreto + pantalla exacta + cuándo vio datos (acelera diff puntual).
3. **Correr diff 3.1** con `BRANCH_DATABASE_URL` del branch Neon.
4. **Verificar versión en VPS** vs `ff29c43` — la captura puede ser UI no presente en master.
5. **No correr upsert leads pendiente** ni escribir en production hasta cerrar (restricción doc origen).

Anclas intactas: **$265.526,99** total · **$163.195,80** julio.


---

*Generado: 2026-08-11 · tenant user_id=1 · `report_investigacion_tracker.py`*
