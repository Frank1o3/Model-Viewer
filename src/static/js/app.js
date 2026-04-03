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
    document.querySelectorAll('.btree-row').forEach(r => r.classList.remove('selected'));
    document.querySelector(`[data-bone-uuid="${bone.uuid}"] > .btree-row`)?.classList.add('selected');

    const name = bone.name.replace(/mixamorig[0-9]*:/i, '') || bone.name;
    document.getElementById('bone-info').style.display = 'block';
    document.getElementById('bone-info-name').textContent = name;
    document.getElementById('sp-bone-name').textContent = name;
    ui.updateHUD(selectedBone, paintMode);
}

document.getElementById('btn-reset-pose')?.addEventListener('click', () => {
    allBones.forEach(b => {
        b.quaternion.copy(b.userData.restQuat);
        b.position.copy(b.userData.restPos);
        springBones.get(b.uuid)?.syncRest();
    });
});

document.getElementById('btn-toggle-skel')?.addEventListener('click', function () {
    showSkeleton = !showSkeleton;
    if (skeletonHelper) skeletonHelper.visible = showSkeleton;
    this.textContent = showSkeleton ? 'Hide Skel' : 'Show Skel';
});

// ══════════════════════════════════════════════════════
//  SPRING PHYSICS (BONES)
// ══════════════════════════════════════════════════════
linkSlider('sp-stiffness', 'sp-stiffness-val', 1);
linkSlider('sp-damping', 'sp-damping-val', 1);
linkSlider('sp-gravity', 'sp-gravity-val', 1);
linkSlider('br-radius', 'br-radius-val', 2);
linkSlider('br-stiffness', 'br-stiffness-val', 0);
linkSlider('br-damping', 'br-damping-val', 1);

document.getElementById('br-radius')?.addEventListener('input', () => {
    brushCursor.scale.setScalar(sliderVal('br-radius'));
});

document.getElementById('btn-apply-spring')?.addEventListener('click', () => {
    if (!selectedBone) { showToast('Select a bone first'); return; }
    const sb = new SpringBone(selectedBone, {
        stiffness: sliderVal('sp-stiffness'),
        damping: sliderVal('sp-damping'),
        gravity: sliderVal('sp-gravity'),
    });
    springBones.set(selectedBone.uuid, sb);
    updateSpringList();
    buildBoneTree();
    showToast('Spring applied to ' + document.getElementById('bone-info-name').textContent, true);
});

document.getElementById('btn-remove-spring')?.addEventListener('click', () => {
    if (!selectedBone) return;
    springBones.delete(selectedBone.uuid);
    updateSpringList();
    buildBoneTree();
});

document.getElementById('btn-kick-all')?.addEventListener('click', () => {
    springBones.forEach(sb => sb.kick(
        (Math.random() - .5) * 2,
        (Math.random() - .5) * 2,
        (Math.random() - .5) * 2
    ));
});

function updateSpringList() {
    const list = document.getElementById('spring-list');
    document.getElementById('spring-count').textContent = springBones.size;
    list.innerHTML = '';
    springBones.forEach((sb) => {
        const bone = sb.bone;
        const name = bone.name.replace(/mixamorig[0-9]*:/i, '') || bone.name;
        const row = document.createElement('div');
        row.className = 'toggle-row';
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => selectBone(bone));

        const lbl = document.createElement('span');
        lbl.className = 'row-label';
        lbl.textContent = name;

        const tag = document.createElement('span');
        tag.className = 'type-tag bone';
        tag.textContent = 'SPRING';

        const sw = document.createElement('button');
        sw.className = 'toggle-sw' + (sb.enabled !== false ? ' on' : '');
        sw.addEventListener('click', e => {
            e.stopPropagation();
            sb.enabled = sw.classList.toggle('on');
            if (!sb.enabled) sb.offsetX = sb.offsetY = sb.offsetZ = sb.velX = sb.velY = sb.velZ = 0;
        });

        row.append(lbl, tag, sw);
        list.appendChild(row);
    });
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
    controls.enabled = true;
    brushCursor.visible = false;
});

// ══════════════════════════════════════════════════════
//  ANIMATION LOOP
// ══════════════════════════════════════════════════════
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    springBones.forEach(sb => { if (sb.enabled !== false) sb.update(dt); });
    softGroups.forEach(g => g.update(dt));

    controls.update();
    renderer.render(scene, camera);
}
animate();

// Expose for debugging
window.app = { scene, camera, renderer, currentModel, springBones, softGroups, pythonPhysics };
