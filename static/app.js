/* ═══════════════════════════════════════════════════
   OSCILLATION LAB — app.js
   Fixes: binary search, drag hitbox, orientation toggle,
          smart solver UI, damping badge, advanced params
═══════════════════════════════════════════════════ */

'use strict';

// ─── WebSocket ────────────────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${window.location.host}/ws`);

// ─── Global State ────────────────────────────────────────────────────────────
const state = {
    single:      null,   // { t, x, v, zeta, category, c_critical }
    compare:     null,   // { "Tanpa Redaman": {...}, ... }
    simIndex:    0,
    isPlaying:   true,
    isDragging:  false,
    simTime:     0,
    orientation: 'vertical',   // 'vertical' | 'horizontal'
    graphMode:   'same',
    activePresets: new Set(),
    lastPlotMs:  0,
    // Holds the dropped x value while we wait for the backend to recompute
    // the trajectory for it — prevents the brief "snap back to old x0"
    // flash that happened while the old array was still being used.
    freezeX:     null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const mEl   = $('m'),   cEl  = $('c'),  kEl  = $('k');
const x0El  = $('x0'),  v0El = $('v0'), tmaxEl = $('t_max');
const tmaxValEl = $('t_max_val');

// ─── Helpers ──────────────────────────────────────────────────────────────────
// NOTE: `value || default` is a bug when a legit value of 0 is entered
// (0 is falsy in JS, so it silently falls back to `default`). Use isNaN instead.
const numOr = (el, def) => {
    const v = parseFloat(el.value);
    return Number.isNaN(v) ? def : v;
};
const getM    = () => Math.max(numOr(mEl, 1.0),  0.01);
const getC    = () => Math.max(numOr(cEl, 0.0),  0.0);
const getK    = () => Math.max(numOr(kEl, 10.0), 0.01);
const getX0   = () => numOr(x0El, 5.0);
const getV0   = () => numOr(v0El, 0.0);
const getTmax = () => numOr(tmaxEl, 20.0);

/** Binary search: find first index where t[i] >= target. O(log n). */
function bsearch(arr, target) {
    let lo = 0, hi = arr.length - 1;
    if (target <= arr[0])  return 0;
    if (target >= arr[hi]) return hi;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// ─── Panel toggle ─────────────────────────────────────────────────────────────
function togglePanel(panelId, btnEl) {
    const panel = $(panelId);
    const isActive = panel.classList.contains('active');

    // Remove active from all
    document.querySelectorAll('.panel').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));

    if (!isActive) {
        panel.style.display = 'flex';
        // Force reflow for transition
        void panel.offsetWidth;
        panel.classList.add('active');
        btnEl.classList.add('active');
        if (panelId === 'graph-panel') requestCompareData();
    }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
ws.onopen = () => sendSingleParams();

ws.onmessage = (evt) => {
    const res = JSON.parse(evt.data);

    if (res.mode === 'single') {
        state.single = res.data;
        state.simTime = 0;
        state.simIndex = 0;
        updateDampingBadge(res.data);
        // If we're waiting for a drag-drop to be reflected, clear the
        // freeze once the new trajectory actually starts at that x value.
        if (state.freezeX !== null && Math.abs(res.data.x[0] - state.freezeX) < 0.01) {
            state.freezeX = null;
        }
        renderLivePlot(0, res.data.x[0]);
    } else if (res.mode === 'compare') {
        state.compare = res.data;
        renderPresetGraphs();
    } else if (res.mode === 'smart_solver') {
        displaySolverResult(res.data);
    }
};

ws.onerror = (e) => console.error('WS error', e);

function sendSingleParams() {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        mode: 'single',
        m: getM(), c: getC(), k: getK(),
        x0: getX0(), v0: getV0(), t_max: getTmax(),
    }));
}

function requestCompareData() {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        mode: 'compare',
        m: getM(), k: getK(), x0: getX0(), v0: getV0(), t_max: getTmax(),
    }));
}

// ─── Input listeners ──────────────────────────────────────────────────────────
[mEl, cEl, kEl, x0El].forEach(el => el.addEventListener('input', debounce(() => {
    sendSingleParams();
    if (state.compare) requestCompareData();
}, 200)));

