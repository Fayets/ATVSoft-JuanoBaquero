# Typos TeamMember, triajers y citas GHL sin closer — juano

**Tenant:** `user_id = 1`  
**Estado:** Typos **APLICADOS** · Diagnóstico §3 **COMPLETO** · Recuperación §15 **PENDIENTE**  
**Fecha:** 2026-08-12  
**Spec origen:** `fix-typos-triajers-sync.md` (Desktop operador)  
**Relacionado:** `docs/CLAUDE_UNIFICAR_CLOSERS_DUPLICADOS_JUANO.md`

---

## 1. Typos TeamMember — APLICADO ✅

| id | Antes | Después | Fuente |
|---:|---|---|---|
| 14 | `Ignacio Claveira` | **`Ignacio Claveria`** | GHL |
| 12 | `Martin Jácome` | **`Martín Jácome`** | GHL |

**Verificación duplicados:**

```sql
SELECT nombre, COUNT(*) FROM teammember
WHERE user_id = 1 GROUP BY 1 HAVING COUNT(*) > 1;
-- 0 filas ✅
```

**Script:** `scripts/fix_teammember_typos.py --yes`

**Impacto:** `closer_report_auto_service.find_closer_member()` matchea `TeamMember.nombre` contra `lead.closer` por texto exacto (case-insensitive). Con el typo, reportes de Ignacio y Martín **nunca se generaban** aunque las llamadas existieran.

---

## 2. Triajers — respuestas §2 (4 preguntas)

### Estado actual en BD (actualizado vs spec)

El spec decía que no había triajers en Equipo. **Hoy sí existen:**

| id | nombre | rol |
|---:|---|---|
| 10 | `Alonso` | triajer |
| 11 | `Shariff` | triajer |

Distribución en leads: **188 / 188** cada uno desde ~01/08.

### 2.1 — ¿La UI permite crear miembro con rol `triajer`?

**Sí.** Pantalla **Equipo → Editar equipo** (`/team/equipo`):

- Botón **+ Triajer**
- POST `/api/team/members` con `{ nombre, rol: "triajer" }`

### 2.2 — ¿Qué roles admite?

Enum backend `VALID_ROLES` en `team_controller.py`:

`setter` · `closer` · `cash` · `triajer`

Modelo Pony: `# 'setter' | 'closer' | 'cash' | 'triajer'`

### 2.3 — ¿Al cargar "Alonso" se vinculan las 188 llamadas?

**No hay FK.** El vínculo es **texto en `lead.triajer`**.

| Mecanismo | Match |
|---|---|
| Round-robin (`pick_next_triajer`) | Escribe el nombre **exacto** del `TeamMember` |
| Conteo de carga (`_counts_by_triad`) | **Case-insensitive** (`casefold`) |
| Panel diario (dropdown) | **Case-insensitive** al mostrar; guarda el string elegido |
| Leads existentes | **No se reescriben** al crear el miembro |

Si ya existen 188 filas con `triajer = 'Alonso'` y el miembro se llama **`Alonso`** → matchean en conteo y UI.

⚠️ **Si cargan `Alonso Mejía` o `Shariff S` (como en GHL):** las 376 llamadas existentes **NO matchean**. Hay que usar **`Alonso`** y **`Shariff`** a secas, o renombrar el miembro para coincidir con lo ya escrito en leads.

### 2.4 — ¿Qué habilita tener triajer en Equipo?

| Función | Requiere TeamMember triajer |
|---|---|
| Asignación auto round-robin (GHL sync, Calendly, manual call) | **Sí** — sin miembros triajer, `pick_next_triajer()` devuelve `""` |
| Botón **Asignar triajers** (panel diario) | **Sí** — POST `/leads/asignar-triajers-dia` |
| Dropdown triajer en tabla del panel | Lista desde GET `/team/members` → `triajers[]` |
| Reportes closer/setter | **No** — triajer no entra en `CloserReport` / `SetterReport` |

---

## 3. Diagnóstico §3 — citas GHL sin closer

### 3.1 — Jose Ortiz / Martín Jácome (caso confirmado GHL)

**GHL (operador):** Jose Ortiz · 11/08/2026 09:00 (-05) · responsable **Martín Jácome**

**ATV — búsqueda `%ortiz%` OR `call::date = 2026-08-11`:**

Lead relevante encontrado:

| Campo | Valor |
|---|---|
| **id** | 7022 |
| **nombre** | `Jose ortiz` |
| **email** | joseph12saika@gmail.com |
| **call** | 2026-08-11 **14:00** UTC (= 09:00 Colombia) |
| **closer** | **`Agustín Olivero`** ← no vacío, no Martín |
| **triajer** | Shariff |
| **ghl_appointment_id** | `guLCqReFbgEq8S9dvase` |
| **source** | atv |
| **created_at** | 2026-08-11 00:14 |

**Lectura:**

