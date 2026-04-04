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
        this.restQuat = bone.quaternion.clone();
        this.offsetX = 0; this.offsetY = 0; this.offsetZ = 0;
        this.velX = 0; this.velY = 0; this.velZ = 0;
    }

    syncRest() {
        this.restQuat.copy(this.bone.quaternion);
        this.offsetX = this.offsetY = this.offsetZ = 0;
    }

    kick(ax, ay, az) {
        this.velX += ax; this.velY += ay; this.velZ += az;
    }

    update(dt) {
        const k = this.stiffness, d = this.damping;
        this.velX += (-k * this.offsetX - d * this.velX) * dt;
        this.velY += (-k * this.offsetY - d * this.velY) * dt;
        this.velZ += (-k * this.offsetZ - d * this.velZ + this.gravity) * dt;
        this.offsetX += this.velX * dt;
        this.offsetY += this.velY * dt;
        this.offsetZ += this.velZ * dt;

        const offset = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(this.offsetX, this.offsetY, this.offsetZ)
        );
        this.bone.quaternion.copy(this.restQuat).multiply(offset);
    }
}

/**
 * SoftBodyGroup - vertex-based soft body simulation.
 * NOTE: rebuildPoints(scene) requires the Three.js scene to be passed in
 * because this module has no global scene reference.
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
        if (i !== -1) { this.vertices.splice(i, 1); this._dirty = true; }
    }

    kick(impulse) {
        this.vertices.forEach(v => v.vel.add(impulse));
    }

    // Rebuild the overlay point cloud
    rebuildPoints(sceneRef) {
        if (this.pointsMesh) {
            sceneRef.remove(this.pointsMesh);
            this.pointsMesh.geometry.dispose();
            this.pointsMesh = null;
        }
        if (this.vertices.length === 0) { this._dirty = false; return; }

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
            v.vel.x += (-k * v.offset.x - d * v.vel.x) * dt;
            v.vel.y += (-k * v.offset.y - d * v.vel.y) * dt;
            v.vel.z += (-k * v.offset.z - d * v.vel.z) * dt;
            v.offset.addScaledVector(v.vel, dt);

            v.mesh.geometry.attributes.position.setXYZ(
                v.index,
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
 * Visibility-aware vertex painting with optional multi-layer support.
 *
 * opts.multiLayer (bool, default false)
 *   false — classic mode: paint only the frontmost hit surface.
 *   true  — multi-layer mode: walk every hit along the ray and paint
 *           vertices within brushRadius of each individual hit point.
 *           Useful for overlapping meshes (e.g. clothing over a body).
 *
 * opts.includeHidden (bool, default false)
 *   When true, meshes with mesh.visible === false are temporarily made
 *   raycastable so vertices behind disabled toggles can also be painted.
 *
 * meshes array must be provided by the caller.
 */
export function paintVertices(raycaster, camera, ndc, activeGroup, paintMode, brushRadius, meshes, opts = {}) {
    if (!activeGroup || !meshes || meshes.length === 0) return { painted: 0, layers: 0 };

    const { multiLayer = false, includeHidden = false } = opts;

    // Temporarily reveal hidden meshes so the raycaster can reach them.
    const hiddenMeshes = [];
    if (includeHidden) {
        meshes.forEach(m => {
            if (!m.visible) { m.visible = true; hiddenMeshes.push(m); }
        });
    }

    raycaster.setFromCamera(ndc, camera);
    const allHits = raycaster.intersectObjects(meshes);

    // Restore visibility immediately after raycasting.
    hiddenMeshes.forEach(m => { m.visible = false; });

    if (allHits.length === 0) return { painted: 0, layers: 0 };

    // In single-layer mode only process the frontmost hit.
    const hitsToProcess = multiLayer ? allHits : [allHits[0]];

    let painted = 0;
    // Track which meshes we've already processed this stroke to avoid
    // double-painting when the ray clips the same mesh more than once.
    const visitedMeshes = new Set();

    for (const hit of hitsToProcess) {
        const mesh = hit.object;
        if (visitedMeshes.has(mesh)) continue;
        visitedMeshes.add(mesh);

        const wp = hit.point;
        const pos = mesh.geometry.attributes.position;
        const mw = mesh.matrixWorld;

        for (let i = 0; i < pos.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw);
            if (v.distanceTo(wp) < brushRadius) {
                if (paintMode === 'paint') activeGroup.addVertex(mesh, i);
                else activeGroup.removeVertex(mesh, i);
                painted++;
            }
        }
    }

    return { painted, layers: visitedMeshes.size };
}

/**
 * Optional Python numpy backend for heavy simulations.
 */
export class PythonPhysicsBackend {
    constructor(serverUrl = '/api/physics') {
        this.serverUrl = serverUrl;
        console.log(this.serverUrl);
        this.enabled = false;
        this.latency = 0;
    }

    async computeSoftBody(vertices, stiffness, damping, dt) {
        if (!this.enabled) return null;
        try {
            const res = await fetch(this.serverUrl + '/compute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vertices: vertices.map(v => ({
                        position: [v.restPos.x, v.restPos.y, v.restPos.z],
                        offset: [v.offset.x, v.offset.y, v.offset.z],
                        velocity: [v.vel.x, v.vel.y, v.vel.z]
                    })),
                    stiffness, damping, dt
                })
            });
            if (!res.ok) throw new Error('compute failed');
            const data = await res.json();
            this.latency = data.latency || 0;
            return data.vertices;
        } catch (e) {
            console.warn('Python physics unavailable, falling back to JS:', e);
            this.enabled = false;
            return null;
        }
    }

    async computeSpringBones(bonesData, dt) {
        if (!this.enabled) return null;
        try {
            const res = await fetch(this.serverUrl + '/spring', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bones: bonesData, dt })
            });
            if (!res.ok) throw new Error('spring failed');
            const data = await res.json();
            return data.bones;
        } catch (e) {
            console.warn('Python physics unavailable:', e);
            this.enabled = false;
            return null;
        }
    }
}