v0El.addEventListener('input', debounce(() => {
    sendSingleParams();
    if (state.compare) requestCompareData();
}, 200));

// T_max: update the displayed label live, but only push to the backend
// (and thus reset the simulation) once the user releases the slider.
// The old code created a fresh debounce() on every 'input' tick and fired
// it immediately, which queued a burst of WS sends + simTime resets while
// dragging — that's what caused the "loop/stutter" at the start.
tmaxEl.addEventListener('input', () => {
    tmaxValEl.textContent = tmaxEl.value + 's';
});
tmaxEl.addEventListener('change', () => {
    sendSingleParams();
    if (state.compare) requestCompareData();
});

$('chk-orientation').addEventListener('change', (e) => {
    state.orientation = e.target.checked ? 'horizontal' : 'vertical';
});

// Loop toggle label follows the checkbox state
$('chk-loop').addEventListener('change', (e) => {
    $('loop-label').textContent = e.target.checked ? 'Loop' : 'No-loop';
});

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Damping Badge ────────────────────────────────────────────────────────────
function updateDampingBadge(data) {
    const badge   = $('damping-badge');
    const catEl   = $('badge-cat');
    const zetaEl  = badge.querySelector('.badge-zeta');

    zetaEl.textContent = `ζ = ${(data.zeta || 0).toFixed(3)}`;
    catEl.textContent  = data.category || '—';

    catEl.className = ''; // reset
    const map = {
        'Undamped':          'cat-undamped',
        'Underdamped':       'cat-under',
        'Critically Damped': 'cat-critical',
        'Overdamped':        'cat-over',
    };
    catEl.classList.add(map[data.category] || '');
}

// ─── Plotly config ────────────────────────────────────────────────────────────
const PLOTLY_LAYOUT = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor:  'rgba(0,0,0,0)',
    font:          { color: '#8890a8', family: 'Space Mono, monospace', size: 11 },
    margin:        { t: 10, l: 44, r: 14, b: 36 },
    showlegend:    true,
    legend:        { bgcolor: 'rgba(0,0,0,0)', font: { size: 10 } },
    xaxis: {
        color: '#50586a', gridcolor: 'rgba(255,255,255,0.05)',
        zerolinecolor: 'rgba(255,255,255,0.1)', title: 't (s)',
    },
    yaxis: {
        color: '#50586a', gridcolor: 'rgba(255,255,255,0.05)',
        zerolinecolor: 'rgba(255,255,255,0.1)', title: 'x (m)',
    },
};
const PLOTLY_CFG = { responsive: true, displayModeBar: false };

// Live plot: path + moving dot
function renderLivePlot(currentT, currentX) {
    if (!state.single) return;
    const { t, x } = state.single;
    Plotly.react('live-plot', [
        {
            x: t, y: x, type: 'scatter', mode: 'lines', name: 'x(t)',
            line: { color: '#4af0c4', width: 1.5 },
        },
        {
            x: [currentT], y: [currentX], type: 'scatter', mode: 'markers',
            name: 'Mass', showlegend: false,
            marker: { color: '#f05a4a', size: 10, symbol: 'circle' },
        },
    ], { ...PLOTLY_LAYOUT }, PLOTLY_CFG);
}

// ─── Graph Panel ──────────────────────────────────────────────────────────────
function changeGraphMode() {
    state.graphMode = document.querySelector('input[name="gmode"]:checked').value;
    renderPresetGraphs();
}

const PRESET_COLORS = {
    'Tanpa Redaman':    '#4af0c4',
    'Underdamped':      '#4a8af0',
    'Critically Damped':'#f0a44a',
    'Overdamped':       '#f05a4a',
};

function togglePreset(id, name) {
    const btn = $(`btn-${id}`);
    if (state.activePresets.has(name)) {
        state.activePresets.delete(name);
        btn.classList.remove('active-preset');
    } else {
        state.activePresets.add(name);
        btn.classList.add('active-preset');

        // Set c value to the selected preset's damping
        const m = getM(), k = getK();
        const cc = 2 * Math.sqrt(m * k);
        const presetC = { none: 0, under: cc * 0.2, crit: cc, over: cc * 2.5 };
        if (presetC[id] !== undefined) {
            cEl.value = presetC[id].toFixed(3);
            sendSingleParams();
        }
    }
    renderPresetGraphs();
}

