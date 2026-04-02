// ══════════════════════════════════════════════════════
//  MAIN APP - Model Viewer & Physics Editor
// ══════════════════════════════════════════════════════

import * as THREE from 'three';
import { initScene, addMeshToScene, addTextureToScene, getMeshes, getTextures, clearTracking, on as onSceneEvent } from './modules/scene.js';
import { texRegistry, registerTextureFiles, fixMaterials, loadModel, normalizeModel, extractBones, buildBoneTree } from './modules/loader.js';
import { SpringBone, SoftBodyGroup, paintVertices, PythonPhysicsBackend } from './modules/physics.js';
import { UIManager, showToast, sliderVal, linkSlider, initBrushCursor, updateBrushCursor, showLoading, updateTexCount, updateViewCount } from './modules/ui.js';

// ══════════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');

// Initialize scene
const { renderer, scene, camera, controls, clock, grid } = initScene(canvas, viewport);

// Listen for scene events to update UI
onSceneEvent('meshes-updated', () => {
    updateViewLists();
});

onSceneEvent('textures-updated', () => {
    updateViewLists();
});

// Initialize UI manager
const ui = new UIManager();
ui.init();

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let currentModel = null;
let modelFormat = null;   // 'fbx'|'gltf'
let allBones = [];
let bonePickMeshes = [];     // invisible pick spheres per bone
let skeletonHelper = null;
let selectedBone = null;
let showSkeleton = true;

// Bone manipulation drag state
let boneDragging = false;
let dragLastX = 0, dragLastY = 0;

// Spring bones map: bone.uuid -> SpringBone instance
const springBones = new Map();

// Soft body groups
const softGroups = [];
let activeGroup = null;
let paintMode = null; // 'paint'|'erase'|null
let isBrushPainting = false;

// Brush cursor mesh
let brushCursor = initBrushCursor(scene);

// Python physics backend (optional)
const pythonPhysics = new PythonPhysicsBackend('/api/physics');

// UI callbacks
ui.onHUDUpdate = () => ui.updateHUD(selectedBone, paintMode);
ui.onStopPainting = stopPainting;
ui.onViewCountChange = () => updateViewLists();

// ══════════════════════════════════════════════════════
//  VIEW LIST UPDATES
// ══════════════════════════════════════════════════════
function updateViewLists() {
    const meshesList = document.getElementById('vlist-meshes');
    const texturesList = document.getElementById('vlist-textures');
    const countEl = document.getElementById('vlist-count');
    const emptyMsg = document.getElementById('empty-msg');
    
    if (!meshesList || !texturesList) return;
    
    const meshes = getMeshes();
    const textures = getTextures();
    
    // Update count
    if (countEl) {
        countEl.textContent = `${meshes.length} meshes, ${textures.length} textures`;
    }
    
    // Hide empty message if we have content
    if (emptyMsg) {
        emptyMsg.style.display = (meshes.length === 0 && textures.length === 0) ? 'block' : 'none';
    }
    
    // Update meshes list
    meshesList.innerHTML = '';
    meshes.forEach((mesh, idx) => {
        const div = document.createElement('div');
        div.className = 'group-item';
        div.innerHTML = `
            <span class="group-name">${mesh.name || 'Mesh_' + idx}</span>
            <span class="group-count">${mesh.geometry?.attributes?.position?.count || 0} verts</span>
        `;
        div.addEventListener('click', () => {
            mesh.visible = !mesh.visible;
            div.classList.toggle('active', mesh.visible);
        });
        div.classList.toggle('active', mesh.visible);
        meshesList.appendChild(div);
    });
    
    // Update textures list
    texturesList.innerHTML = '';
    textures.forEach((tex, idx) => {
        const div = document.createElement('div');
        div.className = 'group-item active';
        div.innerHTML = `
            <span class="group-name">${tex.name || 'Tex_' + idx}</span>
        `;
        texturesList.appendChild(div);
    });
}

// ══════════════════════════════════════════════════════
//  BONE MANAGEMENT
// ══════════════════════════════════════════════════════
const bonePickGeo = new THREE.SphereGeometry(0.04, 6, 6);
const bonePickMat = new THREE.MeshBasicMaterial({ visible: false });
const boneVisMat = new THREE.MeshBasicMaterial({ color: 0xff9f40, wireframe: false, transparent: true, opacity: 0.85 });
const boneSelMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 1.0 });

