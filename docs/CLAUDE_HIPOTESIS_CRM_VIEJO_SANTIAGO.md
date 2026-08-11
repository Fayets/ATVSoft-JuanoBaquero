## Resumen

El reporte de Santiago Torrico (**11/08**) probablemente refiere al **CRM legacy (`crm-juanovent` / Supabase `juano.leads`)**, no a ATV. Las etiquetas de su captura (`Contexto triaje`, `Contexto setter (pre call)`) **existen en el jsonb legacy** y **no existen en el repo ATV**.

Hallazgo ATV independiente: los 12 análisis Fathom están en **error** porque **nunca se configuró la API key de Claude** en `apiconnection` — la feature **nunca produjo contenido exitoso**.

## 1. Correspondencia captura ↔ CRM legacy

| Etiqueta captura Santiago | Clave jsonb `juano.leads.data` | En repo ATV |
|---|---|---|
| Contexto triaje | `contextoTriaje` | **No** |
| Contexto setter (pre call) | `contextoSetter` + `preCall` | **No** |
| ¿Se hizo triaje? | `triaje` / `triajeResultado` | Parcial (`triaje_hecho` bool, distinto UX) |
| Links Fathom | `linkLlamada` | Sí (`lead.link_llamada`) |
| Contexto closer | `contextoCloser` | **No** |

**Indicio:** Santiago Torrico aparece como closer en datos legacy (Top Closers del dashboard anterior, ~39 cierres).

**Conclusión probable:** está en `crm-juanovent`, no en ATV. Explica por qué ATV no perdió filas y por qué la UI de la captura no coincide con ninguna vista del repo.

## 2. Verificación Supabase legacy — PENDIENTE operador

Proyecto: **`crm-juanovent`** · schema **`juano`** · SQL Editor · solo lectura.

```sql
SELECT
  COUNT(*)                                                           AS total,
  COUNT(*) FILTER (WHERE COALESCE(data->>'linkLlamada','')    <> '') AS con_link,
  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoSetter','') <> '') AS con_ctx_setter,
  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoTriaje','') <> '') AS con_ctx_triaje,
  COUNT(*) FILTER (WHERE COALESCE(data->>'contextoCloser','') <> '') AS con_ctx_closer,
  COUNT(*) FILTER (WHERE COALESCE(data->>'preCall','')        <> '') AS con_precall
FROM juano.leads;
```

Si esos campos están vacíos o casi vacíos en Supabase, el problema es **del CRM del cliente**, no de ATV. Nosotros solo corrimos SELECT contra Supabase en migración; Neon ATV creció, nunca bajó.

*No se corrió desde Cursor: falta `SUPABASE_DB_URL` en el entorno.*

## 3. Verificación ATV — Claude / Fathom (Neon production)

### `call_report` histórico (user_id=1)

| estado | count | desde | hasta |
|---|---:|---|---|
| `error` | **12** | 2026-07-27 | 2026-08-11 |

**Reportes exitosos (estado ≠ error/pendiente): 0.** Nunca hubo análisis Fathom completado en ATV.

**Links Fathom en `lead.link_llamada`:** **12** (intactos).

**Error en todos:** `Configurá tu API key de Claude en Conexiones API antes de analizar llamadas.`

### `apiconnection` (user_id=1)

| platform | updated_at |
|---|---|
| `_avatar_defaults_seeded` | None |
| `calendly` | 2026-07-27 21:01:08.324969 |
| `ghl` | 2026-08-11 13:04:32.310158 |

**No existe fila `platform='claude'`.** La key nunca fue guardada en Conexiones → el análisis Fathom **nunca estuvo operativo**; no es un borrado reciente.

## 4. ATV — sin pérdida de filas (reconfirmado)

| Métrica | Branch 10/08 | Production |
|---|---:|---:|
| `call_report` | 9 | **12** |
| `closer_report` | 11 | **17** |
| `setter_report` | 0 | **0** |
| leads `link_llamada` | 9 | **12** |
| audit import vaciados | — | **0** |

## 5. Deploy

- GitHub **`master`**: `ff29c43` (fix dashboard cash incluido)
- VPS `72.60.244.220`: **no verificado** (SSH timeout desde Cursor)
- Confirmar: `git log -1 --oneline` + docker rebuild en VPS

## 6. Orden de acciones

| # | Acción | Estado |
|---:|---|---|
| 1 | Pedir **URL** a Santiago (define si es CRM viejo o ATV) | 🔴 pendiente cliente |
| 2 | Contar campos legacy en Supabase (query §2) | 🔴 pendiente operador |
| 3 | Histórico `call_report` | ✅ **0 exitosos, 12 error** |
| 4 | Configurar Claude en Conexiones + re-procesar 12 reportes | 🟡 mejora ATV real |
| 5 | Verificar versión VPS vs `ff29c43` | 🟡 pendiente operador |
| 6 | Diff branch Neon vs production | ⏸️ **pausado** hasta confirmar sistema |
| 7 | Upsert leads pendiente | ⏸️ sigue en pausa |

## 7. Mensaje sugerido para Santiago

> Bro, revisamos y en la base de ATV no se borró nada — los datos están y se siguieron cargando normal.
>
> Pasame el **link de la pantalla** donde lo viste (copiá la URL del navegador) y el **nombre de un cliente puntual**. Con eso lo ubico enseguida.

Si la URL es del CRM viejo (`crm-juanovent`), el análisis pasa a Supabase legacy, no a Neon.

Ver también: `docs/CLAUDE_INVESTIGACION_TRACKER_SANTIAGO.md`.


---

*Generado: 2026-08-11 · tenant user_id=1 · `report_hipotesis_crm_viejo.py`*
