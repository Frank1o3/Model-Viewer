# Workspace Context

Generated: 2026-04-05T13:49:44.756Z
Files indexed: 17

## File Structure

- `.mypy.ini` — Mypy configuration file
- `context.md` — Project documentation and configuration for a modular 3D model viewer and physics simulation application.
- `REFACTORING_SUMMARY.md` — Refactoring of monolithic app.js into modular components with optional Python/numpy-backed physics computation.
- `.ruff.toml` — Ruff configuration file for code linting and formatting
- `system.md` — System documentation guidelines for code development and testing
- `README.md` — Project documentation file
- `src/model_view/physics_api.py` — Physics API endpoints for advanced numpy-based physics computations.
- `src/model_view/main.py` — FastAPI application setup with physics API and static file serving
- `src/model_view/cli.py` — Run Uvicorn server for development or production
- `pyproject.toml` — Project configuration for model-view application
- `src/static/js/app.js` — Large file (33KB), skipped for LLM summarization.
- `src/static/style.css` — Stylesheet for a web application with custom UI components and typography
- `src/site/index.html` — Web application for 3D model viewer and physics simulation
- `src/static/js/modules/loader.js` — Loader module for 3D model and texture management
- `src/static/js/modules/physics.js` — Physics module for Spring Bones and Soft Body simulations
- `src/static/js/modules/scene.js` — Three.js scene setup and management module
- `src/static/js/modules/ui.js` — User Interface Management module for a 3D application

## Detailed Summaries

### `.mypy.ini`

**Purpose:** Mypy configuration file

**Key elements:**
- `mypy`
- `mypy-tests`
- `mypy-fastapi`
- `mypy-uvicorn`

**Dependencies:**
- `mypy`

### `context.md`

**Purpose:** Project documentation and configuration for a modular 3D model viewer and physics simulation application.

**Key elements:**
- `initScene`
- `addStandardLighting`
- `paintVertices`
- `SpringBone`
- `SoftBodyGroup`
- `PythonPhysicsBackend`
- `UIManager`
- `showToast`
- `VertexData`
- `compute_soft_body_physics`
- `compute_spring_bones`
- `physics_status`
- `advanced_paint_physics`
- `root_get`
- `health`
- `physics_router`
- `app`
- `logger`
- `site_path`
- `static_path`
- `CORSMiddleware`
- `UIManager`
- `showToast`
- `sliderVal`
- `linkSlider`
- `showLoading`
- `updateTexCount`

**Dependencies:**
- `numpy`
- `Three.js`
- `FastAPI`
- `pycodestyle`
- `pyflakes`
- `importlib`
- `importlib_metadata`
- `importlib_resources`
- `Mocha`
- `Jest`
- `pytest`
- `npm`
- `yarn`
- `pip`
- `cargo`
- `go mod`
- `fastapi`
- `pydantic`
- `uvicorn`
- `logging`
- `pathlib`
- `model_view.physics_api`
- `poetry-core`
- `three`
- `three/addons/`

### `REFACTORING_SUMMARY.md`

**Purpose:** Refactoring of monolithic app.js into modular components with optional Python/numpy-backed physics computation.

**Key elements:**
- `initScene`
- `addStandardLighting`
- `paintVertices`
- `SpringBone`
- `SoftBodyGroup`
- `PythonPhysicsBackend`
- `UIManager`
- `showToast`

**Dependencies:**
- `numpy`
- `Three.js`
- `FastAPI`

### `.ruff.toml`

**Purpose:** Ruff configuration file for code linting and formatting

**Key elements:**
- `select`
- `ignore`
- `combine-as-imports`
- `force-sort-within-sections`
- `known-first-party`
- `per-file-ignores`
- `quote-style`
- `indent-style`

**Dependencies:**
- `pycodestyle`
- `pyflakes`
- `isort`
- `pyupgrade`
- `bugbear`
- `simplify`
- `comprehensions`
- `ruff`

### `system.md`

**Purpose:** System documentation guidelines for code development and testing

