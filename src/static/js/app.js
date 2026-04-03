// ══════════════════════════════════════════════════════
//  MAIN APP - Model Viewer & Physics Editor
// ══════════════════════════════════════════════════════

import * as THREE from 'three';
import { initScene } from './modules/scene.js';
import {
    texRegistry, registerTextureFiles, fixMaterials,
    loadModel, normalizeModel, extractBones
} from './modules/loader.js';
import {
    SpringBone, SoftBodyGroup, paintVertices,
    PythonPhysicsBackend
} from './modules/physics.js';
import {
    UIManager, showToast, sliderVal, linkSlider,
    showLoading, updateTexCount
} from './modules/ui.js';

// ── Scene ──────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');
const { renderer, scene, camera, controls, clock } = initScene(canvas, viewport);

// ── UI ─────────────────────────────────────────────────
const ui = new UIManager();
ui.onStopPainting = () => stopPainting();
ui.init();

// ── State ──────────────────────────────────────────────
let currentModel = null;
let modelFormat = null;

// View panel
const matData = new Map(); // materialUUID → { material, slots }
const meshData = new Map(); // mesh.uuid    → { mesh, enabled }

const TEX_SLOTS = [
    { key: 'map', label: 'Albedo', tag: 'map' },
    { key: 'normalMap', label: 'Normal', tag: 'normal' },
    { key: 'roughnessMap', label: 'Rough', tag: 'rough' },
    { key: 'metalnessMap', label: 'Metal', tag: 'rough' },
    { key: 'emissiveMap', label: 'Emissive', tag: 'emissive' },
    { key: 'aoMap', label: 'AO', tag: 'rough' },
    { key: 'alphaMap', label: 'Alpha', tag: 'map' },
    { key: 'bumpMap', label: 'Bump', tag: 'normal' },
];

// Bones
let allBones = [];
let bonePickMeshes = [];
let skeletonHelper = null;
let selectedBone = null;
let showSkeleton = true;
let boneDragging = false;
let dragLastX = 0, dragLastY = 0;

// Springs
const springBones = new Map();

// Soft body
const softGroups = [];
let activeGroup = null;
let paintMode = null;   // 'paint' | 'erase' | null
let isBrushPainting = false;
let groupCounter = 0;

// Physics backend (optional)
const pythonPhysics = new PythonPhysicsBackend(`${window.location.host}/api/physics`);

// Raycaster
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

// Brush cursor
const brushCursor = (() => {
    const geo = new THREE.RingGeometry(0.9, 1.0, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5a0, side: THREE.DoubleSide,
        transparent: true, opacity: 0.7, depthTest: false
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.renderOrder = 999;
    scene.add(m);
    return m;
})();

// Bone pick geometry (shared)
const bonePickGeo = new THREE.SphereGeometry(0.04, 6, 6);
const bonePickMat = new THREE.MeshBasicMaterial({ visible: false });

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
function toNDC(e) {
    const r = canvas.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    return mouseNDC;
}

// ══════════════════════════════════════════════════════
//  VIEW PANEL — texture + mesh toggles
// ══════════════════════════════════════════════════════
function clearViewLists() {
    matData.clear();
    meshData.clear();
    document.getElementById('vlist-textures').innerHTML = '';
    document.getElementById('vlist-meshes').innerHTML = '';
    document.getElementById('empty-msg').style.display = 'none';
}

function buildViewLists(root, filename) {
    let tris = 0, meshCount = 0;

    root.traverse(obj => {
        if (!obj.isMesh) return;
        meshCount++;
        obj.castShadow = obj.receiveShadow = true;
        const g = obj.geometry;
        tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;

        const mEntry = { mesh: obj, enabled: true };
        meshData.set(obj.uuid, mEntry);
        addMeshRow(obj, mEntry);

        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
            if (!mat || matData.has(mat.uuid)) return;
            const slots = {};
            TEX_SLOTS.forEach(({ key, label, tag }) => {
                if (mat[key]) {
                    slots[key] = {
                        original: mat[key], enabled: true, label, tag,
                        apply(m) { m[key] = this.enabled ? this.original : null; m.needsUpdate = true; }
                    };
                }
            });
            matData.set(mat.uuid, { material: mat, slots });
            addTexRows(mat, slots);
        });
    });

    const info = document.getElementById('model-info');
    info.style.display = 'block';
    info.innerHTML = `<div style="padding:2px 0 6px">
        <span class="info-chip">Meshes <span>${meshCount}</span></span>
        <span class="info-chip">Tris <span>${Math.round(tris).toLocaleString()}</span></span>
        <span class="info-chip">Mats <span>${matData.size}</span></span>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--dim);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${filename}</div>`;
    updateViewCount();
}

