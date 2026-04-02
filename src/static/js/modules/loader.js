// ══════════════════════════════════════════════════════
//  LOADER MODULE - Model & Texture Loading
// ══════════════════════════════════════════════════════

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Texture registry for managing loaded textures
 */
export const texRegistry = new Map();

/**
 * Register texture files for later use
 */
export function registerTextureFiles(files) {
    let n = 0;
    for (const f of files) {
        const ext = f.name.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'bmp', 'tga', 'webp', 'gif'].includes(ext)) {
            const prev = texRegistry.get(f.name.toLowerCase());
            if (prev) URL.revokeObjectURL(prev);
            texRegistry.set(f.name.toLowerCase(), URL.createObjectURL(f));
            n++;
        }
    }
    return n;
}

/**
 * Fix materials after loading a model
 */
export function fixMaterials(root, fmt) {
    const texLoader = new THREE.TextureLoader();
    root.traverse(obj => {
        if (!obj.isMesh) return;
        if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
            if (!mat) return;
            if (fmt === 'fbx') {
                if (mat.color) {
                    const { r, g, b } = mat.color;
                    if (r < .01 && g < .01 && b < .01) mat.color.set(0xffffff);
                }
                ['map', 'emissiveMap'].forEach(k => {
                    if (mat[k]) mat[k].colorSpace = THREE.SRGBColorSpace;
                });
                ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'].forEach(k => {
                    if (mat[k]) mat[k].colorSpace = THREE.LinearSRGBColorSpace;
                });
                if (mat.shininess !== undefined) mat.shininess = Math.min(mat.shininess, 60);
                if (mat.specular) {
                    const s = mat.specular;
                    if (s.r > .8 && s.g > .8 && s.b > .8) mat.specular.set(0x444444);
                }
                if (!mat.map && mat.userData?.texture) {
                    const bn = mat.userData.texture.replace(/\\/g, '/').split('/').pop().toLowerCase();
                    if (texRegistry.has(bn)) {
                        const t = texLoader.load(texRegistry.get(bn));
                        t.colorSpace = THREE.SRGBColorSpace;
                        t.wrapS = t.wrapT = THREE.RepeatWrapping;
                        mat.map = t;
                    }
                }
                mat.side = THREE.DoubleSide;
            } else {
                if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
                if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            }
            mat.needsUpdate = true;
        });
    });
}

/**
 * Load a 3D model file (FBX, GLB, GLTF)
 */
export function loadModel(file, onLoad, onProgress, onError) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf', 'fbx'].includes(ext)) {
        throw new Error('Unsupported format: use .glb, .gltf, or .fbx');
    }

    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
        const bn = url.replace(/\\/g, '/').split('/').pop().toLowerCase();
        return texRegistry.has(bn) ? texRegistry.get(bn) : url;
    });

    const blob = URL.createObjectURL(file);

    const onErr = err => {
        URL.revokeObjectURL(blob);
        console.error(err);
        if (onError) onError(err);
    };

    if (ext === 'fbx') {
        new FBXLoader(manager).load(blob, fbx => {
            URL.revokeObjectURL(blob);
            if (onLoad) onLoad(fbx, file.name, 'fbx');
        }, onProgress, onErr);
    } else {
        new GLTFLoader(manager).load(blob, gltf => {
            URL.revokeObjectURL(blob);
            if (onLoad) onLoad(gltf.scene, file.name, 'gltf');
        }, onProgress, onErr);
    }
}

/**
 * Scale and center a loaded model in the scene
 */
export function normalizeModel(root, camera, controls) {
    // Scale + center
    const box = new THREE.Box3().setFromObject(root);
    const sz = box.getSize(new THREE.Vector3());
    const sc = 3 / (Math.max(sz.x, sz.y, sz.z) || 1);
    const ctr = box.getCenter(new THREE.Vector3());
    root.scale.setScalar(sc);
    root.position.sub(ctr.multiplyScalar(sc));
    root.position.y -= new THREE.Box3().setFromObject(root).min.y;

    // Camera refit
    const b2 = new THREE.Box3().setFromObject(root);
    const s2 = b2.getSize(new THREE.Vector3()).length();
    const c2 = b2.getCenter(new THREE.Vector3());
    controls.target.copy(c2);
    camera.position.set(c2.x + s2 * .6, c2.y + s2 * .5, c2.z + s2 * 1.0);
    controls.update();
}

/**
 * Extract bones from a loaded model
 */
export function extractBones(root) {
    const allBones = [];
    root.traverse(obj => {
        if (obj.isBone) {
            allBones.push(obj);
        }
    });
    return allBones;
}

/**
 * Build a bone tree structure for UI display
 */
export function buildBoneTree(allBones) {
    const boneMap = new Map();
    allBones.forEach(bone => boneMap.set(bone.uuid, { bone, children: [], parent: null }));

    allBones.forEach(bone => {
        const node = boneMap.get(bone.uuid);
        if (bone.parent && bone.parent.isBone) {
            const parentNode = boneMap.get(bone.parent.uuid);
            if (parentNode) {
                node.parent = parentNode;
                parentNode.children.push(node);
            }
        }
    });

    // Return root bones (bones without parent in our map)
    return Array.from(boneMap.values()).filter(n => !n.parent);
}

// Export loaders for direct use
export { FBXLoader, GLTFLoader };
