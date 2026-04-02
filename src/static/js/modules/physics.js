// ══════════════════════════════════════════════════════
//  PHYSICS MODULE - Spring Bones & Soft Body Physics
// ══════════════════════════════════════════════════════

import * as THREE from 'three';

/**
 * SpringBone class for bone-based physics simulation
 */
export class SpringBone {
    constructor(bone, opts = {}) {
        this.bone = bone;
        this.stiffness = opts.stiffness ?? 12;
        this.damping = opts.damping ?? 5;
        this.gravity = opts.gravity ?? 0;
        this.enabled = true;
        // Store the current (manually posed) quaternion as the "rest" target
        this.restQuat = bone.quaternion.clone();
        // Physics offset euler (oscillates around zero)
        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetZ = 0;
        this.velX = 0;
        this.velY = 0;
        this.velZ = 0;
    }

    syncRest() {
        // Call this after manual bone manipulation so spring targets new pose
        this.restQuat.copy(this.bone.quaternion);
        const e = new THREE.Euler().setFromQuaternion(this.restQuat);
        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetZ = 0;
    }

    kick(ax, ay, az) {
        this.velX += ax;
        this.velY += ay;
        this.velZ += az;
    }

    update(dt) {
        const k = this.stiffness, d = this.damping;
        // Spring: F = -k*offset - d*vel
        this.velX += (-k * this.offsetX - d * this.velX) * dt;
        this.velY += (-k * this.offsetY - d * this.velY) * dt;
        this.velZ += (-k * this.offsetZ - d * this.velZ + this.gravity) * dt;
        this.offsetX += this.velX * dt;
        this.offsetY += this.velY * dt;
        this.offsetZ += this.velZ * dt;

        // Apply: rest quaternion + physics offset
        const offset = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(this.offsetX, this.offsetY, this.offsetZ)
        );
        this.bone.quaternion.copy(this.restQuat).multiply(offset);
    }
}

/**
 * SoftBodyGroup class for vertex-based soft body simulation
 */
export class SoftBodyGroup {
    constructor(name, opts = {}) {
        this.name = name;
        this.stiffness = opts.stiffness ?? 20;
        this.damping = opts.damping ?? 6;
        this.enabled = true;
        this.vertices = []; // { mesh, index, restPos, offset, vel }
        this.pointsMesh = null;
        this._dirty = false;
    }

    hasVertex(mesh, index) {
        return this.vertices.some(v => v.mesh === mesh && v.index === index);
    }

    addVertex(mesh, index) {
        if (this.hasVertex(mesh, index)) return;
        const pos = new THREE.Vector3().fromBufferAttribute(
            mesh.geometry.attributes.position, index
        );
        this.vertices.push({
            mesh, index,
            restPos: pos.clone(),
            offset: new THREE.Vector3(),
            vel: new THREE.Vector3()
        });
        this._dirty = true;
    }

    removeVertex(mesh, index) {
        const i = this.vertices.findIndex(v => v.mesh === mesh && v.index === index);
        if (i !== -1) {
            this.vertices.splice(i, 1);
            this._dirty = true;
        }
    }

    kick(impulse) {
        this.vertices.forEach(v => v.vel.add(impulse));
    }

