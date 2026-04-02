# App.js Refactoring & Python Physics Backend

## Overview
This refactoring splits the monolithic `app.js` (1074 lines) into modular components and adds optional Python/numpy-backed physics computation for better performance.

## New Structure

### JavaScript Modules (`/workspace/src/static/js/`)

```
src/static/js/
├── app.js              # Main application entry point (447 lines)
└── modules/
    ├── scene.js        # Three.js scene setup & management (124 lines)
    ├── loader.js       # Model & texture loading (168 lines)
    ├── physics.js      # Physics classes & Python backend client (278 lines)
    └── ui.js           # UI management utilities (169 lines)
```

### Python Backend (`/workspace/src/model_view/`)

```
src/model_view/
├── main.py             # FastAPI app with physics routes included
└── physics_api.py      # NumPy-backed physics computation endpoints
```

## Module Breakdown

### 1. **scene.js** - Scene Management
- `initScene()` - Creates renderer, scene, camera, controls
- `addStandardLighting()` - Adds three-point lighting setup
- `addGrid()` - Adds grid helper
- `fitCameraToObject()` - Auto-framing for loaded models
- `addFog()` - Scene fog effect

### 2. **loader.js** - Model Loading
- `texRegistry` - Global texture cache
- `registerTextureFiles()` - Register textures for later use
- `fixMaterials()` - Fix material properties after loading
- `loadModel()` - Load FBX/GLTF models with progress tracking
- `normalizeModel()` - Scale and center models in scene
- `extractBones()` - Extract bone hierarchy from model
- `buildBoneTree()` - Build tree structure for UI

### 3. **physics.js** - Physics Simulation
- `SpringBone` class - Bone-based spring physics
- `SoftBodyGroup` class - Vertex-based soft body simulation
- `paintVertices()` - Visibility-aware vertex painting
- `PythonPhysicsBackend` class - Optional numpy backend client

### 4. **ui.js** - User Interface
- `UIManager` class - Panel/tab navigation
- `showToast()` - Toast notifications
- `sliderVal()` / `linkSlider()` - Slider utilities
- `initBrushCursor()` / `updateBrushCursor()` - Brush cursor
- `showLoading()` - Loading indicator
- `updateTexCount()` / `updateViewCount()` - Status displays

### 5. **app.js** - Main Application
The new app.js is the orchestrator that:
- Imports all modules
- Initializes scene and UI
- Manages application state
- Handles user interactions
- Runs animation loop

## Python Physics Backend

### API Endpoints

#### `POST /api/physics/compute`
Compute soft body physics using numpy arrays.
```json
{
  "vertices": [
    {"position": [x,y,z], "offset": [ox,oy,oz], "velocity": [vx,vy,vz]}
  ],
  "stiffness": 20.0,
  "damping": 6.0,
  "dt": 0.016
}
```

#### `POST /api/physics/spring`
Compute spring bone physics.
```json
{
  "bones": [
    {
      "uuid": "...",
      "offset_euler": [ex,ey,ez],
      "velocity": [vx,vy,vz],
      "stiffness": 12.0,
      "damping": 5.0,
      "gravity": 0.0
    }
  ],
  "dt": 0.016
}
```

#### `POST /api/physics/paint-advanced`
Advanced visibility-aware painting computation.

#### `GET /api/physics/status`
Check if numpy backend is available.

## Key Features

### 1. **Modular Architecture**
- Clean separation of concerns
- Easier to maintain and extend
- Each module has a single responsibility

### 2. **Visibility-Aware Painting**
The new `paintVertices()` function respects mesh occlusion:
- Raycasts to find visible surface first
- Only paints vertices on the hit mesh
- Hidden meshes behind are not affected

### 3. **Optional Python Backend**
For advanced physics needs:
- Uses numpy for vectorized operations (faster for large vertex counts)
- Falls back gracefully to JavaScript if unavailable
- Adds network latency but enables more complex simulations

### 4. **Future: Anchor-Type Painting**
The architecture supports future implementation of:
- Paint through multiple layers
- Exclude specific meshes (anchor type)
- Smart selection based on normals

## Usage

### Enable Python Physics Backend
In the browser console or code:
```javascript
window.app.pythonPhysics.enabled = true;
```

### Check Backend Status
```javascript
fetch('/api/physics/status')
  .then(r => r.json())
  .then(data => console.log('NumPy available:', data.numpy_available));
```

## Dependencies Added

- `numpy >=1.26.0` - For server-side physics computation

## Migration Notes

The old `app.js` (1074 lines) has been replaced with:
- New modular `app.js` (447 lines) 
- Four focused modules totaling ~739 lines
- Better organization and easier debugging
- Same functionality, improved architecture

## Testing

Run the application:
```bash
cd /workspace
poetry install  # Install numpy dependency
poetry run dev  # Start development server
```

Visit `http://localhost:8000` to test.

## Future Enhancements

1. **WebWorker Physics**: Move JS physics to WebWorker for non-blocking
2. **GPU Acceleration**: Use WebGL compute shaders for massive parallelism
3. **Advanced Painting**: Implement anchor-type exclusion system
4. **Multi-layer Support**: Paint through transparent/hidden meshes
5. **Physics Presets**: Save/load physics configurations
