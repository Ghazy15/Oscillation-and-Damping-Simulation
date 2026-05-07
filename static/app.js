const ws = new WebSocket(`ws://${window.location.host}/ws`);
let physicsData = { single: null, compare: null };

// State
let isPlaying = true;
let simTime = 0;
let isDragging = false;
let graphMode = 'same'; 
let activePresets = new Set(); 
let lastPlotUpdate = 0; // Throttles Plotly rendering for performance

// UI Elements
const mInput = document.getElementById('m');
const cInput = document.getElementById('c');
const kInput = document.getElementById('k');
const x0Input = document.getElementById('x0');

// --- Dynamic Layout Toggles ---
function togglePanel(panelId, btnElement) {
    const panel = document.getElementById(panelId);
    if (panel.classList.contains('active')) {
        // Trigger Shrink Animation
        panel.classList.remove('active');
        btnElement.classList.remove('active');
        setTimeout(() => {
            if(!panel.classList.contains('active')) panel.style.display = 'none';
        }, 300); // Wait for CSS transition to finish
    } else {
        // Trigger Pop Animation
        panel.style.display = 'flex';
        void panel.offsetWidth; // Force browser reflow
        panel.classList.add('active');
        btnElement.classList.add('active');
        if(panelId === 'graph-panel') requestCompareData(); 
    }
}

// --- WebSocket Comms ---
ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    if (response.mode === 'single') {
        physicsData.single = response.data;
        updateLivePlotWithDot(0, response.data.x[0]); // Reset plot
    } else if (response.mode === 'compare') {
        physicsData.compare = response.data;
        renderPresetGraphs();
    }
};

function sendSingleParams() {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            m: parseFloat(mInput.value) || 0.1, c: parseFloat(cInput.value) || 0,
            k: parseFloat(kInput.value) || 0, x0: parseFloat(x0Input.value) || 0, mode: "single"
        }));
    }
}

function requestCompareData() {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ m: mInput.value, k: kInput.value, x0: x0Input.value, mode: "compare" }));
    }
}

[mInput, cInput, kInput, x0Input].forEach(el => el.addEventListener('change', () => {
    sendSingleParams(); requestCompareData(); 
}));

// --- Graph & Preset Logic ---
function changeGraphMode() { graphMode = document.querySelector('input[name="gmode"]:checked').value; renderPresetGraphs(); }

function togglePreset(id, name) {
    const btn = document.getElementById(`btn-${id}`);
    if (activePresets.has(name)) {
        activePresets.delete(name); btn.classList.remove('active-preset');
    } else {
        activePresets.add(name); btn.classList.add('active-preset');
        let m = parseFloat(mInput.value), k = parseFloat(kInput.value);
        let c_crit = 2 * Math.sqrt(m * k);
        if(id === 'none') cInput.value = 0;
        if(id === 'under') cInput.value = (c_crit * 0.2).toFixed(2);
        if(id === 'crit') cInput.value = c_crit.toFixed(2);
        if(id === 'over') cInput.value = (c_crit * 2.5).toFixed(2);
        sendSingleParams(); 
    }
    renderPresetGraphs();
}

function showAllPresets() {
    activePresets = new Set(["Tanpa Redaman", "Underdamped", "Critically Damped", "Overdamped"]);
    document.querySelectorAll('.preset-buttons button[id^="btn-"]').forEach(b => b.classList.add('active-preset'));
    renderPresetGraphs();
}

function clearPresets() {
    activePresets.clear();
    document.querySelectorAll('.preset-buttons button').forEach(b => b.classList.remove('active-preset'));
    renderPresetGraphs();
}

// --- Plotly Renderers ---
const layoutConfig = { margin: { t: 30, l: 40, r: 20, b: 30 }, showlegend: true };

// This draws the main line AND the moving red dot
function updateLivePlotWithDot(currentT, currentX) {
    if(!physicsData.single) return;
    Plotly.react('live-plot', [
        { x: physicsData.single.t, y: physicsData.single.x, type: 'scatter', line: {color: '#3498db'}, name: 'Path' },
        { x: [currentT], y: [currentX], type: 'scatter', mode: 'markers', marker: {color: '#e74c3c', size: 12}, name: 'Mass' }
    ], { ...layoutConfig, title: 'Live Oscillation', showlegend: false });
}