function addTexRows(mat, slots) {
    const listEl = document.getElementById('vlist-textures');
    if (Object.keys(slots).length === 0) return;

    const head = document.createElement('div');
    head.style.cssText = 'padding:7px 12px 3px;font-family:var(--mono);font-size:10px;' +
        'color:#4a6070;letter-spacing:1px;border-bottom:1px solid #1a2028';
    head.textContent = mat.name || 'Material';
    listEl.appendChild(head);

    Object.entries(slots).forEach(([key, slot]) => {
        const row = mkToggleRow(
            slot.original.name || key,
            slot.tag, slot.label, true,
            on => {
                slot.enabled = on;
                matData.forEach(md => { if (md.slots[key] === slot) slot.apply(md.material); });
            }
        );
        listEl.appendChild(row);
    });
}

function addMeshRow(mesh, mEntry) {
    const row = mkToggleRow(mesh.name || 'Mesh', 'mesh', 'MESH', true, on => {
        mEntry.enabled = on;
        mEntry.mesh.visible = on;
    });
    document.getElementById('vlist-meshes').appendChild(row);
}

function mkToggleRow(labelText, tagClass, tagText, initialOn, onChange) {
    const row = document.createElement('div');
    row.className = 'toggle-row';

    const lbl = document.createElement('span');
    lbl.className = 'row-label';
    lbl.textContent = labelText.length > 24 ? '…' + labelText.slice(-22) : labelText;
    lbl.title = labelText;

    const tag = document.createElement('span');
    tag.className = `type-tag ${tagClass}`;
    tag.textContent = tagText;

    const sw = document.createElement('button');
    sw.className = 'toggle-sw' + (initialOn ? ' on' : '');
    sw.addEventListener('click', () => {
        const on = !sw.classList.contains('on');
        sw.classList.toggle('on', on);
        lbl.classList.toggle('dimmed', !on);
        onChange(on);
    });

    row.append(lbl, tag, sw);
    return row;
}

function updateViewCount() {
    const tab = document.querySelector('.vtab.active')?.dataset.vtab;
    let n = 0;
    if (tab === 'textures') matData.forEach(md => n += Object.keys(md.slots).length);
    else n = meshData.size;
    const el = document.getElementById('vlist-count');
    if (el) el.textContent = n ? `${n} ${tab === 'textures' ? 'channels' : 'meshes'}` : '—';
}

// All-on button
document.getElementById('btn-all-on')?.addEventListener('click', () => {
    const tab = document.querySelector('.vtab.active')?.dataset.vtab;
    if (tab === 'textures') {
        matData.forEach(md => Object.entries(md.slots).forEach(([key, slot]) => {
            if (!slot.enabled) { slot.enabled = true; slot.apply(md.material); }
        }));
        document.querySelectorAll('#vlist-textures .toggle-sw').forEach(s => s.classList.add('on'));
        document.querySelectorAll('#vlist-textures .row-label').forEach(l => l.classList.remove('dimmed'));
    } else {
        meshData.forEach(md => { md.enabled = true; md.mesh.visible = true; });
        document.querySelectorAll('#vlist-meshes .toggle-sw').forEach(s => s.classList.add('on'));
        document.querySelectorAll('#vlist-meshes .row-label').forEach(l => l.classList.remove('dimmed'));
    }
});