function clearBones() {
    if (skeletonHelper) {
        scene.remove(skeletonHelper);
        skeletonHelper.dispose();
        skeletonHelper = null;
    }
    bonePickMeshes.forEach(m => scene.remove(m));
    bonePickMeshes = [];
    allBones = [];
}

function extractAndBuildBones(root) {
    clearBones();
    allBones = extractBones(root);
    
    if (allBones.length === 0) return;
    
    // Create skeleton helper
    skeletonHelper = new THREE.SkeletonHelper(root);
    skeletonHelper.visible = showSkeleton;
    scene.add(skeletonHelper);
    
    // Create pick meshes for each bone
    const pickGroup = new THREE.Group();
    allBones.forEach(bone => {
        const pick = new THREE.Mesh(bonePickGeo, bonePickMat);
        pick.userData.bone = bone;
        bone.add(pick);
        bonePickMeshes.push(pick);
    });
    scene.add(pickGroup);
    
    // Build bone tree for UI
    const boneTree = buildBoneTree(allBones);
    buildBoneUI(boneTree);
}

function buildBoneUI(boneTree) {
    const container = document.getElementById('bone-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    function createBoneNode(node) {
        const div = document.createElement('div');
        div.className = 'bone-node';
        div.textContent = node.bone.name;
        div.dataset.uuid = node.bone.uuid;
        
        div.addEventListener('click', () => selectBone(node.bone));
        
        if (node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'bone-children';
            node.children.forEach(child => {
                childrenDiv.appendChild(createBoneNode(child));
            });
            div.appendChild(childrenDiv);
        }
        
        return div;
    }
    
    boneTree.forEach(node => {
        container.appendChild(createBoneNode(node));
    });
}

function selectBone(bone) {
    selectedBone = bone;
    
    // Update UI selection
    document.querySelectorAll('.bone-node').forEach(el => {
        el.classList.toggle('selected', el.dataset.uuid === bone.uuid);
    });
    
    // Show bone properties panel
    const propsPanel = document.getElementById('bone-props');
    if (propsPanel) {
        propsPanel.style.display = 'block';
        
        // Find or create spring bone
        if (!springBones.has(bone.uuid)) {
            springBones.set(bone.uuid, new SpringBone(bone));
        }
        const sb = springBones.get(bone.uuid);
        
        // Update sliders - use sp- prefixed IDs for physics panel
        const stiffnessVal = document.getElementById('sp-stiffness-val');
        const dampingVal = document.getElementById('sp-damping-val');
        const gravityVal = document.getElementById('sp-gravity-val');
        const stiffnessSlider = document.getElementById('sp-stiffness');
        const dampingSlider = document.getElementById('sp-damping');
        const gravitySlider = document.getElementById('sp-gravity');
        
        if (stiffnessVal) stiffnessVal.textContent = sb.stiffness.toFixed(1);
        if (dampingVal) dampingVal.textContent = sb.damping.toFixed(1);
        if (gravityVal) gravityVal.textContent = sb.gravity.toFixed(2);
        
        if (stiffnessSlider) stiffnessSlider.value = sb.stiffness;
        if (dampingSlider) dampingSlider.value = sb.damping;
        if (gravitySlider) gravitySlider.value = sb.gravity;
    }
    
    // Update bone info display
    const boneNameEl = document.getElementById('sp-bone-name');
    if (boneNameEl) {
        boneNameEl.textContent = bone.name || 'Selected bone';
    }
    
    ui.updateHUD(selectedBone, paintMode);
    updateSpringList();
}

// ══════════════════════════════════════════════════════
//  SOFT BODY GROUPS
// ══════════════════════════════════════════════════════
let groupCounter = 0;

function clearSoftGroups() {
    softGroups.forEach(g => {
        if (g.pointsMesh) {
            scene.remove(g.pointsMesh);
            g.pointsMesh.geometry.dispose();
        }
    });
    softGroups.length = 0;
    activeGroup = null;
}

function createSoftGroup() {
    const name = `Group_${++groupCounter}`;
    const group = new SoftBodyGroup(name);
    softGroups.push(group);
    updateGroupList();
    setActiveGroup(group);
    return group;
}

function setActiveGroup(g) {
    activeGroup = g;
    updateGroupList();
    if (g && g._dirty) {
        g.rebuildPoints(scene);
    }
}

function updateGroupList() {
    const container = document.getElementById('group-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    softGroups.forEach((g, idx) => {
        const div = document.createElement('div');
        div.className = 'group-item' + (activeGroup === g ? ' active' : '');
        div.innerHTML = `
            <span class="group-name">${g.name}</span>
            <span class="group-count">${g.vertices.length} verts</span>
        `;
        div.addEventListener('click', () => setActiveGroup(g));
        container.appendChild(div);
    });
}

