// ══════════════════════════════════════════════════════
//  UI MODULE - User Interface Management
// ══════════════════════════════════════════════════════

import * as THREE from 'three';

/**
 * Panel and navigation management
 */
export class UIManager {
    constructor() {
        this.currentPanel = 'view';
        this.physicsMode = 'bones';
    }

    init() {
        // Tab navigation
        document.querySelectorAll('.nav-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchPanel(btn.dataset.panel);
            });
        });

        // View sub-tabs
        document.querySelectorAll('.vtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.vlist').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('vlist-' + btn.dataset.vtab).classList.add('active');
                if (this.onViewCountChange) this.onViewCountChange();
            });
        });

        // Physics mode tabs
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.physicsMode = btn.dataset.phys;
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.phys-sub').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('phys-' + this.physicsMode).classList.add('active');
                if (this.onStopPainting) this.onStopPainting();
            });
        });
    }

    switchPanel(panelName) {
        this.currentPanel = panelName;
        document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        const activeTab = document.querySelector(`.nav-tab[data-panel="${panelName}"]`);
        if (activeTab) activeTab.classList.add('active');
        document.getElementById('panel-' + panelName).classList.add('active');
        
        if (this.onHUDUpdate) this.onHUDUpdate();
        
        // Stop brush if leaving physics panel
        if (panelName !== 'physics' && this.onStopPainting) {
            this.onStopPainting();
        }
    }

    updateHUD(selectedBone, paintMode) {
        const el = document.getElementById('hud-mode');
        if (!el) return;

        if (this.currentPanel === 'bones' && selectedBone) {
            el.textContent = '🦴 BONE MODE';
        } else if (this.currentPanel === 'physics' && this.physicsMode === 'mesh' && paintMode) {
            el.textContent = paintMode === 'paint' ? '🖌 PAINT MODE' : '✕ ERASE MODE';
        } else {
            el.textContent = '';
        }
    }
}

/**
 * Toast notification system
 */
let _toastTimer = null;

export function showToast(msg, ok = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    
    el.textContent = msg;
    el.className = 'show' + (ok ? ' ok' : '');
    
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.className = '', 3500);
}

/**
 * Slider utility functions
 */
export function sliderVal(id) {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : 0;
}

export function linkSlider(id, valId, dec = 1) {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (!slider || !valEl) return;

    const update = () => {
        valEl.textContent = sliderVal(id).toFixed(dec);
    };
    slider.addEventListener('input', update);
    update();
}

/**
 * Brush cursor management
 */
export function initBrushCursor(scene) {
    const geo = new THREE.RingGeometry(0.02, 0.025, 32);
    const mat = new THREE.MeshBasicMaterial({ 
        color: 0x00e5a0, 
        transparent: true, 
        opacity: 0.8,
        side: THREE.DoubleSide 
    });
    const cursor = new THREE.Mesh(geo, mat);
    cursor.rotation.x = Math.PI / 2;
    cursor.visible = false;
    scene.add(cursor);
    return cursor;
}

export function updateBrushCursor(cursor, position, radius, visible) {
    if (!cursor) return;
    cursor.position.copy(position);
    cursor.scale.setScalar(radius / 0.02);
    cursor.visible = visible;
}

/**
 * Loading indicator management
 */
export function showLoading(visible, percent = 0, text = 'LOADING') {
    const loadingEl = document.getElementById('loading');
    const loadPct = document.getElementById('load-pct');
    const loadText = document.getElementById('load-text');
    
    if (!loadingEl) return;
    
    if (visible) {
        loadingEl.classList.add('visible');
        if (loadPct) loadPct.textContent = percent + '%';
        if (loadText) loadText.textContent = text;
    } else {
        loadingEl.classList.remove('visible');
    }
}

/**
 * Texture count display
 */
export function updateTexCount(count) {
    const el = document.getElementById('tex-count');
    if (el) {
        el.textContent = count > 0 ? count + ' tex' : '';
    }
}

/**
 * View count display
 */
export function updateViewCount(meshCount, materialCount) {
    const el = document.getElementById('view-count');
    if (el) {
        el.textContent = `${meshCount} meshes, ${materialCount} materials`;
    }
}
