// ══════════════════════════════════════════════════════
//  SCENE MODULE - Three.js Scene Setup & Management
// ══════════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const meshes = [];
const textures = [];
const listeners = {};

export function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
}

function emit(event, data) {
    if (listeners[event]) {
        listeners[event].forEach(cb => cb(data));
    }
}

/**
 * Initialize the Three.js scene, camera, renderer, and controls
 */
export function initScene(canvas, viewport) {
    const clock = new THREE.Clock();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0a0c0f);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0c0f, 0.005);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
    camera.position.set(3, 2, 5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xe8f4ff, 2);
    key.position.set(5, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa0d8ef, 0.5);
    fill.position.set(-5, 3, -5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00e5a0, 0.25);
    rim.position.set(0, -4, -8);
    scene.add(rim);

    // Grid
    const grid = new THREE.GridHelper(20, 40, 0x1e2730, 0x141c24);
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    scene.add(grid);

    function resize() {
        const w = viewport.clientWidth, h = viewport.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(viewport);
    resize();

    return {
        renderer,
        scene,
        camera,
        controls,
        clock,
        grid
    };
}

/**
 * Add standard lighting to a scene
 */
export function addStandardLighting(scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xe8f4ff, 2);
    key.position.set(5, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa0d8ef, 0.5);
    fill.position.set(-5, 3, -5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00e5a0, 0.25);
    rim.position.set(0, -4, -8);
    scene.add(rim);
}

/**
 * Add a grid helper to the scene
 */
export function addGrid(scene, size = 20, divisions = 40, color1 = 0x1e2730, color2 = 0x141c24) {
    const grid = new THREE.GridHelper(size, divisions, color1, color2);
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    scene.add(grid);
    return grid;
}

/**
 * Fit camera to show an object properly
 */
export function fitCameraToObject(camera, controls, object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 * Math.tan(fov * 2));
    cameraZ *= 1.5; // Zoom out a bit

    camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.5, center.z + cameraZ);
    controls.target.copy(center);
    controls.update();
}

/**
 * Create fog for the scene
 */
export function addFog(scene, color = 0x0a0c0f, density = 0.005) {
    scene.fog = new THREE.FogExp2(color, density);
}

/**
 * Add a mesh to the scene and track it
 */
export function addMeshToScene(scene, mesh) {
    mesh.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            meshes.push(child);
        }
    });
    scene.add(mesh);
    emit('meshes-updated', getMeshes());
}

/**
 * Add a texture to the tracking list
 */
export function addTextureToScene(texture, name) {
    textures.push({ name, texture });
    emit('textures-updated', getTextures());
}

/**
 * Get all tracked meshes
 */
export function getMeshes() {
    return meshes;
}

/**
 * Get all tracked textures
 */
export function getTextures() {
    return textures;
}

/**
 * Clear all meshes and textures from tracking
 */
export function clearTracking() {
    meshes.length = 0;
    textures.length = 0;
    emit('meshes-updated', []);
    emit('textures-updated', []);
}

// Export commonly used Three.js components
export { THREE, OrbitControls };