**Key elements:**
- `read_request`
- `write_code`
- `edit_file`
- `add_comments`
- `generate_typescript`
- `generate_python`
- `write_tests`
- `run_commands`

**Dependencies:**
- `Mocha`
- `Jest`
- `pytest`
- `npm`
- `yarn`
- `pip`
- `cargo`
- `go mod`

### `README.md`

**Purpose:** Project documentation file

### `src/model_view/physics_api.py`

**Purpose:** Physics API endpoints for advanced numpy-based physics computations.

**Key elements:**
- `VertexData`
- `SoftBodyRequest`
- `BoneData`
- `SpringBoneRequest`
- `compute_soft_body_physics`
- `compute_spring_bones`
- `physics_status`
- `advanced_paint_physics`

**Dependencies:**
- `fastapi`
- `pydantic`
- `numpy`

### `src/model_view/main.py`

**Purpose:** FastAPI application setup with physics API and static file serving

**Key elements:**
- `FastAPI`
- `CORSMiddleware`
- `GZipMiddleware`
- `FileResponse`
- `StaticFiles`
- `physics_router`
- `root_get`
- `health`

**Dependencies:**
- `fastapi`
- `fastapi.middleware.cors`
- `fastapi.middleware.gzip`
- `fastapi.responses`
- `fastapi.staticfiles`
- `model_view.physics_api`

### `src/model_view/cli.py`

**Purpose:** Run Uvicorn server for development or production

**Key elements:**
- `dev`
- `prod`

**Dependencies:**
- `uvicorn`

### `pyproject.toml`

**Purpose:** Project configuration for model-view application

**Key elements:**
- `model_view.cli:dev`
- `model_view.cli:prod`

**Dependencies:**
- `fastapi`
- `uvicorn`
- `numpy`
- `poetry-core`
- `pytest`
- `pytest-cov`
- `pytest-mock`

### `src/static/js/app.js`

**Purpose:** Large file (33KB), skipped for LLM summarization.

### `src/static/style.css`

**Purpose:** Stylesheet for a web application with custom UI components and typography

**Key elements:**
- `#app`
- `#sidebar`
- `#sb-header`
- `.logo`
- `.sb-title`
- `#nav-tabs`
- `.nav-tab`
- `.pill-btn`

**Dependencies:**
- `https://fonts.googleapis.com/css2`

### `src/site/index.html`

**Purpose:** Web application for 3D model viewer and physics simulation

**Key elements:**
- `app`
- `sidebar`
- `panel-view`
- `panel-bones`
- `panel-physics`
- `canvas`
- `loading`
- `hud`

**Dependencies:**
- `three`
- `three/addons/`

### `src/static/js/modules/loader.js`

**Purpose:** Loader module for 3D model and texture management

**Key elements:**
- `texRegistry`
- `registerTextureFiles`
- `fixMaterials`
- `loadModel`
- `normalizeModel`
- `extractBones`
- `buildBoneTree`

**Dependencies:**
- `three`
- `three/addons/loaders/FBXLoader.js`
- `three/addons/loaders/GLTFLoader.js`

### `src/static/js/modules/physics.js`

**Purpose:** Physics module for Spring Bones and Soft Body simulations

**Key elements:**
- `SpringBone`
- `SoftBodyGroup`
- `paintVertices`

**Dependencies:**
- `three`

### `src/static/js/modules/scene.js`

**Purpose:** Three.js scene setup and management module

**Key elements:**
- `initScene`
- `addStandardLighting`
- `addGrid`
- `fitCameraToObject`
- `addFog`
- `addMeshToScene`
- `addTextureToScene`
- `getMeshes`

**Dependencies:**
- `three`
- `three/addons/controls/OrbitControls.js`

### `src/static/js/modules/ui.js`

**Purpose:** User Interface Management module for a 3D application

**Key elements:**
- `UIManager`
- `showToast`
- `sliderVal`
- `linkSlider`
- `showLoading`
- `updateTexCount`

**Dependencies:**
- `three`