function showAllPresets() {
    state.activePresets = new Set(['Tanpa Redaman', 'Underdamped', 'Critically Damped', 'Overdamped']);
    document.querySelectorAll('[id^="btn-"]').forEach(b => b.classList.add('active-preset'));
    if (!state.compare) requestCompareData();
    else renderPresetGraphs();
}

function clearPresets() {
    state.activePresets.clear();
    document.querySelectorAll('[id^="btn-"]').forEach(b => b.classList.remove('active-preset'));
    renderPresetGraphs();
}

function renderPresetGraphs() {
    const container = $('preset-plot-container');
    container.innerHTML = '';
    if (!state.compare || state.activePresets.size === 0) return;

    if (state.graphMode === 'same') {
        const div = document.createElement('div');
        div.id = 'combo-plot';
        div.className = 'plot-box';
        div.style.cssText = 'width:100%; height:380px; flex:unset;';
        container.appendChild(div);

        const traces = [...state.activePresets].map(name => ({
            x: state.compare[name].t,
            y: state.compare[name].x,
            name, type: 'scatter', mode: 'lines',
            line: { color: PRESET_COLORS[name], width: 2 },
        }));
        Plotly.newPlot('combo-plot', traces, { ...PLOTLY_LAYOUT, showlegend: true }, PLOTLY_CFG);
    } else {
        [...state.activePresets].forEach(name => {
            const divId = `plot-${name.replace(/\s/g, '_')}`;
            const div = document.createElement('div');
            div.id = divId; div.className = 'plot-box';
            container.appendChild(div);
            Plotly.newPlot(divId, [{
                x: state.compare[name].t,
                y: state.compare[name].x,
                type: 'scatter', mode: 'lines', name,
                line: { color: PRESET_COLORS[name], width: 2 },
            }], {
                ...PLOTLY_LAYOUT,
                title: { text: name, font: { color: PRESET_COLORS[name], size: 12 } },
                showlegend: false,
            }, PLOTLY_CFG);
        });
    }
}

// ─── P5.js Animation ──────────────────────────────────────────────────────────
const CANVAS_W = 380;
const CANVAS_H = 380;
const SCALE    = 18;   // px per meter