// ══════════════════════════════════════════════════════
//  PAINTING & BRUSH
// ══════════════════════════════════════════════════════
const btnPaint = document.getElementById('btn-paint-toggle');
const btnErase = document.getElementById('btn-erase-toggle');

if (btnPaint) {
    btnPaint.addEventListener('click', () => {
        paintMode = paintMode === 'paint' ? null : 'paint';
        btnPaint.classList.toggle('active', paintMode === 'paint');
        if (btnErase && paintMode === 'paint') btnErase.classList.remove('active');
        ui.updateHUD(selectedBone, paintMode);
    });
}

if (btnErase) {
    btnErase.addEventListener('click', () => {
        paintMode = paintMode === 'erase' ? null : 'erase';
        btnErase.classList.toggle('active', paintMode === 'erase');
        if (btnPaint && paintMode === 'erase') btnPaint.classList.remove('active');
        ui.updateHUD(selectedBone, paintMode);
    });
}

function stopPainting() {
    isBrushPainting = false;
    paintMode = null;
    if (btnPaint) btnPaint.classList.remove('active');
    if (btnErase) btnErase.classList.remove('active');
    updateBrushCursor(brushCursor, new THREE.Vector3(), 0.1, false);
    ui.updateHUD(selectedBone, paintMode);
}

const raycaster = new THREE.Raycaster();
const mouse2 = new THREE.Vector2();

function toNDC(e) {
    const rect = canvas.getBoundingClientRect();
    mouse2.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse2.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return mouse2;
}

function doPaint(e) {
    if (!activeGroup || !currentModel) return;
    
    const ndc = toNDC(e);
    const result = paintVertices(raycaster, camera, ndc, activeGroup, paintMode, sliderVal('br-radius'));
    
    if (result.painted > 0) {
        activeGroup.rebuildPoints();
        updateGroupList();
    }
}

// Mouse events for painting
canvas.addEventListener('mousedown', e => {
    if (!activeGroup || !paintMode) return;
    isBrushPainting = true;
    doPaint(e);
});

canvas.addEventListener('mousemove', e => {
    // Update brush cursor
    if (activeGroup && paintMode) {
        const ndc = toNDC(e);
        raycaster.setFromCamera(ndc, camera);
        const meshes = [];
        currentModel.traverse(o => { if (o.isMesh) meshes.push(o); });
        const hits = raycaster.intersectObjects(meshes);
        
        if (hits.length > 0) {
            updateBrushCursor(brushCursor, hits[0].point, sliderVal('br-radius'), true);
        } else {
            updateBrushCursor(brushCursor, new THREE.Vector3(), sliderVal('br-radius'), false);
        }
    }
    
    if (isBrushPainting && activeGroup && paintMode) {
        doPaint(e);
    }
});

window.addEventListener('mouseup', () => {
    isBrushPainting = false;
});

// Link sliders
linkSlider('stiffness-slider', 'stiffness-val', 1);
linkSlider('damping-slider', 'damping-val', 1);
linkSlider('gravity-slider', 'gravity-val', 2);
linkSlider('br-radius', 'br-radius-val', 2);
linkSlider('sp-stiffness', 'sp-stiffness-val', 1);
linkSlider('sp-damping', 'sp-damping-val', 1);
linkSlider('sp-gravity', 'sp-gravity-val', 2);
linkSlider('br-stiffness', 'br-stiffness-val', 1);
linkSlider('br-damping', 'br-damping-val', 1);

// ══════════════════════════════════════════════════════
//  PHYSICS BUTTONS
// ══════════════════════════════════════════════════════

// Apply spring to selected bone
const btnApplySpring = document.getElementById('btn-apply-spring');
if (btnApplySpring) {
    btnApplySpring.addEventListener('click', () => {
        if (!selectedBone) {
            showToast('Select a bone first');
            return;
        }
        
        const stiffness = sliderVal('sp-stiffness');
        const damping = sliderVal('sp-damping');
        const gravity = sliderVal('sp-gravity');
        
        // Create or update spring bone
        if (!springBones.has(selectedBone.uuid)) {
            const sb = new SpringBone(selectedBone, { stiffness, damping, gravity });
            springBones.set(selectedBone.uuid, sb);
            showToast(`Spring added to ${selectedBone.name}`);
        } else {
            const sb = springBones.get(selectedBone.uuid);
            sb.stiffness = stiffness;
            sb.damping = damping;
            sb.gravity = gravity;
            showToast(`Spring updated on ${selectedBone.name}`);
        }
        
        updateSpringList();
    });
}