    // Rebuild the overlay point cloud
    rebuildPoints(sceneRef) {
        if (this.pointsMesh) {
            sceneRef.remove(this.pointsMesh);
            this.pointsMesh.geometry.dispose();
        }
        if (this.vertices.length === 0) {
            this.pointsMesh = null;
            return;
        }

        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(this.vertices.length * 3);
        this.vertices.forEach((v, i) => {
            const wp = v.restPos.clone().applyMatrix4(v.mesh.matrixWorld);
            pos[i * 3] = wp.x;
            pos[i * 3 + 1] = wp.y;
            pos[i * 3 + 2] = wp.z;
        });
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0x00e5a0, size: 0.015, sizeAttenuation: true });
        this.pointsMesh = new THREE.Points(geo, mat);
        sceneRef.add(this.pointsMesh);
        this._dirty = false;
    }

    update(dt) {
        if (!this.enabled || this.vertices.length === 0) return;
        const k = this.stiffness, d = this.damping;
        const meshesToUpdate = new Set();

        this.vertices.forEach(v => {
            const ox = v.offset.x, oy = v.offset.y, oz = v.offset.z;
            v.vel.x += (-k * ox - d * v.vel.x) * dt;
            v.vel.y += (-k * oy - d * v.vel.y) * dt;
            v.vel.z += (-k * oz - d * v.vel.z) * dt;
            v.offset.addScaledVector(v.vel, dt);

            const attr = v.mesh.geometry.attributes.position;
            attr.setXYZ(v.index,
                v.restPos.x + v.offset.x,
                v.restPos.y + v.offset.y,
                v.restPos.z + v.offset.z
            );
            meshesToUpdate.add(v.mesh);
        });

        meshesToUpdate.forEach(m => {
            m.geometry.attributes.position.needsUpdate = true;
            m.geometry.computeVertexNormals();
        });
    }
}

/**
 * Advanced painting with visibility-aware raycasting
 * Paints only visible vertices, respecting mesh occlusion
 */
export function paintVertices(raycaster, camera, ndc, activeGroup, paintMode, brushRadius, visibleMeshesOnly = true) {
    if (!activeGroup) return { painted: 0 };

    raycaster.setFromCamera(ndc, camera);

    // Get all meshes from the model
    const allMeshes = [];
    if (activeGroup.vertices.length > 0) {
        // Collect unique meshes from the group
        const meshSet = new Set(activeGroup.vertices.map(v => v.mesh));
        allMeshes.push(...meshSet);
    }

    if (allMeshes.length === 0) return { painted: 0 };

    // Intersect with meshes - this respects occlusion automatically
    // The first hit is the visible surface
    const hits = raycaster.intersectObjects(allMeshes);

    if (hits.length === 0) return { painted: 0 };

    const hit = hits[0];
    const mesh = hit.object;
    const wp = hit.point;
    const pos = mesh.geometry.attributes.position;
    const mw = mesh.matrixWorld;

    let paintedCount = 0;

    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw);
        if (v.distanceTo(wp) < brushRadius) {
            if (paintMode === 'paint') {
                activeGroup.addVertex(mesh, i);
                paintedCount++;
            } else {
                activeGroup.removeVertex(mesh, i);
                paintedCount++;
            }
        }
    }

    return { painted: paintedCount };
}

/**
 * Python-backed physics computation (optional, for advanced simulations)
 * This would communicate with a Python backend using numpy for faster computation
 */
export class PythonPhysicsBackend {
    constructor(serverUrl = '/api/physics') {
        this.serverUrl = serverUrl;
        this.enabled = false;
        this.latency = 0;
    }

    async computeSoftBody(vertices, stiffness, damping, dt) {
        if (!this.enabled) return null;

        try {
            const response = await fetch(this.serverUrl + '/compute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vertices: vertices.map(v => ({
                        position: [v.restPos.x, v.restPos.y, v.restPos.z],
                        offset: [v.offset.x, v.offset.y, v.offset.z],
                        velocity: [v.vel.x, v.vel.y, v.vel.z]
                    })),
                    stiffness,
                    damping,
                    dt
                })
            });

            if (!response.ok) throw new Error('Physics computation failed');

            const result = await response.json();
            this.latency = result.latency || 0;

            return result.vertices;
        } catch (error) {
            console.warn('Python physics backend unavailable, falling back to JS:', error);
            this.enabled = false;
            return null;
        }
    }

    async computeSpringBones(bonesData, dt) {
        if (!this.enabled) return null;

        try {
            const response = await fetch(this.serverUrl + '/spring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bones: bonesData, dt })
            });

            if (!response.ok) throw new Error('Spring bone computation failed');

            const result = await response.json();
            return result.bones;
        } catch (error) {
            console.warn('Python physics backend unavailable:', error);
            this.enabled = false;
            return null;
        }
    }
}

// Export for use in main app
export const PhysicsModule = {
    SpringBone,
    SoftBodyGroup,
    paintVertices,
    PythonPhysicsBackend
};