const sketch = (p) => {
    p.setup = () => {
        const canvas = p.createCanvas(CANVAS_W, CANVAS_H);
        canvas.parent('canvas-container');
    };

    p.draw = () => {
        p.background(28, 32, 48); // --bg3

        const horiz    = state.orientation === 'horizontal';
        const showEq   = $('chk-eq').checked;
        const showNl   = $('chk-nl').checked;
        const speed    = parseFloat($('speed-select').value);

        const tArr = state.single ? state.single.t : [];
        const xArr = state.single ? state.single.x : [];
        if (tArr.length === 0) { _drawWaiting(p); return; }

        // ── Advance time ──
        let currentX, currentT;

        if (state.isDragging) {
            // Dragging: read mouse
            if (horiz) {
                currentX = (p.mouseX - CANVAS_W / 2) / SCALE;
            } else {
                currentX = (p.mouseY - CANVAS_H / 2) / SCALE;
            }
            currentX  = p.constrain(currentX, -10, 10);
            currentT  = 0;
            x0El.value = currentX.toFixed(2);
        } else if (state.freezeX !== null) {
            // Just dropped — show the dropped position instead of the
            // stale old trajectory's x0 while we wait for the backend.
            currentX = state.freezeX;
            currentT = 0;
        } else {
            if (state.isPlaying) state.simTime += (p.deltaTime / 1000) * speed;

            // Binary search — O(log n) instead of O(n)
            const idx = bsearch(tArr, state.simTime);
            currentX = xArr[idx];
            currentT = tArr[idx];

            // End of simulation reached
            if (state.simTime > tArr[tArr.length - 1]) {
                if ($('chk-loop').checked) {
                    state.simTime = 0;
                } else {
                    // Non-loop: clamp at the final position and stop.
                    // (bsearch already clamps idx to the last point, so
                    // currentX/currentT are correct without further work.)
                    state.simTime = tArr[tArr.length - 1];
                    if (state.isPlaying) {
                        state.isPlaying = false;
                        $('btn-play').textContent = '▶ Play';
                    }
                }
            }
        }

        // ── Live x / T readout (updated every frame — cheap text writes) ──
        $('readout-x').textContent = currentX.toFixed(3);
        $('readout-t').textContent = currentT.toFixed(3);

        // ── Throttle Plotly update ~20fps ──
        if (p.millis() - state.lastPlotMs > 50) {
            state.lastPlotMs = p.millis();
            renderLivePlot(currentT, currentX);
        }

        // ── Draw ──
        if (horiz) {
            _drawHorizontal(p, currentX, showEq, showNl);
        } else {
            _drawVertical(p, currentX, showEq, showNl);
        }

        // ── Cursor ──
        const massPos = _getMassScreenPos(p, currentX, horiz);
        const dist    = p.dist(p.mouseX, p.mouseY, massPos.x, massPos.y);
        p.cursor(dist < 32 || state.isDragging ? p.HAND : p.ARROW);
    };

    // ── Vertical layout ──
    function _drawVertical(p, currentX, showEq, showNl) {
        p.push(); p.translate(CANVAS_W / 2, CANVAS_H / 2);

        const massY = currentX * SCALE;
        const topY  = -CANVAS_H / 2 + 20;  // ceiling anchor

        // Equilibrium line
        if (showEq) {
            p.stroke(74, 240, 196, 100); p.strokeWeight(1);
            p.line(-80, 0, 80, 0);
            p.fill(74, 240, 196, 120); p.noStroke();
            p.textSize(9); p.textAlign(p.RIGHT); p.text('eq', -82, 4);
        }

        // Natural length line
        if (showNl) {
            const nlY = -(getM() * 9.81 / getK()) * SCALE;
            p.stroke(240, 164, 74, 100); p.strokeWeight(1);
            p.line(-80, nlY, 80, nlY);
            p.fill(240, 164, 74, 120); p.noStroke();
            p.textSize(9); p.textAlign(p.RIGHT); p.text('nat', -82, nlY + 4);
        }

        // Ceiling
        p.fill(60, 70, 90); p.noStroke(); p.rect(-50, topY, 100, 12, 2);

        // Spring (zig-zag)
        _drawSpring(p, 0, topY + 12, 0, massY - 22, 12, 8);

        // Mass block
        _drawMass(p, 0, massY, state.isDragging);

        p.pop();
    }

    // ── Horizontal layout ──
    function _drawHorizontal(p, currentX, showEq, showNl) {
        p.push(); p.translate(CANVAS_W / 2, CANVAS_H / 2);

        const massX  = currentX * SCALE;
        const wallX  = -CANVAS_W / 2 + 20; // left wall anchor

        // Equilibrium line
        if (showEq) {
            p.stroke(74, 240, 196, 100); p.strokeWeight(1);
            p.line(0, -70, 0, 70);
            p.fill(74, 240, 196, 120); p.noStroke();
            p.textSize(9); p.textAlign(p.CENTER); p.text('eq', 0, -74);
        }

        // Wall
        p.fill(60, 70, 90); p.noStroke(); p.rect(wallX - 12, -50, 12, 100, 2);
        p.stroke(50, 60, 80); p.strokeWeight(1);
        for (let i = -44; i <= 44; i += 12) {
            p.line(wallX - 12, i, wallX - 20, i + 8);
        }

        // Spring (horizontal zig-zag)
        _drawSpringH(p, wallX, 0, massX - 22, 0, 10, 8);

        // Mass block
        _drawMassH(p, massX, 0, state.isDragging);

        p.pop();
    }

    // ── Spring drawing (vertical) ──
    function _drawSpring(p, x1, y1, x2, y2, coils, amplitude) {
        const len  = y2 - y1;
        const step = len / (coils * 2 + 2);
        p.stroke(100, 120, 160); p.strokeWeight(1.5); p.noFill();
        p.beginShape();
        p.vertex(x1, y1);
        p.vertex(x1, y1 + step);
        for (let i = 0; i < coils * 2; i++) {
            const xOff = (i % 2 === 0) ? amplitude : -amplitude;
            p.vertex(x1 + xOff, y1 + step + (i + 0.5) * step);
            p.vertex(x1 + xOff, y1 + step + (i + 1) * step);
        }
        p.vertex(x1, y2 - step);
        p.vertex(x1, y2);
        p.endShape();
    }

    // ── Spring drawing (horizontal) ──
    function _drawSpringH(p, x1, y1, x2, y2, coils, amplitude) {
        const len  = x2 - x1;
        const step = len / (coils * 2 + 2);
        p.stroke(100, 120, 160); p.strokeWeight(1.5); p.noFill();
        p.beginShape();
        p.vertex(x1, y1);
        p.vertex(x1 + step, y1);
        for (let i = 0; i < coils * 2; i++) {
            const yOff = (i % 2 === 0) ? -amplitude : amplitude;
            p.vertex(x1 + step + (i + 0.5) * step, y1 + yOff);
            p.vertex(x1 + step + (i + 1) * step,   y1 + yOff);
        }
        p.vertex(x2 + step, y1);
        p.vertex(x2 + step * 2, y1);
        p.endShape();
    }

    // ── Mass block (vertical) ──
    function _drawMass(p, cx, cy, dragging) {
        const col = dragging ? [240, 90, 74] : [74, 138, 240];
        p.fill(...col, 200); p.stroke(...col); p.strokeWeight(1.5);
        p.rectMode(p.CENTER); p.rect(cx, cy, 44, 44, 8);
        p.fill(255); p.noStroke();
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(11); p.textFont('Space Mono, monospace');
        p.text(`${getM()}kg`, cx, cy);
    }

    // ── Mass block (horizontal) ──
    function _drawMassH(p, cx, cy, dragging) {
        const col = dragging ? [240, 90, 74] : [74, 138, 240];
        p.fill(...col, 200); p.stroke(...col); p.strokeWeight(1.5);
        p.rectMode(p.CENTER); p.rect(cx, cy, 44, 44, 8);
        p.fill(255); p.noStroke();
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(11); p.textFont('Space Mono, monospace');
        p.text(`${getM()}kg`, cx, cy);
    }

    function _drawWaiting(p) {
        p.fill(80, 88, 106); p.textAlign(p.CENTER, p.CENTER);
        p.textSize(12); p.text('Connecting…', CANVAS_W / 2, CANVAS_H / 2);
    }

    // Returns screen position of mass centre for hitbox
    function _getMassScreenPos(p, currentX, horiz) {
        if (horiz) {
            return { x: CANVAS_W / 2 + currentX * SCALE, y: CANVAS_H / 2 };
        }
        return { x: CANVAS_W / 2, y: CANVAS_H / 2 + currentX * SCALE };
    }

    // ── Drag interaction ──
    p.mousePressed = () => {
        if (!state.single) return;
        const horiz   = state.orientation === 'horizontal';
        // Use CURRENT animated position for hitbox (fixes the original bug).
        // NOTE: don't fall back with `|| getX0()` — if x[idx] is legitimately
        // 0, `0 || getX0()` would wrongly evaluate to getX0() (same bug as a3).
        const idx     = bsearch(state.single.t, state.simTime);
        const curX    = (state.freezeX !== null) ? state.freezeX : state.single.x[idx];
        const massPos = horiz
            ? { x: CANVAS_W / 2 + curX * SCALE,  y: CANVAS_H / 2 }
            : { x: CANVAS_W / 2,                  y: CANVAS_H / 2 + curX * SCALE };

        if (p.dist(p.mouseX, p.mouseY, massPos.x, massPos.y) < 38) {
            state.isDragging = true;
            state.isPlaying  = false;
            state.simTime    = 0;
            state.freezeX    = null;
        }
    };

    p.mouseReleased = () => {
        if (!state.isDragging) return;
        state.isDragging = false;
        state.simTime    = 0;
        // Freeze the canvas on the dropped position until the backend
        // sends back a trajectory that actually starts there.
        state.freezeX    = getX0();

        // Restart playback and push new params
        const wasPlaying = $('btn-play').textContent.includes('Pause');
        state.isPlaying  = wasPlaying;
        sendSingleParams();
        if (state.compare) requestCompareData();
    };
};

