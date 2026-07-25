# Convenciones backend: Pony ORM, servicios y controladores

Este documento define cómo debe estructurarse el backend para que sea consistente entre proyectos. Está alineado con el patrón usado en este repositorio (por ejemplo `ventas_controller` y `VentasServices`).

## 1. ORM: Pony obligatorio

- La persistencia y las consultas a la base de datos se hacen con **Pony ORM**.
- Los modelos (entidades) se definen con la API de Pony (`Database`, entidades con relaciones, etc.) y se enlazan en `src/db.py` (o el módulo que centralice `db.bind(...)`), con las entidades declaradas en `src/models.py` según la plantilla de `docs/plantilla-inicio-proyecto.md`.
- No mezclar otro ORM en la misma capa de dominio salvo decisión explícita del proyecto.

## 2. Servicios (`src/services/`)

### Responsabilidad

- Toda la lógica de negocio y el acceso a datos con Pony viven en **clases de servicio** (por ejemplo `VentasServices`, `ProductServices`).
- Los servicios conocen los `models`, los `schemas` (Pydantic) y lanzan `HTTPException` de FastAPI cuando corresponda (404, 400, etc.).

### Sesión de base de datos: `db_session`

Pony expone `db_session` (desde `pony.orm`). Las funciones/métodos del servicio que lean o escriban en la base deben ejecutarse dentro de un contexto de sesión:

```python
from pony.orm import db_session

class VentasServices:
    def get_venta_by_id(self, venta_id: int):
        with db_session:
            # consultas y armado del resultado (dict o schema)
            ...
```

Reglas prácticas:

- Usar `with db_session:` alrededor del bloque que toca entidades Pony (consultas, bucles sobre relaciones, commits implícitos, etc.).
- Evitar abrir sesiones en el controlador; el **servicio** es quien delimita `db_session` para mantener una sola capa responsable del ciclo de vida ORM.

### Nombres y archivos

- Un archivo por dominio o agregado razonable, por ejemplo `ventas_services.py`, `product_services.py`.
- Clase en `PascalCase` + sufijo `Services` si se sigue la convención del proyecto.

## 3. Controladores (`src/controllers/`)

### Responsabilidad

- Los controladores definen rutas (por ejemplo `APIRouter`), dependencias (`Depends`), validación de permisos o parámetros HTTP.
- **No** deben contener consultas Pony ni `with db_session` directamente para lógica de dominio.
- Deben **llamar solo a métodos del servicio** que encapsulan esa lógica.

### Patrón de referencia: `get_venta`

El controlador instancia (o recibe) el servicio y delega. El manejo de errores HTTP se relanza; el resto puede mapearse a 500 genérico.

Ejemplo del estilo esperado (equivalente al de `ventas_controller.py`):

```python
from fastapi import APIRouter, Depends, HTTPException
from src.services.ventas_services import VentasServices

router = APIRouter()
service = VentasServices()


@router.get("/get/{venta_id}", response_model=schemas.VentaResponse)
def get_venta(venta_id: int, current_user=Depends(get_current_user)):
    try:
        venta_data = service.get_venta_by_id(venta_id)
        return venta_data
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(status_code=500, detail="Error inesperado al obtener la venta.")
```

Puntos clave:

1. `get_venta` no accede a `models.Venta` ni a Pony.
2. Toda la lectura y el armado del dict/respuesta ocurre en `service.get_venta_by_id(...)`, dentro de `with db_session` en el servicio.
3. El controlador solo orquesta HTTP + auth + respuesta.

## 4. Flujo resumido

```text
HTTP  →  controller (router, Depends, HTTPException)
           ↓
        service.method()  →  with db_session:  →  Pony models / lógica
           ↓
        return dict / schema  →  response_model en la ruta
```

## 5. `main.py` y `schemas`

- `main.py`: montar la app, incluir routers desde `src.controllers`, middleware mínimo.
- `src/schemas.py`: contratos Pydantic; el servicio puede devolver estructuras compatibles con esos schemas.
- Si en algún momento hace falta un módulo compartido de acceso a datos (p. ej. `src/crud.py`), agregarlo solo cuando exista lógica reutilizable; por defecto la persistencia vive en los servicios.

## 6. Integraciones externas (IA, APIs HTTP, sin Pony)

Cuando un agregado llama a un **proveedor externo** (p. ej. Anthropic Claude) y **no** usa Pony:

- Igual: **`nombre_services.py`** + clase **`NombreServices`** en `src/services/`.
- Igual: **`nombre_controller.py`** en `src/controllers/` con `APIRouter`, **solo delegación** en métodos del servicio y el patrón `try` / `except HTTPException as e: raise e` / `except Exception: HTTPException(500, ...)`.
- Los contratos Pydantic siguen en **`src/schemas.py`** (o convención acordada de módulos de schemas). El **servicio** importa esos schemas y devuelve instancias compatibles (`VentaResponse`, `ClaudeGenerationResponse`, etc.), no armar respuestas HTTP en el controlador más allá del `response_model`.
- **No** hace falta `db_session` en esos métodos; la regla de `db_session` aplica solo donde se toquen entidades Pony.

---

Al iniciar un proyecto nuevo, combinar este archivo con `docs/plantilla-inicio-proyecto.md` para la estructura de carpetas y el frontend en `frontend/` con React (JS).