// ══════════════════════════════════════════════════════
//  MODEL LOADING
// ══════════════════════════════════════════════════════
function onModelLoaded(root, filename, fmt) {
    if (currentModel) scene.remove(currentModel);
    clearBones();
    clearSoftGroups();
    clearViewLists();
    springBones.clear();

    currentModel = root;
    modelFormat = fmt;
    scene.add(root);
    fixMaterials(root, fmt);
    normalizeModel(root, camera, controls);

    buildViewLists(root, filename);
    doExtractBones(root);
    updateSpringList();
    updateGroupList();
}

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const texInput = document.getElementById('tex-input');

function handleLoad(file) {
    showLoading(true, 0, 'LOADING');
    loadModel(
        file,
        (root, name, fmt) => { showLoading(false); onModelLoaded(root, name, fmt); },
        xhr => {
            const p = Math.round(xhr.loaded / (xhr.total || 1) * 100);
            showLoading(true, p, p === 100 ? 'BUILDING' : 'LOADING');
        },
        err => { showLoading(false); showToast('Load failed: ' + (err.message || '?')); }
    );
}

dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone?.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag');
    const files = [...e.dataTransfer.files];
    const model = files.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
    const n = registerTextureFiles(files);
    if (n) updateTexCount(texRegistry.size);
    if (model) handleLoad(model);
    else if (n) showToast('Textures registered — drop your model now', true);
    else showToast('Drop a .glb, .gltf, or .fbx file');
});
dropZone?.addEventListener('click', () => fileInput.click());
fileInput?.addEventListener('change', e => { if (e.target.files[0]) handleLoad(e.target.files[0]); e.target.value = ''; });

document.getElementById('btn-load-tex')?.addEventListener('click', () => texInput.click());
texInput?.addEventListener('change', e => {
    const n = registerTextureFiles([...e.target.files]);
    updateTexCount(texRegistry.size);
    if (n && currentModel) fixMaterials(currentModel, modelFormat);
    e.target.value = '';
});

// ══════════════════════════════════════════════════════
//  BONES
// ══════════════════════════════════════════════════════
function clearBones() {
    bonePickMeshes.forEach(m => { if (m.parent) m.parent.remove(m); });
    bonePickMeshes = [];
    allBones = [];
    if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
    selectedBone = null;
    document.getElementById('bone-tree').innerHTML = '';
    document.getElementById('no-bones').style.display = 'block';
    document.getElementById('bone-count').textContent = '—';
    document.getElementById('bone-info').style.display = 'none';
}

function doExtractBones(root) {
    allBones = extractBones(root);
    if (allBones.length === 0) return;

    allBones.forEach(b => {
        b.userData.restQuat = b.quaternion.clone();
        b.userData.restPos = b.position.clone();
    });

    root.traverse(obj => {
        if (obj.isSkinnedMesh && !skeletonHelper) {
            skeletonHelper = new THREE.SkeletonHelper(obj);
            skeletonHelper.material.linewidth = 2;
            skeletonHelper.visible = showSkeleton;
            scene.add(skeletonHelper);
        }
    });

    allBones.forEach(bone => {
        const m = new THREE.Mesh(bonePickGeo, bonePickMat.clone());
        m.userData.bone = bone;
        bone.add(m);
        bonePickMeshes.push(m);
    });

    document.getElementById('no-bones').style.display = 'none';
    document.getElementById('bone-count').textContent = allBones.length;
    buildBoneTree();
}

function buildBoneTree() {
    const container = document.getElementById('bone-tree');
    container.innerHTML = '';
    allBones.filter(b => !b.parent?.isBone).forEach(r => container.appendChild(makeBoneNode(r)));
}