new p5(sketch);

// ─── Play / Restart buttons ───────────────────────────────────────────────────
$('btn-play').addEventListener('click', (e) => {
    state.isPlaying = !state.isPlaying;
    e.target.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
});

$('btn-restart').addEventListener('click', () => {
    state.simTime  = 0;
    state.isPlaying = true;
    $('btn-play').textContent = '⏸ Pause';
});

// ─── Smart Solver ─────────────────────────────────────────────────────────────
function onSolverTypeChange() {
    const type = document.querySelector('input[name="stype"]:checked').value;
    document.querySelectorAll('.solver-inputs').forEach(el => el.classList.add('hidden'));
    $(`solver-form-${type}`).classList.remove('hidden');
}

// Handle the solve_for toggle in spring_constant solver
$('sk-for').addEventListener('change', () => {
    const val = $('sk-for').value;
    $('sk-row-m').classList.toggle('hidden', val !== 'k');
    $('sk-row-k').classList.toggle('hidden', val !== 'm');
});

function runSolver() {
    if (ws.readyState !== WebSocket.OPEN) return;
    const type = document.querySelector('input[name="stype"]:checked').value;

    let payload = { mode: 'smart_solver', solver_type: type };

    if (type === 'position') {
        Object.assign(payload, {
            m:  parseFloat($('sl-m').value)  || 1,
            c:  parseFloat($('sl-c').value)  || 0,
            k:  parseFloat($('sl-k').value)  || 10,
            x0: parseFloat($('sl-x0').value) || 5,
            v0: parseFloat($('sl-v0').value) || 0,
            t:  parseFloat($('sl-t').value)  || 1,
        });
    } else if (type === 'critical_c') {
        Object.assign(payload, {
            m: parseFloat($('slc-m').value) || 1,
            k: parseFloat($('slc-k').value) || 10,
        });
    } else if (type === 'spring_constant') {
        Object.assign(payload, {
            solve_for: $('sk-for').value,
            omega_n:   parseFloat($('sk-omega').value) || 3.16,
            m:         parseFloat($('sk-m').value)     || 1,
            k:         parseFloat($('sk-k').value)     || 10,
        });
    }

    // Show loading
    const out = $('solver-output');
    out.innerHTML = `<div class="solver-placeholder"><span>Calculating…</span></div>`;
    ws.send(JSON.stringify(payload));
}

