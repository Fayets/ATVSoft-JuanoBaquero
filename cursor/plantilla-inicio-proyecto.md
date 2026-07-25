# Plantilla: inicio de un nuevo sistema (frontend + backend)

Pegá o pasale este documento al asistente o al equipo al arrancar un proyecto desde cero. El objetivo es una estructura fija y predecible.

## 1. Carpetas raíz

En el directorio del repositorio (o del producto), crear:

- `frontend/`
- `backend/`

No mezclar ambos en la misma carpeta sin esos nombres.

## 2. Backend: raíz de `backend/`

En la **raíz** de `backend/` solo conviene tener el arranque de la API, dependencias y secretos de entorno:

- `main.py` — punto de entrada FastAPI (o el framework acordado), registro de routers, CORS, lifespan (`init_db`, etc.).
- `requirements.txt` — dependencias del backend.
- `.env.template` — plantilla **versionada** con los nombres de variables necesarios (sin valores secretos ni datos reales). Sirve de contrato para quien clone el repo.
- `.env` — archivo **local** copiado desde `.env.template` y completado por cada entorno; **no** versionar (agregar a `.gitignore` si aún no está).

**Importante:** el código de dominio, ORM y Pydantic vive en **`backend/src/`** como paquete Python `src` (ver sección 3). Los imports son siempre **`src.db`**, **`src.models`**, **`src.schemas`**, etc.

### Cómo ejecutar la API

Desde `backend/` (sin tocar `PYTHONPATH`):

```bash
cd backend
uvicorn main:app --reload
```

## 3. Backend: carpeta `src/`

Estructura obligatoria (alineada con este repositorio):

```text
backend/
  main.py
  requirements.txt
  .env.template
  .env            (solo local; no en el repo)
  src/
    __init__.py
    db.py
    models.py
    schemas.py
    services/
      __init__.py   (puede estar vacío)
    controllers/
      __init__.py   (puede estar vacío)
```

- `src/__init__.py` — marca `src` como paquete (puede estar vacío).
- `src/db.py` — instancia `Database` de Pony, `db.bind(...)` con variables desde `.env` (p. ej. con `python-decouple`), y función **`init_db()`** (import de entidades + `generate_mapping` cuando ya existan entidades).
- `src/models.py` — entidades Pony ORM (`db.Entity`); puede empezar vacío o con un esqueleto, pero el archivo debe existir desde el inicio del proyecto.
- `src/schemas.py` — modelos Pydantic para request/response.
- `src/services/` — lógica de negocio y acceso a datos con Pony (ver `docs/convenciones-backend-pony.md`).
- `src/controllers/` — routers HTTP delgados que delegan en los servicios.

**No** omitir `services/` ni `controllers/` dentro de `src/`.

## 4. Frontend: React con JavaScript, carpeta = raíz del proyecto

El proyecto de frontend debe vivir **directamente** dentro de `frontend/`. No está permitida una estructura del tipo `frontend/my-app/` como carpeta del código principal.

### Opción recomendada (Vite + React + JavaScript)

Desde la terminal, situarse en la carpeta que debe ser la raíz del frontend y generar el proyecto **en el directorio actual**:

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
```

Comprobar que `frontend/package.json` y `frontend/src/` existen en el primer nivel de `frontend/`, sin subcarpeta intermedia tipo `my-app`.

### Qué no hacer

- No ejecutar `create-vite` de forma que cree `frontend/nombre-app/` y deje el código dentro de ese subnivel, salvo que renombres y muevas todo a `frontend/` para cumplir la regla anterior.

## 5. Resumen de comprobación

- [ ] Existen `frontend/` y `backend/`.
- [ ] En `backend/` existen `main.py`, `requirements.txt`, `.env.template` (versionado) y `.env` (local, ignorado por git).
- [ ] En `backend/src/` existen `db.py`, `models.py`, `schemas.py`.
- [ ] Existen `backend/src/services/` y `backend/src/controllers/`.
- [ ] `src/` es un paquete (`__init__.py` en `src/`, `controllers/` y `services/` si aplica) y `uvicorn main:app` se ejecuta desde `backend/`.
- [ ] El frontend es React + JS y la app corre desde la raíz `frontend/` (sin carpeta extra tipo `my-app`).

Para reglas de código en backend (Pony, sesiones, controladores), usar en conjunto: `docs/convenciones-backend-pony.md`.
