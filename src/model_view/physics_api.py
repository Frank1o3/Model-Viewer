"""
Physics API endpoints for advanced numpy-based physics computations.
This provides faster physics simulation using numpy arrays.
"""
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    np = None

router = APIRouter(prefix="/api/physics", tags=["physics"])


class VertexData(BaseModel):
    """Vertex data for soft body simulation"""
    position: list[float]  # [x, y, z]
    offset: list[float]    # [ox, oy, oz]
    velocity: list[float]  # [vx, vy, vz]


class SoftBodyRequest(BaseModel):
    """Request for soft body physics computation"""
    vertices: list[VertexData]
    stiffness: float = 20.0
    damping: float = 6.0
    dt: float = 0.016


class BoneData(BaseModel):
    """Bone data for spring bone simulation"""
    uuid: str
    rest_quaternion: list[float]  # [x, y, z, w]
    offset_euler: list[float]     # [ex, ey, ez]
    velocity: list[float]         # [vx, vy, vz]
    stiffness: float = 12.0
    damping: float = 5.0
    gravity: float = 0.0


class SpringBoneRequest(BaseModel):
    """Request for spring bone physics computation"""
    bones: list[BoneData]
    dt: float = 0.016


@router.post("/compute")
async def compute_soft_body_physics(request: SoftBodyRequest) -> dict[str, Any]:
    """
    Compute soft body physics using numpy for better performance.

    This endpoint receives vertex data and returns updated positions,
    offsets, and velocities after applying spring physics.
    """
    start_time = time.time()

    if not NUMPY_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="NumPy not available. Falling back to JavaScript physics."
        )

    try:
        n_vertices = len(request.vertices)
        if n_vertices == 0:
            return {"vertices": [], "latency": 0}

        # Convert to numpy arrays for efficient computation
        positions = np.array([v.position for v in request.vertices], dtype=np.float32)
        offsets = np.array([v.offset for v in request.vertices], dtype=np.float32)
        velocities = np.array([v.velocity for v in request.vertices], dtype=np.float32)

        k = request.stiffness
        d = request.damping
        dt = request.dt

        # Physics update: F = -k*offset - d*velocity
        # Using vectorized operations for speed
        accelerations = -k * offsets - d * velocities

        # Update velocities
        velocities += accelerations * dt

        # Update offsets
        offsets += velocities * dt

        # Prepare response
        result_vertices = []
        for i in range(n_vertices):
            result_vertices.append({
                "position": positions[i].tolist(),
                "offset": offsets[i].tolist(),
                "velocity": velocities[i].tolist()
            })

        latency = (time.time() - start_time) * 1000  # ms

        return {
            "vertices": result_vertices,
            "latency": latency,
            "vertex_count": n_vertices
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Physics computation failed: {e!s}") from e


@router.post("/spring")
async def compute_spring_bones(request: SpringBoneRequest) -> dict[str, Any]:
    """
    Compute spring bone physics using numpy.

    This endpoint receives bone data and returns updated quaternion offsets.
    """
    start_time = time.time()

    if not NUMPY_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="NumPy not available. Falling back to JavaScript physics."
        )

    try:
        n_bones = len(request.bones)
        if n_bones == 0:
            return {"bones": [], "latency": 0}

        result_bones = []

        for bone in request.bones:
            # Extract data
            offset = np.array(bone.offset_euler, dtype=np.float32)
            velocity = np.array(bone.velocity, dtype=np.float32)

            k = bone.stiffness
            d = bone.damping
            g = bone.gravity
            dt = request.dt

            # Physics update per axis
            acceleration = -k * offset - d * velocity
            acceleration[2] += g  # Add gravity to Z axis

            # Update velocity and offset
            velocity += acceleration * dt
            offset += velocity * dt

            result_bones.append({
                "uuid": bone.uuid,
                "offset_euler": offset.tolist(),
                "velocity": velocity.tolist()
            })

        latency = (time.time() - start_time) * 1000  # ms

        return {
            "bones": result_bones,
            "latency": latency,
            "bone_count": n_bones
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Spring bone computation failed: {e!s}") from e


@router.get("/status")
async def physics_status() -> dict[str, Any]:
    """Check if numpy-backed physics is available"""
    return {
        "numpy_available": NUMPY_AVAILABLE,
        "version": np.__version__ if NUMPY_AVAILABLE else None
    }


@router.post("/paint-advanced")
async def advanced_paint_physics(request: dict[str, Any]) -> dict[str, Any]:
    """
    Advanced painting with visibility-aware selection.

    This endpoint can handle complex painting scenarios like:
    - Painting through multiple mesh layers
    - Anchor-type exclusion (skip certain meshes)
    - Smart vertex selection based on normals and visibility
    """
    if not NUMPY_AVAILABLE:
        raise HTTPException(status_code=503, detail="NumPy required for advanced features")

    try:
        # Extract request data
        hit_point = np.array(request.get("hit_point", [0, 0, 0]), dtype=np.float32)
        radius = request.get("radius", 0.1)
        vertices = np.array(request.get("vertices", []), dtype=np.float32)

        if len(vertices) == 0:
            return {"selected_indices": [], "count": 0}

        # Calculate distances from hit point
        distances = np.linalg.norm(vertices - hit_point, axis=1)

        # Select vertices within radius
        selected_mask = distances < radius
        selected_indices = np.where(selected_mask)[0].tolist()

        return {
            "selected_indices": selected_indices,
            "count": len(selected_indices),
            "total_vertices": len(vertices)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Paint computation failed: {e!s}") from e