// Kick all spring bones
const btnKickAll = document.getElementById('btn-kick-all');
if (btnKickAll) {
    btnKickAll.addEventListener('click', () => {
        springBones.forEach(sb => {
            sb.kick(0.5, 0.5, 0.5);
        });
        showToast('Kicked all spring bones!');
    });
}

// New soft body group
const btnNewGroup = document.getElementById('btn-new-group');
if (btnNewGroup) {
    btnNewGroup.addEventListener('click', () => {
        createSoftGroup();
        showToast('New group created');
    });
}

// Kick active group
const btnKickGroup = document.getElementById('btn-kick-group');
if (btnKickGroup) {
    btnKickGroup.addEventListener('click', () => {
        if (!activeGroup || activeGroup.vertices.length === 0) {
            showToast('Select a group with vertices first');
            return;
        }
        activeGroup.kick(new THREE.Vector3(0.3, 0.3, 0.3));
        showToast('Kicked group!');
    });
}

// Update spring list display
function updateSpringList() {
    const container = document.getElementById('spring-list');
    const countEl = document.getElementById('spring-count');
    if (!container) return;
    
    container.innerHTML = '';
    if (countEl) countEl.textContent = springBones.size;
    
    springBones.forEach((sb, uuid) => {
        const div = document.createElement('div');
        div.className = 'group-item';
        div.innerHTML = `
            <span class="group-name">${sb.bone.name}</span>
            <span class="group-count">k=${sb.stiffness.toFixed(1)}</span>
        `;
        div.addEventListener('click', () => {
            selectBone(sb.bone);
        });
        container.appendChild(div);
    });
}

// ══════════════════════════════════════════════════════
//  MODEL LOADING
// ══════════════════════════════════════════════════════
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const texInput = document.getElementById('tex-input');

function onModelLoaded(root, filename, fmt) {
    // Cleanup old
    if (currentModel) scene.remove(currentModel);
    clearBones();
    clearSoftGroups();
    springBones.clear();
    clearTracking();
    
    currentModel = root;
    modelFormat = fmt;
    
    // Add mesh to scene with tracking
    addMeshToScene(scene, root);
    
    fixMaterials(root, fmt);
    
    // Normalize model
    normalizeModel(root, camera, controls);
    
    // Extract bones and build UI
    extractAndBuildBones(root);
    
    // Update texture count and view count
    updateTexCount(texRegistry.size);
    updateViewLists();
    updateSpringList();
    
    showToast('Model loaded: ' + filename, true);
}

if (dropZone) {
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('drag');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag');
    });
    
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag');
        const files = [...e.dataTransfer.files];
        const model = files.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
        const n = registerTextureFiles(files);
        if (n) updateTexCount(n);
        if (model) {
            showLoading(true, 0, 'LOADING');
            loadModel(model, 
                (root, name, fmt) => {
                    showLoading(false);
                    onModelLoaded(root, name, fmt);
                },
                (xhr) => {
                    const p = Math.round(xhr.loaded / (xhr.total || 1) * 100);
                    showLoading(true, p, p === 100 ? 'BUILDING' : 'LOADING');
                },
                (err) => {
                    showLoading(false);
                    showToast('Load failed: ' + (err.message || '?'));
                }
            );
        } else if (n) {
            showToast('Textures registered — drop your model now', true);
        } else {
            showToast('Drop a .glb, .gltf, or .fbx file');
        }
    });
    
    dropZone.addEventListener('click', () => fileInput.click());
}

if (fileInput) {
    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) {
            showLoading(true, 0, 'LOADING');
            loadModel(e.target.files[0],
                (root, name, fmt) => {
                    showLoading(false);
                    onModelLoaded(root, name, fmt);
                },
                (xhr) => {
                    const p = Math.round(xhr.loaded / (xhr.total || 1) * 100);
                    showLoading(true, p, p === 100 ? 'BUILDING' : 'LOADING');
                },
                (err) => {
                    showLoading(false);
                    showToast('Load failed: ' + (err.message || '?'));
                }
            );
        }
        e.target.value = '';
    });
}

if (document.getElementById('btn-load-tex')) {
    document.getElementById('btn-load-tex').addEventListener('click', () => texInput.click());
}

