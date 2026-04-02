import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ══════════════════════════════════════════════════════
//  SCENE SETUP
// ══════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');
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
let brushCursor = null;
initBrushCursor();

// ══════════════════════════════════════════════════════
//  CLASSES
// ══════════════════════════════════════════════════════

class SpringBone {
    constructor(bone, opts = {}) {
        this.bone = bone;
        this.stiffness = opts.stiffness ?? 12;
        this.damping = opts.damping ?? 5;
        this.gravity = opts.gravity ?? 0;
        // Store the current (manually posed) quaternion as the "rest" target
        this.restQuat = bone.quaternion.clone();
        // Physics offset euler (oscillates around zero)
        this.offsetX = 0; this.offsetY = 0; this.offsetZ = 0;
        this.velX = 0; this.velY = 0; this.velZ = 0;
    }

    syncRest() {
        // Call this after manual bone manipulation so spring targets new pose
        this.restQuat.copy(this.bone.quaternion);
        const e = new THREE.Euler().setFromQuaternion(this.restQuat);
        this.offsetX = 0; this.offsetY = 0; this.offsetZ = 0;
    }

    kick(ax, ay, az) {
        this.velX += ax; this.velY += ay; this.velZ += az;
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

class SoftBodyGroup {
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
    rebuildPoints() {
        if (this.pointsMesh) {
            scene.remove(this.pointsMesh);
            this.pointsMesh.geometry.dispose();
        }
        if (this.vertices.length === 0) { this.pointsMesh = null; return; }

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
        scene.add(this.pointsMesh);
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

// ══════════════════════════════════════════════════════
//  PANEL / NAV
// ══════════════════════════════════════════════════════
let currentPanel = 'view';

document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        currentPanel = btn.dataset.panel;
        document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + currentPanel).classList.add('active');
        updateHUD();
        // Stop brush if leaving physics panel
        if (currentPanel !== 'physics') stopPainting();
    });
});

// View sub-tabs
document.querySelectorAll('.vtab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.vlist').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('vlist-' + btn.dataset.vtab).classList.add('active');
        updateViewCount();
    });
});

// Physics mode tabs
let physicsMode = 'bones';
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        physicsMode = btn.dataset.phys;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.phys-sub').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('phys-' + physicsMode).classList.add('active');
        stopPainting();
    });
});

function updateHUD() {
    const el = document.getElementById('hud-mode');
    if (currentPanel === 'bones' && selectedBone) {
        el.textContent = '🦴 BONE MODE';
    } else if (currentPanel === 'physics' && physicsMode === 'mesh' && paintMode) {
        el.textContent = paintMode === 'paint' ? '🖌 PAINT MODE' : '✕ ERASE MODE';
    } else {
        el.textContent = '';
    }
}

// ══════════════════════════════════════════════════════
//  TEXTURE REGISTRY & MATERIAL FIXES
// ══════════════════════════════════════════════════════
const texRegistry = new Map();