function displaySolverResult(data) {
    if (data.error) {
        $('solver-output').innerHTML = `<div class="solver-placeholder"><span style="color:#f05a4a">${data.error}</span></div>`;
        return;
    }

    const steps = data.steps || [];
    const html  = `
        <div class="solver-steps">
            ${steps.map((s, i) => `
                <div class="solver-step" style="animation-delay:${i * 40}ms">
                    ${_md2html(s)}
                </div>`).join('')}
        </div>
        ${data.answer ? `<div class="solver-answer">${data.answer}</div>` : ''}
        ${data.answer_v ? `<div class="solver-answer" style="margin-top:6px;color:#4a8af0;border-color:rgba(74,138,240,0.3);background:rgba(74,138,240,0.08)">${data.answer_v}</div>` : ''}
    `;
    $('solver-output').innerHTML = html;

    // Re-run MathJax on the new content. The script tag is `async`, so on
    // a fast WS round-trip `window.MathJax` may exist (the config stub) but
    // `MathJax.typesetPromise` might not be attached yet — wait for the
    // startup promise in that case instead of silently skipping typesetting.
    const node = $('solver-output');
    if (window.MathJax && window.MathJax.typesetPromise) {
        MathJax.typesetPromise([node]);
    } else if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
        window.MathJax.startup.promise.then(() => MathJax.typesetPromise([node]));
    }
}

/** Minimal markdown bold + inline code → HTML */
function _md2html(s) {
    return s
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}