function makeBoneNode(bone) {
    const children = bone.children.filter(c => c.isBone);
    const wrapper = document.createElement('div');
    wrapper.className = 'btree-node';
    wrapper.dataset.boneUuid = bone.uuid;

    const row = document.createElement('div');
    row.className = 'btree-row' + (springBones.has(bone.uuid) ? ' has-spring' : '');
    if (selectedBone === bone) row.classList.add('selected');

    const tog = document.createElement('span');
    tog.className = 'btree-toggle';
    tog.textContent = children.length ? '▶' : '';

    const dot = document.createElement('span');
    dot.className = 'btree-dot';

    const lbl = document.createElement('span');
    lbl.className = 'btree-name';
    lbl.textContent = bone.name.replace(/mixamorig[0-9]*:/i, '') || bone.name;
    lbl.title = bone.name;

    row.append(tog, dot, lbl);
    row.addEventListener('click', e => { e.stopPropagation(); selectBone(bone); });
    wrapper.appendChild(row);

    if (children.length) {
        const childWrap = document.createElement('div');
        childWrap.className = 'btree-children';
        childWrap.style.display = 'none';
        children.forEach(c => childWrap.appendChild(makeBoneNode(c)));
        wrapper.appendChild(childWrap);

        tog.addEventListener('click', e => {
            e.stopPropagation();
            const open = childWrap.style.display !== 'none';
            childWrap.style.display = open ? 'none' : 'block';
            tog.textContent = open ? '▶' : '▼';
        });
    }
    return wrapper;
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
//  SOFT BODY (MESH)
// ══════════════════════════════════════════════════════
function clearSoftGroups() {
    softGroups.forEach(g => {
        if (g.pointsMesh) scene.remove(g.pointsMesh);
        g.vertices.forEach(v => {
            v.mesh.geometry.attributes.position.setXYZ(v.index, v.restPos.x, v.restPos.y, v.restPos.z);
            v.mesh.geometry.attributes.position.needsUpdate = true;
        });
    });
    softGroups.length = 0;
    activeGroup = null;
    updateGroupList();
}

document.getElementById('btn-new-group')?.addEventListener('click', () => {
    const g = new SoftBodyGroup(`Group ${++groupCounter}`, {
        stiffness: sliderVal('br-stiffness'),
        damping: sliderVal('br-damping'),
    });
    softGroups.push(g);
    setActiveGroup(g);
    updateGroupList();
});

function setActiveGroup(g) {
    activeGroup = g;
    softGroups.forEach(sg => {
        if (sg.pointsMesh) sg.pointsMesh.material.color.set(sg === g ? 0x00e5a0 : 0x005540);
    });
    updateGroupList();
    if (g && g._dirty) {
        g.rebuildPoints(scene);
    }
}

function updateGroupList() {
    const list = document.getElementById('group-list');
    list.innerHTML = '';
    softGroups.forEach(g => {
        const row = document.createElement('div');
        row.className = 'group-item' + (g === activeGroup ? ' selected' : '');

        const name = document.createElement('span'); name.className = 'gi-name'; name.textContent = g.name;
        const cnt = document.createElement('span'); cnt.className = 'gi-count'; cnt.textContent = g.vertices.length + ' verts';

        const sw = document.createElement('button');
        sw.className = 'toggle-sw' + (g.enabled ? ' on' : '');
        sw.addEventListener('click', e => { e.stopPropagation(); g.enabled = sw.classList.toggle('on'); });

        const del = document.createElement('button');
        del.className = 'icon-btn';
        del.textContent = '✕';
        del.addEventListener('click', e => {
            e.stopPropagation();
            if (g.pointsMesh) scene.remove(g.pointsMesh);
            g.vertices.forEach(v => {
                v.mesh.geometry.attributes.position.setXYZ(v.index, v.restPos.x, v.restPos.y, v.restPos.z);
                v.mesh.geometry.attributes.position.needsUpdate = true;
            });
            softGroups.splice(softGroups.indexOf(g), 1);
            if (activeGroup === g) activeGroup = softGroups[0] || null;
            updateGroupList();
        });

        row.addEventListener('click', () => setActiveGroup(g));
        row.append(name, cnt, sw, del);
        list.appendChild(row);
    });
}

const btnPaint = document.getElementById('btn-paint-toggle');
const btnErase = document.getElementById('btn-erase-toggle');

btnPaint?.addEventListener('click', () => {
    if (!activeGroup) { showToast('Create a group first'); return; }
    paintMode = paintMode === 'paint' ? null : 'paint';
    btnPaint.classList.toggle('paint-active', paintMode === 'paint');
    btnErase.classList.remove('paint-active');
    brushCursor.material.color.set(0x00e5a0);
    brushCursor.visible = paintMode !== null;
    ui.updateHUD(selectedBone, paintMode);
});
btnErase?.addEventListener('click', () => {
    if (!activeGroup) { showToast('Create a group first'); return; }
    paintMode = paintMode === 'erase' ? null : 'erase';
    btnErase.classList.toggle('paint-active', paintMode === 'erase');
    btnPaint.classList.remove('paint-active');
    brushCursor.material.color.set(paintMode === 'erase' ? 0xff4060 : 0x00e5a0);
    brushCursor.visible = paintMode !== null;
    ui.updateHUD(selectedBone, paintMode);
});

document.getElementById('btn-kick-group')?.addEventListener('click', () => {
    if (!activeGroup) { showToast('Select a group first'); return; }
    activeGroup.kick(new THREE.Vector3(
        (Math.random() - .5) * .3, Math.random() * .3, (Math.random() - .5) * .3
    ));
});

function stopPainting() {
    paintMode = null;
    isBrushPainting = false;
    brushCursor.visible = false;
    btnPaint?.classList.remove('paint-active');
    btnErase?.classList.remove('paint-active');
    ui.updateHUD(selectedBone, paintMode);
}

function getMeshList() {
    const meshes = [];
    if (currentModel) currentModel.traverse(o => { if (o.isMesh) meshes.push(o); });
    return meshes;
}

function doPaint(e) {
    if (!activeGroup || !currentModel) return;
    const ndc = toNDC(e);
    const meshes = getMeshList();
    paintVertices(raycaster, camera, ndc, activeGroup, paintMode, sliderVal('br-radius'), meshes);
}

// ══════════════════════════════════════════════════════
//  CANVAS MOUSE EVENTS
// ══════════════════════════════════════════════════════
canvas.addEventListener('mousedown', e => {
    const panel = ui.currentPanel;

    if (panel === 'bones') {
        raycaster.setFromCamera(toNDC(e), camera);
        const hits = raycaster.intersectObjects(bonePickMeshes);
        if (hits.length > 0) selectBone(hits[0].object.userData.bone);

        if (selectedBone) {
            boneDragging = true;
            dragLastX = e.clientX;
            dragLastY = e.clientY;
            controls.enabled = false;
            e.preventDefault();
        }
        return;
    }

    if (panel === 'physics' && ui.physicsMode === 'mesh' && paintMode && activeGroup) {
        isBrushPainting = true;
        controls.enabled = false;
        doPaint(e);
    }
});

canvas.addEventListener('mousemove', e => {
    // ── Bone rotation ──
    if (boneDragging && selectedBone) {
        const dx = (e.clientX - dragLastX) * 0.008;
        const dy = (e.clientY - dragLastY) * 0.008;
        dragLastX = e.clientX; dragLastY = e.clientY;

        if (e.shiftKey) selectedBone.rotateZ(-dx);
        else { selectedBone.rotateY(dx); selectedBone.rotateX(dy); }

        springBones.get(selectedBone.uuid)?.syncRest();
    }

    // ── Brush hover + paint ──
    if (ui.currentPanel === 'physics' && ui.physicsMode === 'mesh' && paintMode) {
        const ndc = toNDC(e);
        const meshes = getMeshList();
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(meshes);
        if (hits.length > 0) {
            const h = hits[0];
            brushCursor.position.copy(h.point);
            brushCursor.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                h.face.normal.clone().transformDirection(h.object.matrixWorld)
            );
            brushCursor.scale.setScalar(sliderVal('br-radius'));
            brushCursor.visible = true;
            if (isBrushPainting) doPaint(e);
        } else {
            brushCursor.visible = false;
        }
    }
});

canvas.addEventListener('mouseup', () => {
    boneDragging = false;
    isBrushPainting = false;
    controls.enabled = true;
    if (activeGroup?._dirty) {
        activeGroup.rebuildPoints(scene);
        updateGroupList();
    }
});

canvas.addEventListener('mouseleave', () => {
    boneDragging = false;
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

// Expose for debugging
window.app = { scene, camera, renderer, currentModel, springBones, softGroups, pythonPhysics };
