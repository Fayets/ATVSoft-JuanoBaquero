# Backfill programa desde payload

Modo: **APLICADO**

- Actualizados (payload o CSV vía legacy_id): **2**
- Omitidos (ya tenían programa, p. ej. backfill pagos): **217**
- Omitidos (sin producto en payload): **936**

> Solo rellena `programa_ofrecido` **vacío**. No pisa los 79 del backfill por pagos.

### Muestra

| lead_id | nombre | programa_ofrecido | fuente |
|--------:|--------|-------------------|--------|
| 6934 | Santiago Monares | Premium 6 meses | csv |
| 6951 | Lida maria tovar | Premium 6 meses | csv |

---

*Generado: 2026-08-10 · tenant user_id=1 · `backfill_programa_from_payload.py`*