function registerTextureFiles(files) {
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

function fixMaterials(root, fmt) {
    const texLoader = new THREE.TextureLoader();
    root.traverse(obj => {
        if (!obj.isMesh) return;
        if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
            if (!mat) return;
            if (fmt === 'fbx') {
                if (mat.color) { const { r, g, b } = mat.color; if (r < .01 && g < .01 && b < .01) mat.color.set(0xffffff); }
                ['map', 'emissiveMap'].forEach(k => { if (mat[k]) mat[k].colorSpace = THREE.SRGBColorSpace; });
                ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'].forEach(k => { if (mat[k]) mat[k].colorSpace = THREE.LinearSRGBColorSpace; });
                if (mat.shininess !== undefined) mat.shininess = Math.min(mat.shininess, 60);
                if (mat.specular) { const s = mat.specular; if (s.r > .8 && s.g > .8 && s.b > .8) mat.specular.set(0x444444); }
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

// ══════════════════════════════════════════════════════
//  MODEL LOADING
// ══════════════════════════════════════════════════════
const loadingEl = document.getElementById('loading');
const loadPct = document.getElementById('load-pct');
const loadText = document.getElementById('load-text');

function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf', 'fbx'].includes(ext)) { showToast('Unsupported: use .glb, .gltf, or .fbx'); return; }

    loadingEl.classList.add('visible');
    loadPct.textContent = '0%';
    loadText.textContent = 'LOADING';

    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
        const bn = url.replace(/\\/g, '/').split('/').pop().toLowerCase();
        return texRegistry.has(bn) ? texRegistry.get(bn) : url;
    });

    const blob = URL.createObjectURL(file);
    const onProg = xhr => {
        const p = Math.round(xhr.loaded / (xhr.total || 1) * 100);
        loadPct.textContent = p + '%';
        if (p === 100) loadText.textContent = 'BUILDING';
    };
    const onErr = err => {
        URL.revokeObjectURL(blob);
        loadingEl.classList.remove('visible');
        console.error(err);
        showToast('Load failed: ' + (err.message || '?'));
    };

    if (ext === 'fbx') {
        new FBXLoader(manager).load(blob, fbx => {
            URL.revokeObjectURL(blob);
            onModelLoaded(fbx, file.name, 'fbx');
            loadingEl.classList.remove('visible');
        }, onProg, onErr);
    } else {
        new GLTFLoader(manager).load(blob, gltf => {
            URL.revokeObjectURL(blob);
            onModelLoaded(gltf.scene, file.name, 'gltf');
            loadingEl.classList.remove('visible');
        }, onProg, onErr);
    }
}

function onModelLoaded(root, filename, fmt) {
    // Cleanup old
    if (currentModel) scene.remove(currentModel);
    clearBones();
    clearSoftGroups();
    clearViewLists();
    springBones.clear();

    currentModel = root;
    modelFormat = fmt;
    scene.add(root);
    fixMaterials(root, fmt);

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

    buildViewLists(root, filename);
    extractBones(root);
    updateSpringList();
    updateGroupList();
}

// ══════════════════════════════════════════════════════
//  VIEW PANEL — textures & meshes
// ══════════════════════════════════════════════════════
const matData = new Map();
const meshData = new Map();
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

function clearViewLists() {
    matData.clear(); meshData.clear();
    document.getElementById('vlist-textures').innerHTML = '';
    document.getElementById('vlist-meshes').innerHTML = '';
    document.getElementById('empty-msg').style.display = 'none';
}

function buildViewLists(root, filename) {
    let tris = 0, meshCount = 0;
    root.traverse(obj => {
        if (!obj.isMesh) return;
        meshCount++;
        obj.castShadow = true; obj.receiveShadow = true;
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
                if (mat[key]) slots[key] = {
                    original: mat[key], enabled: true, label, tag,
                    apply(m) { m[key] = this.enabled ? this.original : null; m.needsUpdate = true; }
                };
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
    </div><div style="font-family:var(--mono);font-size:10px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${filename}</div>`;
    updateViewCount();
}

function addTexRows(mat, slots) {
    const listEl = document.getElementById('vlist-textures');
    if (Object.keys(slots).length === 0) return;
    const head = Object.assign(document.createElement('div'), {
        style: 'padding:7px 12px 3px;font-family:var(--mono);font-size:10px;color:#4a6070;letter-spacing:1px;border-bottom:1px solid #1a2028'
    });
    head.textContent = mat.name || 'Material';
    listEl.appendChild(head);

    Object.entries(slots).forEach(([key, slot]) => {
        const row = mkToggleRow(
            slot.original.name || key,
            slot.tag,
            slot.label,
            true,
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

document.getElementById('btn-all-on').addEventListener('click', () => {
    const tab = document.querySelector('.vtab.active').dataset.vtab;
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

function updateViewCount() {
    const tab = document.querySelector('.vtab.active').dataset.vtab;
    let n = 0;
    if (tab === 'textures') matData.forEach(md => n += Object.keys(md.slots).length);
    else n = meshData.size;
    document.getElementById('vlist-count').textContent = n ? `${n} ${tab === 'textures' ? 'channels' : 'meshes'}` : '—';
}

// ══════════════════════════════════════════════════════
//  BONES SYSTEM
// ══════════════════════════════════════════════════════
const bonePickGeo = new THREE.SphereGeometry(0.04, 6, 6);
const bonePickMat = new THREE.MeshBasicMaterial({ visible: false });  // invisible, just for picking
const boneVisMat = new THREE.MeshBasicMaterial({ color: 0xff9f40, wireframe: false, transparent: true, opacity: 0.85 });
const boneSelMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 1.0 });

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

function extractBones(root) {
    root.traverse(obj => { if (obj.isBone) allBones.push(obj); });
    if (allBones.length === 0) return;

    // Store rest quaternions
    allBones.forEach(b => {
        b.userData.restQuat = b.quaternion.clone();
        b.userData.restPos = b.position.clone();
    });

    // Skeleton helper
    root.traverse(obj => {
        if (obj.isSkinnedMesh && !skeletonHelper) {
            skeletonHelper = new THREE.SkeletonHelper(obj);
            skeletonHelper.material.linewidth = 2;
            skeletonHelper.visible = showSkeleton;
            scene.add(skeletonHelper);
        }
    });

    // Pick spheres attached to each bone
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
    const roots = allBones.filter(b => !b.parent || !b.parent.isBone);
    roots.forEach(r => container.appendChild(makeBoneNode(r)));
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
    const name = bone.name.replace(/mixamorig[0-9]*:/i, '');
    lbl.textContent = name;
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
    // Highlight tree row
    document.querySelectorAll('.btree-row').forEach(r => r.classList.remove('selected'));
    const node = document.querySelector(`[data-bone-uuid="${bone.uuid}"] > .btree-row`);
    if (node) node.classList.add('selected');

    // Info box
    const infoBox = document.getElementById('bone-info');
    const infoName = document.getElementById('bone-info-name');
    infoBox.style.display = 'block';
    infoName.textContent = bone.name.replace(/mixamorig[0-9]*:/i, '') || bone.name;

    // Physics panel sync
    document.getElementById('sp-bone-name').textContent = infoName.textContent;

    updateHUD();
}

document.getElementById('btn-reset-pose').addEventListener('click', () => {
    allBones.forEach(b => {
        b.quaternion.copy(b.userData.restQuat);
        b.position.copy(b.userData.restPos);
        // Reset spring rest too
        const sb = springBones.get(b.uuid);
        if (sb) sb.syncRest();
    });
});

document.getElementById('btn-toggle-skel').addEventListener('click', () => {
    showSkeleton = !showSkeleton;
    if (skeletonHelper) skeletonHelper.visible = showSkeleton;
    document.getElementById('btn-toggle-skel').textContent = showSkeleton ? 'Hide Skel' : 'Show Skel';
});

// ══════════════════════════════════════════════════════
//  SPRING PHYSICS (BONES)
// ══════════════════════════════════════════════════════
function sliderVal(id) { return parseFloat(document.getElementById(id).value); }
function linkSlider(id, valId, dec = 1) {
    const el = document.getElementById(id);
    const vl = document.getElementById(valId);
    vl.textContent = parseFloat(el.value).toFixed(dec);
    el.addEventListener('input', () => { vl.textContent = parseFloat(el.value).toFixed(dec); });
}
linkSlider('sp-stiffness', 'sp-stiffness-val', 1);
linkSlider('sp-damping', 'sp-damping-val', 1);
linkSlider('sp-gravity', 'sp-gravity-val', 1);
linkSlider('br-radius', 'br-radius-val', 2);
linkSlider('br-stiffness', 'br-stiffness-val', 0);
linkSlider('br-damping', 'br-damping-val', 1);

document.getElementById('br-radius').addEventListener('input', () => {
    const r = sliderVal('br-radius');
    if (brushCursor) brushCursor.scale.setScalar(r);
});

document.getElementById('btn-apply-spring').addEventListener('click', () => {
    if (!selectedBone) { showToast('Select a bone first'); return; }
    const sb = new SpringBone(selectedBone, {
        stiffness: sliderVal('sp-stiffness'),
        damping: sliderVal('sp-damping'),
        gravity: sliderVal('sp-gravity'),
    });
    springBones.set(selectedBone.uuid, sb);
    updateSpringList();
    buildBoneTree(); // refresh spring indicator dot
    showToast('Spring applied to ' + (selectedBone.name.replace(/mixamorig[0-9]*:/i, '') || selectedBone.name), true);
});

document.getElementById('btn-remove-spring').addEventListener('click', () => {
    if (!selectedBone) return;
    springBones.delete(selectedBone.uuid);
    updateSpringList();
    buildBoneTree();
});

document.getElementById('btn-kick-all').addEventListener('click', () => {
    springBones.forEach(sb => sb.kick(
        (Math.random() - .5) * 2, (Math.random() - .5) * 2, (Math.random() - .5) * 2
    ));
});

function updateSpringList() {
    const list = document.getElementById('spring-list');
    document.getElementById('spring-count').textContent = springBones.size;
    list.innerHTML = '';
    springBones.forEach((sb, uuid) => {
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
            if (!sb.enabled) { sb.offsetX = sb.offsetY = sb.offsetZ = sb.velX = sb.velY = sb.velZ = 0; }
        });

        row.append(lbl, tag, sw);
        list.appendChild(row);
    });
}

// ══════════════════════════════════════════════════════
//  SOFT BODY BRUSH (MESH)
// ══════════════════════════════════════════════════════
let groupCounter = 0;

function initBrushCursor() {
    const geo = new THREE.RingGeometry(0.9, 1.0, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5a0, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthTest: false });
    brushCursor = new THREE.Mesh(geo, mat);
    brushCursor.visible = false;
    brushCursor.renderOrder = 999;
    scene.add(brushCursor);
}

function clearSoftGroups() {
    softGroups.forEach(g => {
        if (g.pointsMesh) scene.remove(g.pointsMesh);
    });
    softGroups.length = 0;
    activeGroup = null;
    updateGroupList();
}

document.getElementById('btn-new-group').addEventListener('click', () => {
    const name = `Group ${++groupCounter}`;
    const g = new SoftBodyGroup(name, {
        stiffness: sliderVal('br-stiffness'),
        damping: sliderVal('br-damping'),
    });
    softGroups.push(g);
    setActiveGroup(g);
    updateGroupList();
});

function setActiveGroup(g) {
    activeGroup = g;
    // Highlight overlay colors
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
        sw.addEventListener('click', e => {
            e.stopPropagation();
            g.enabled = sw.classList.toggle('on');
        });

        const del = document.createElement('button');
        del.className = 'icon-btn';
        del.textContent = '✕';
        del.addEventListener('click', e => {
            e.stopPropagation();
            if (g.pointsMesh) scene.remove(g.pointsMesh);
            // Restore vertices
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

// Paint / Erase toggle buttons
const btnPaint = document.getElementById('btn-paint-toggle');
const btnErase = document.getElementById('btn-erase-toggle');

btnPaint.addEventListener('click', () => {
    if (!activeGroup) { showToast('Create a group first'); return; }
    paintMode = paintMode === 'paint' ? null : 'paint';
    btnPaint.classList.toggle('paint-active', paintMode === 'paint');
    btnErase.classList.remove('paint-active');
    brushCursor.visible = paintMode !== null;
    updateHUD();
});
btnErase.addEventListener('click', () => {
    if (!activeGroup) { showToast('Create a group first'); return; }
    paintMode = paintMode === 'erase' ? null : 'erase';
    btnErase.classList.toggle('paint-active', paintMode === 'erase');
    btnPaint.classList.remove('paint-active');
    brushCursor.material.color.set(paintMode === 'erase' ? 0xff4060 : 0x00e5a0);
    brushCursor.visible = paintMode !== null;
    updateHUD();
});

document.getElementById('btn-kick-group').addEventListener('click', () => {
    if (!activeGroup) { showToast('Select a group first'); return; }
    const imp = new THREE.Vector3((Math.random() - .5) * .3, Math.random() * .3, (Math.random() - .5) * .3);
    activeGroup.kick(imp);
});

function stopPainting() {
    paintMode = null;
    isBrushPainting = false;
    if (brushCursor) brushCursor.visible = false;
    btnPaint.classList.remove('paint-active');
    btnErase.classList.remove('paint-active');
    updateHUD();
}

// ══════════════════════════════════════════════════════
//  VIEWPORT INTERACTION (Bone Rotate + Brush Paint)
// ══════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const mouse2 = new THREE.Vector2();

function toNDC(e) {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
    );
}

canvas.addEventListener('mousedown', e => {
    if (currentPanel === 'bones') {
        // Try to pick a bone
        raycaster.setFromCamera(toNDC(e), camera);
        const hits = raycaster.intersectObjects(bonePickMeshes);
        if (hits.length > 0) {
            selectBone(hits[0].object.userData.bone);
            boneDragging = true;
            dragLastX = e.clientX; dragLastY = e.clientY;
            controls.enabled = false;
            e.preventDefault();
            return;
        }
        if (selectedBone) {
            boneDragging = true;
            dragLastX = e.clientX; dragLastY = e.clientY;
            controls.enabled = false;
        }
    }

    if (currentPanel === 'physics' && physicsMode === 'mesh' && paintMode && activeGroup) {
        isBrushPainting = true;
        controls.enabled = false;
        doPaint(e);
    }
});

canvas.addEventListener('mousemove', e => {
    // Bone rotate
    if (boneDragging && selectedBone) {
        const dx = (e.clientX - dragLastX) * 0.008;
        const dy = (e.clientY - dragLastY) * 0.008;
        dragLastX = e.clientX; dragLastY = e.clientY;

        if (e.shiftKey) {
            selectedBone.rotateZ(-dx);
        } else {
            selectedBone.rotateY(dx);
            selectedBone.rotateX(dy);
        }
        // Update spring rest to track manual pose
        const sb = springBones.get(selectedBone.uuid);
        if (sb) sb.syncRest();
    }

    // Brush hover / paint
    if (currentPanel === 'physics' && physicsMode === 'mesh' && paintMode) {
        const ndc = toNDC(e);
        raycaster.setFromCamera(ndc, camera);
        const meshes = [];
        if (currentModel) currentModel.traverse(o => { if (o.isMesh) meshes.push(o); });
        const hits = raycaster.intersectObjects(meshes);
        if (hits.length > 0) {
            const h = hits[0];
            brushCursor.position.copy(h.point);
            // Align ring to surface normal
            const up = new THREE.Vector3(0, 1, 0);
            brushCursor.quaternion.setFromUnitVectors(up, h.face.normal.clone().transformDirection(h.object.matrixWorld));
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
    if (activeGroup && activeGroup._dirty) {
        activeGroup.rebuildPoints();
        updateGroupList();
    }
});

canvas.addEventListener('mouseleave', () => {
    boneDragging = false; isBrushPainting = false; controls.enabled = true;
    if (brushCursor) brushCursor.visible = false;
});

function doPaint(e) {
    if (!activeGroup || !currentModel) return;
    const ndc = toNDC(e);
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    currentModel.traverse(o => { if (o.isMesh) meshes.push(o); });
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return;

    const hit = hits[0];
    const mesh = hit.object;
    const wp = hit.point;
    const r = sliderVal('br-radius');
    const pos = mesh.geometry.attributes.position;
    const mw = mesh.matrixWorld;

    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw);
        if (v.distanceTo(wp) < r) {
            if (paintMode === 'paint') activeGroup.addVertex(mesh, i);
            else activeGroup.removeVertex(mesh, i);
        }
    }
}

// ══════════════════════════════════════════════════════
//  DROP ZONE & FILE INPUT
// ══════════════════════════════════════════════════════
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const texInput = document.getElementById('tex-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag');
    const files = [...e.dataTransfer.files];
    const model = files.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
    const n = registerTextureFiles(files);
    if (n) updateTexCount();
    if (model) loadFile(model);
    else if (n) showToast('Textures registered — drop your model now', true);
    else showToast('Drop a .glb, .gltf, or .fbx file');
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
document.getElementById('btn-load-tex').addEventListener('click', () => texInput.click());
texInput.addEventListener('change', e => {
    const n = registerTextureFiles([...e.target.files]);
    updateTexCount();
    if (n && currentModel) fixMaterials(currentModel, modelFormat);
    e.target.value = '';
});

function updateTexCount() {
    const el = document.getElementById('tex-count');
    el.textContent = texRegistry.size > 0 ? texRegistry.size + ' tex' : '';
}

// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, ok = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (ok ? ' ok' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.className = '', 3500);
}

// ══════════════════════════════════════════════════════
//  ANIMATION LOOP
// ══════════════════════════════════════════════════════
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    // Spring bones
    springBones.forEach(sb => { if (sb.enabled !== false) sb.update(dt); });

    // Soft body groups
    softGroups.forEach(g => g.update(dt));

    controls.update();
    renderer.render(scene, camera);
}
animate();