function renderPresetGraphs() {
    const container = document.getElementById('preset-plot-container');
    container.innerHTML = ''; 
    if (!physicsData.compare || activePresets.size === 0) return;

    if (graphMode === 'same') {
        container.innerHTML = '<div id="combo-plot" class="plot-box" style="width:100%; height:400px;"></div>';
        let traces = [];
        activePresets.forEach(name => {
            traces.push({ x: physicsData.compare[name].t, y: physicsData.compare[name].x, name: name, type: 'scatter' });
        });
        Plotly.newPlot('combo-plot', traces, { ...layoutConfig, title: 'Combined Comparison' });
    } else {
        activePresets.forEach(name => {
            let divId = `plot-${name.replace(/\s/g, '')}`;
            let div = document.createElement('div');
            div.id = divId; div.className = 'plot-box'; container.appendChild(div);
            Plotly.newPlot(divId, [{ x: physicsData.compare[name].t, y: physicsData.compare[name].x, name: name, type: 'scatter' }], 
                { ...layoutConfig, title: name, showlegend: false }
            );
        });
    }
}

// --- P5.js Animation ---
document.getElementById('btn-play').onclick = (e) => { isPlaying = !isPlaying; e.target.innerText = isPlaying ? "Pause" : "Play"; };
document.getElementById('btn-restart').onclick = () => { simTime = 0; };

let sketch = (p) => {
    p.setup = () => { let canvas = p.createCanvas(350, 350); canvas.parent('canvas-container'); };
    
    p.draw = () => {
        p.background(250); p.translate(p.width / 2, 60);
        let showEq = document.getElementById('chk-eq').checked;
        let showNl = document.getElementById('chk-nl').checked;
        let speed = parseFloat(document.getElementById('speed-select').value);

        let tArray = physicsData.single ? physicsData.single.t : [];
        let xArray = physicsData.single ? physicsData.single.x : [];
        if(tArray.length === 0) return;

        let scalePixel = 15; 
        let currentX, currentT;

        if (isDragging) {
            currentX = (p.mouseY - 60 - 80) / scalePixel; 
            currentT = 0;
            x0Input.value = currentX.toFixed(1); 
        } else {
            if (isPlaying) simTime += (p.deltaTime / 1000) * speed;
            
            // INFINITE TIMELINE LOGIC
            let idx = tArray.findIndex(t => t >= simTime);
            if (idx === -1 && simTime > 0) {
                // If time exceeds array, stay at final position (equilibrium)
                currentX = xArray[xArray.length - 1];
                currentT = tArray[tArray.length - 1];
            } else {
                currentX = idx >= 0 ? xArray[idx] : xArray[0];
                currentT = idx >= 0 ? tArray[idx] : tArray[0];
            }
        }

        // Throttle Graph Update to avoid frame lag (~20fps update)
        if (p.millis() - lastPlotUpdate > 50) {
            lastPlotUpdate = p.millis();
            updateLivePlotWithDot(currentT, currentX);
        }

        let visualY = 80 + (currentX * scalePixel);

        // Lines
        if (showEq) { p.stroke(0, 255, 0); p.line(-100, 80, 100, 80); }
        if (showNl) { 
            let nlY = 80 - (parseFloat(mInput.value) * 9.81 / parseFloat(kInput.value) * scalePixel);
            p.stroke(255, 0, 0); p.line(-100, nlY, 100, nlY); 
        }

        p.fill(50); p.rectMode(p.CENTER); p.rect(0, -20, 80, 10); 
        p.stroke(100); p.strokeWeight(2); p.noFill(); 
        p.beginShape(); p.vertex(0, -15);
        for (let i = 1; i <= 10; i++) {
            let sy = p.map(i, 0, 11, -15, visualY - 20);
            p.vertex(i % 2 == 0 ? 15 : -15, sy);
        }
        p.vertex(0, visualY - 20); p.endShape();

        // Mass (Cursor pointer check inside draw)
        let massHitbox = p.dist(p.mouseX, p.mouseY, p.width / 2, visualY + 60) < 50;
        if (massHitbox || isDragging) p.cursor(p.HAND); else p.cursor(p.ARROW);

        p.fill(isDragging ? '#e74c3c' : '#3498db'); p.noStroke(); 
        p.rect(0, visualY, 40, 40, 5);
        p.fill(255); p.textAlign(p.CENTER, p.CENTER); p.text(mInput.value, 0, visualY);
    };

    // LARGER HITBOX LOGIC (radius increased to 50)
    p.mousePressed = () => {
        let massY = 80 + (parseFloat(x0Input.value) * 15) + 60; 
        if (p.dist(p.mouseX, p.mouseY, p.width / 2, massY) < 50) {
            isDragging = true; isPlaying = false;
        }
    };
    
    p.mouseReleased = () => {
        if (isDragging) {
            isDragging = false; simTime = 0;
            sendSingleParams(); 
            requestCompareData(); 
            if (document.getElementById('btn-play').innerText === "Pause") isPlaying = true;
        }
    };
};
new p5(sketch);