if (texInput) {
    texInput.addEventListener('change', e => {
        const n = registerTextureFiles([...e.target.files]);
        updateTexCount(texRegistry.size);
        if (n && currentModel) fixMaterials(currentModel, modelFormat);
        e.target.value = '';
    });
}

// ══════════════════════════════════════════════════════
//  ANIMATION LOOP
// ══════════════════════════════════════════════════════

// Batch update timers for backend calls
let backendAccumulator = 0;
const BACKEND_UPDATE_INTERVAL = 0.05; // 50ms between backend calls

async function updatePhysicsWithBackend(dt) {
    if (!pythonPhysics.enabled) return false;
    
    try {
        // Update soft body groups via backend
        if (softGroups.length > 0 && activeGroup && activeGroup.vertices.length > 0) {
            const result = await pythonPhysics.computeSoftBody(
                activeGroup.vertices,
                activeGroup.stiffness,
                activeGroup.damping,
                dt
            );
            
            if (result) {
                // Apply results to vertices
                result.vertices.forEach((v, i) => {
                    if (i < activeGroup.vertices.length) {
                        const vertex = activeGroup.vertices[i];
                        vertex.offset.set(v.offset[0], v.offset[1], v.offset[2]);
                        vertex.vel.set(v.velocity[0], v.velocity[1], v.velocity[2]);
                        
                        // Update mesh geometry
                        const attr = vertex.mesh.geometry.attributes.position;
                        attr.setXYZ(vertex.index,
                            vertex.restPos.x + vertex.offset.x,
                            vertex.restPos.y + vertex.offset.y,
                            vertex.restPos.z + vertex.offset.z
                        );
                        vertex.mesh.geometry.attributes.position.needsUpdate = true;
                        vertex.mesh.geometry.computeVertexNormals();
                    }
                });
            }
        }
        
        // Update spring bones via backend
        if (springBones.size > 0) {
            const bonesData = [];
            springBones.forEach((sb, uuid) => {
                const euler = new THREE.Euler().setFromQuaternion(sb.bone.quaternion);
                bonesData.push({
                    uuid,
                    rest_quaternion: [sb.restQuat.x, sb.restQuat.y, sb.restQuat.z, sb.restQuat.w],
                    offset_euler: [euler.x - new THREE.Euler().setFromQuaternion(sb.restQuat).x, 
                                   euler.y - new THREE.Euler().setFromQuaternion(sb.restQuat).y, 
                                   euler.z - new THREE.Euler().setFromQuaternion(sb.restQuat).z],
                    velocity: [sb.velX, sb.velY, sb.velZ],
                    stiffness: sb.stiffness,
                    damping: sb.damping,
                    gravity: sb.gravity
                });
            });
            
            const result = await pythonPhysics.computeSpringBones(bonesData, dt);
            
            if (result) {
                // Apply results to bones
                result.bones.forEach(boneResult => {
                    const sb = springBones.get(boneResult.uuid);
                    if (sb) {
                        sb.offsetX = boneResult.offset_euler[0];
                        sb.offsetY = boneResult.offset_euler[1];
                        sb.offsetZ = boneResult.offset_euler[2];
                        sb.velX = boneResult.velocity[0];
                        sb.velY = boneResult.velocity[1];
                        sb.velZ = boneResult.velocity[2];
                        
                        // Apply quaternion
                        const offset = new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(sb.offsetX, sb.offsetY, sb.offsetZ)
                        );
                        sb.bone.quaternion.copy(sb.restQuat).multiply(offset);
                    }
                });
            }
        }
        
        return true;
    } catch (error) {
        console.warn('Backend physics update failed:', error);
        pythonPhysics.enabled = false;
        return false;
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    
    // Try backend physics first if enabled
    if (pythonPhysics.enabled) {
        backendAccumulator += dt;
        if (backendAccumulator >= BACKEND_UPDATE_INTERVAL) {
            updatePhysicsWithBackend(backendAccumulator);
            backendAccumulator = 0;
        }
    } else {
        // Fall back to local JS physics
        // Spring bones
        springBones.forEach(sb => {
            if (sb.enabled !== false) sb.update(dt);
        });
        
        // Soft body groups
        softGroups.forEach(g => g.update(dt));
    }
    
    controls.update();
    renderer.render(scene, camera);
}

animate();

// Export for debugging
window.app = {
    scene,
    camera,
    renderer,
    currentModel,
    springBones,
    softGroups,
    pythonPhysics
};
