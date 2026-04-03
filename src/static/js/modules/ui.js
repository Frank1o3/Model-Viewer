// ══════════════════════════════════════════════════════
//  UI MODULE - User Interface Management
// ══════════════════════════════════════════════════════

import * as THREE from 'three';

/**
 * Panel and navigation management.
 * currentPanel and physicsMode are public so app.js can read them.
 */
export class UIManager {
    constructor() {
        this.currentPanel  = 'view';
        this.physicsMode   = 'bones';
        this.onStopPainting = null;
        this.onHUDUpdate    = null;
    }

    init() {
        // Main nav tabs
        document.querySelectorAll('.nav-tab').forEach(btn => {
            btn.addEventListener('click', () => this.switchPanel(btn.dataset.panel));
        });

        // View sub-tabs (textures / meshes)
        document.querySelectorAll('.vtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.vlist').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const target = document.getElementById('vlist-' + btn.dataset.vtab);
                if (target) target.classList.add('active');
            });
        });

        // Physics mode (bones / mesh)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.physicsMode = btn.dataset.phys;
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.phys-sub').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('phys-' + this.physicsMode)?.classList.add('active');
                this.onStopPainting?.();
            });
        });
    }

    switchPanel(panelName) {
        this.currentPanel = panelName;
        document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`.nav-tab[data-panel="${panelName}"]`)?.classList.add('active');
        document.getElementById('panel-' + panelName)?.classList.add('active');
        this.onHUDUpdate?.();
        if (panelName !== 'physics') this.onStopPainting?.();
    }

    /**
     * @param {THREE.Bone|null} selectedBone
     * @param {'paint'|'erase'|null} paintMode
     */
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

// ── Toast ──────────────────────────────────────────────
let _toastTimer = null;

export function showToast(msg, ok = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (ok ? ' ok' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// ── Slider helpers ─────────────────────────────────────
export function sliderVal(id) {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : 0;
}

export function linkSlider(id, valId, dec = 1) {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(valId);
    if (!slider || !valEl) return;
    const update = () => { valEl.textContent = parseFloat(slider.value).toFixed(dec); };
    slider.addEventListener('input', update);
    update(); // initialise display
}

// ── Loading overlay ────────────────────────────────────
export function showLoading(visible, percent = 0, text = 'LOADING') {
    const el      = document.getElementById('loading');
    const pctEl   = document.getElementById('load-pct');
    const textEl  = document.getElementById('load-text');
    if (!el) return;
    el.classList.toggle('visible', visible);
    if (pctEl)  pctEl.textContent  = percent + '%';
    if (textEl) textEl.textContent = text;
}

// ── Texture count badge ────────────────────────────────
export function updateTexCount(count) {
    const el = document.getElementById('tex-count');
    if (el) el.textContent = count > 0 ? count + ' tex' : '';
}
