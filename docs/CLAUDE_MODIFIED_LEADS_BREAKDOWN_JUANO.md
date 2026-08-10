## Resumen

- Leads con al menos un campo distinto (payload vs CSV): **53**
- Suma de diferencias por campo (un lead puede contar en varios): **170**

> Solo compara `legacy_lead_ref.payload` vs CSV. **No** incluye `lead.status` derivado.

## Por campo

| campo | leads | ejemplos BD → CSV |
|-------|------:|-------------------|
| presento | 28 | 'Por tomar' → 'No' — 'Por tomar' → 'No' — "''" → 'No' |
| situacion | 16 | 'Nuevo' → 'Canceló' — 'Nuevo' → 'Llamada Cancelada' — 'Nuevo' → 'Llamada Cancelada' |
| cierre | 0 | — |
| fecha_llamada | 1 | '2026-08-09' → '2026-08-10' |
| fecha_agenda | 0 | — |
| fecha (bot) | 3 | '2026-08-06' → "''" — '2026-08-06' → "''" — '2026-08-07' → '2026-08-08' |
| producto | 32 | "''" → 'Premium 6 meses' — "''" → 'Premium 6 meses' — "''" → 'Premium 6 meses' |
| calificado | 6 | 'Lead Calificado' → 'Lead No Calificado' — 'Lead Calificado' → 'Lead No Calificado' — 'Lead Calificado' → 'Lead No Calificado' |
| correo | 0 | — |
| telefono | 0 | — |
| tel_norm | 0 | — |
| nombre | 0 | — |
| closer | 20 | 'Catalina' → 'Catalina Zarlenga' — 'Catalina' → 'Catalina Zarlenga' — 'Catalina' → 'Catalina Zarlenga' |
| setter | 32 | "''" → 'Setter IA' — "''" → 'Setter IA' — "''" → 'Setter IA' |
| fuente | 32 | 'TU IMPERIO YOUTUBE | Calendario 2026' → 'Ads' — 'TU IMPERIO YOUTUBE | Calendario 2026' → 'Ads' — 'TU IMPERIO YOUTUBE | Calendario 2026' → 'Ads' |
| origen | 0 | — |
| ghl_contact_id | 0 | — |

## Ejemplos detallados (3 por campo con diferencias)

### presento (28 leads)

- `62c20233…` **Heyder Castro** — BD `Por tomar` → CSV `No`
- `8ba1e2b0…` **James Stiven** — BD `Por tomar` → CSV `No`
- `a84b4fb6…` **Johansen Hidalgo** — BD `''` → CSV `No`

### situacion (16 leads)

- `c70025e7…` **Anny Navarro** — BD `Nuevo` → CSV `Canceló`
- `a7e59c44…` **Jorge ruiz** — BD `Nuevo` → CSV `Llamada Cancelada`
- `a5ce62e2…` **Ronald Quevedo** — BD `Nuevo` → CSV `Llamada Cancelada`

### fecha_llamada (1 leads)

- `f48661ef…` **Santiago jimenez** — BD `2026-08-09` → CSV `2026-08-10`

### fecha (bot) (3 leads)

- `ce5b2fd6…` **Israel Nuñez** — BD `2026-08-06` → CSV `''`
- `48f0e8aa…` **Lida Yanet Moreno** — BD `2026-08-06` → CSV `''`
- `277cd35a…` **Lida maria tovar** — BD `2026-08-07` → CSV `2026-08-08`

### producto (32 leads)

- `62c20233…` **Heyder Castro** — BD `''` → CSV `Premium 6 meses`
- `8ba1e2b0…` **James Stiven** — BD `''` → CSV `Premium 6 meses`
- `a84b4fb6…` **Johansen Hidalgo** — BD `''` → CSV `Premium 6 meses`

### calificado (6 leads)

- `d9bfa8c3…` **Yuliana Uribe** — BD `Lead Calificado` → CSV `Lead No Calificado`
- `a7e59c44…` **Jorge ruiz** — BD `Lead Calificado` → CSV `Lead No Calificado`
- `777a6f5e…` **SANTIAGO VARGAS** — BD `Lead Calificado` → CSV `Lead No Calificado`

### closer (20 leads)

- `b8dedb23…` **Eusebio bravo** — BD `Catalina` → CSV `Catalina Zarlenga`
- `6fc2a386…` **Miguel Narvaez Lozano** — BD `Catalina` → CSV `Catalina Zarlenga`
- `482a3042…` **Jean Matos** — BD `Catalina` → CSV `Catalina Zarlenga`

### setter (32 leads)

- `62c20233…` **Heyder Castro** — BD `''` → CSV `Setter IA`
- `8ba1e2b0…` **James Stiven** — BD `''` → CSV `Setter IA`
- `a84b4fb6…` **Johansen Hidalgo** — BD `''` → CSV `Setter IA`

### fuente (32 leads)

- `62c20233…` **Heyder Castro** — BD `TU IMPERIO YOUTUBE | Calendario 2026` → CSV `Ads`
- `8ba1e2b0…` **James Stiven** — BD `TU IMPERIO YOUTUBE | Calendario 2026` → CSV `Ads`
- `a84b4fb6…` **Johansen Hidalgo** — BD `TU IMPERIO YOUTUBE | Calendario 2026` → CSV `Ads`

## Gap validate Presento Sí

CSV=`Sí` y payload≠`Sí`: verificar post-upsert con `validate_legacy_juano.py`.


---

*Generado: 2026-08-10 · tenant user_id=1 · `detect_modified_leads_breakdown.py`*