- La cita **sí llegó** a ATV (misma ventana horaria 09:00 CO).
- **No es un caso de closer vacío** — es **closer incorrecto** (Agustín vs Martín).
- **`Martín Jácome` tiene 0 llamadas** en todo el histórico.

**Hipótesis operador (typo TeamMember → closer vacío en sync):** **NO aplica** a este lead (tiene closer) ni al mecanismo de sync (ver 3.3).

---

### 3.2 — Las ~15 citas con `ghl_appointment_id` y closer vacío

**Total: 15** (no más en este momento)

| id | nombre | call | ghl_appointment_id | created_at |
|---:|---|---|---|---|
| 551 | Angel Ramírez | 2026-07-01 14:00 | f9tmTKaAvRra… | **2026-07-25 02:54** |
| 552 | Alexander Montoya | 2026-07-01 15:15 | y8ORU7nyoX5E… | 2026-07-25 02:54 |
| … | … | 2026-07-01 – 03 | … | **2026-07-25 02:54–03:49** |
| 1458–1473 | varios | **2026-07-25** | … | 2026-07-25 03:49 |

**Patrón:**

- **100% `source = atv`**
- **100% creadas el 2026-07-25** entre 02:54 y 03:49 UTC → **batch de sync GHL masivo**
- Fechas de llamada: julio 1–3 y julio 25 (no distribuidas en el tiempo)
- **No hay citas recientes** (ago-11) en este bucket

**Lectura:** fallo **puntual/histórico** del bulk sync del 25-jul, **no un bug activo continuo** que siga generando huérfanas hoy. El caso Jose Ortiz es otro patrón (closer mal asignado).

---

### 3.3 — Código: `_ghl_owner_from_sync` y webhook

**Sync manual/auto** (`ghl_controller.py`):

```
assignedUserId → GET /users/{id} → _ghl_person_display_name()
fallback: contact.assignedTo → misma API
```

- **No consulta `TeamMember`**
- Si la API falla: log `[ghl] no se pudo resolver user {id}` y devuelve **`""`**
- `_apply_appointment_to_lead`: si `closer=""`, **no pisa** closer existente; lead nuevo queda sin closer

**Webhook** (`_ghl_owner_from_webhook_body`):

- Lee nombres embebidos en payload (`body.user`, `calendar.user`, etc.)
- **No llama API** de usuarios si el payload trae solo un ID

**Hipótesis spec (typo TeamMember → closer vacío en sync):** **REFUTADA**

| Componente | Usa TeamMember |
|---|---|
| Sync GHL closer | ❌ API GHL |
| Webhook closer | ❌ payload |
| Reporte closer auto | ✅ `find_closer_member` vs `TeamMember.nombre` |

**Corregir typos §1 arregla reportes**, no necesariamente el closer en sync. Las 15 huérfanas probablemente tuvieron `assignedUserId` sin resolver en batch (API error, permisos, o evento sin owner).

**Caso Jose Ortiz:** sync **sí** resolvió un nombre, pero **otro closer** (Agustín). Investigar si `assignedUserId` en GHL para esa cita apunta a Agustín o si hubo reasignación post-sync.

---

## 4. Martín Jácome — §4

1 cita en GHL, **0 en ATV con closer Martín**. El lead Jose Ortiz del 11/08 tiene closer Agustín → caso puntual del §3.1, no volumen perdido masivo.

---

## 5. Orden de ejecución

| # | Acción | Estado |
|---|---|---|
| 1 | Corregir 2 typos TeamMember | ✅ **APLICADO** |
| 2 | Diagnóstico 3.1, 3.2, 3.3 | ✅ **Este reporte** |
| 3 | Responder 4 preguntas triajers | ✅ **§2** |
| 4 | **PARAR** | 🛑 **Acá** |
| 5 | Recuperación ~15 citas | ⏸️ Pendiente decisión |

---

## 6. Anclas

| Check | Resultado |
|---|---:|
| Pagos legacy | 362 / $265.526,99 ✅ |
| links_con_link | 356 ✅ |

---

## 7. Decisiones para Claude / operador

1. **Recuperación 15 citas (jul-25 batch):** ¿script API GHL o corrección manual? Son históricas, no urgentes.
2. **Jose Ortiz / Martín:** ¿Consultar en GHL el `assignedUserId` de `guLCqReFbgEq8S9dvase` y corregir closer a mano a `Martín Jácome`?
3. **Triajers:** Confirmar al cliente cargar **`Alonso`** y **`Shariff`** (sin apellido), no nombres GHL completos.
4. **¿Regenerar reportes closer** de Ignacio/Martín para fechas pasadas tras fix typo?

---

## 8. Scripts

```bash
cd backend
python ../scripts/fix_teammember_typos.py --dry-run
python ../scripts/fix_teammember_typos.py --yes
python ../scripts/diagnose_ghl_sin_closer.py
```

---

*Generado: 2026-08-12 · tenant user_id=1*
