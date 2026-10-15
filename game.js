/**
 * Main Web UI Controller & HTML5 Canvas Collapse Renderer
 */

let canvas, ctx;
let currentLevelNum = 1;
let currentLevel = null;
let selectedMember = null;
let selectedNode = null;
let selectedType = 'Tension';
let score = 0;
let levelTime = 0;
let timerInterval = null;
let isCollapsing = false;
let collapseParticles = [];
let collapseBeams = [];

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('trussCanvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    setupEventListeners();
    loadLevel(1);
    startLoop();
});

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

function loadLevel(num) {
    currentLevelNum = num;
    currentLevel = createLevelWeb(num);
    selectedMember = null;
    selectedNode = currentLevel.structure.nodes[0] || null;
    isCollapsing = false;
    levelTime = 0;

    document.getElementById('level-badge').innerText = `Level ${num}`;
    document.getElementById('level-title').innerText = currentLevel.name;
    document.getElementById('failure-overlay').classList.add('hidden');
    document.getElementById('victory-overlay').classList.add('hidden');
    document.getElementById('force-input').value = '';

    updateInspector();
    drawCanvas();
}

function setupEventListeners() {
    // Canvas click
    canvas.addEventListener('click', (e) => {
        if (isCollapsing) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check node click
        for (let n of currentLevel.structure.nodes) {
            let [sx, sy] = worldToScreen(n.x, n.y);
            if (Math.hypot(mx - sx, my - sy) <= 18) {
                selectedNode = n;
                updateInspector();
                return;
            }
        }

        // Check member click
        for (let m of currentLevel.structure.members) {
            let [ax, ay] = worldToScreen(m.nodeA.x, m.nodeA.y);
            let [bx, by] = worldToScreen(m.nodeB.x, m.nodeB.y);
            if (distToSegment(mx, my, ax, ay, bx, by) <= 12) {
                selectedMember = m;
                if (m.userForce !== null) {
                    document.getElementById('force-input').value = m.userForce;
                } else {
                    document.getElementById('force-input').value = '';
                }
                if (m.userType) setStressType(m.userType);
                updateInspector();
                return;
            }
        }
    });

    // Toggle switch buttons
    document.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            setStressType(btn.dataset.type);
        });
    });

    // Save Member Force
    document.getElementById('btn-save-member').addEventListener('click', () => {
        if (!selectedMember) return;
        let val = parseFloat(document.getElementById('force-input').value);
        if (!isNaN(val)) {
            selectedMember.userForce = val;
            selectedMember.userType = selectedType;
        }
        updateInspector();
        drawCanvas();
    });

    // Test & Submit Truss
    document.getElementById('btn-submit-truss').addEventListener('click', () => {
        let res = currentLevel.structure.checkAnswers();
        if (res.allCorrect) {
            score += 100 * currentLevelNum + Math.max(50, 300 - levelTime * 2);
            document.getElementById('score-val').innerText = score;
            document.getElementById('victory-overlay').classList.remove('hidden');
        } else {
            triggerCollapse(res.failed);
        }
    });

    // Retry / Next level
    document.getElementById('btn-retry-level').addEventListener('click', () => loadLevel(currentLevelNum));
    document.getElementById('btn-next-level').addEventListener('click', () => loadLevel(currentLevelNum + 1));

    // Modals
    document.getElementById('btn-team-credits').addEventListener('click', () => openModal('modal-team'));
    document.getElementById('btn-view-all-team').addEventListener('click', () => openModal('modal-team'));
    document.getElementById('btn-guide').addEventListener('click', () => openModal('modal-guide'));
    document.getElementById('btn-calc').addEventListener('click', () => openModal('modal-calc'));
    document.getElementById('btn-fbd').addEventListener('click', () => {
        openModal('modal-fbd');
        renderFBDContent();
    });

    document.querySelectorAll('.modal-close').forEach(b => {
        b.addEventListener('click', () => {
            document.getElementById(b.dataset.close).classList.add('hidden');
        });
    });

    // Mini Calculator logic
    document.querySelectorAll('.calc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let val = btn.dataset.val;
            let disp = document.getElementById('calc-display');
            if (val === 'C') disp.value = '0';
            else if (val === '=') {
                try {
                    let expr = disp.value.replace(/sin\(/g, 'Math.sin(Math.PI/180*')
                                         .replace(/cos\(/g, 'Math.cos(Math.PI/180*')
                                         .replace(/tan\(/g, 'Math.tan(Math.PI/180*')
                                         .replace(/sqrt\(/g, 'Math.sqrt(');
                    disp.value = eval(expr).toFixed(4);
                } catch (err) { disp.value = 'Error'; }
            } else {
                if (disp.value === '0') disp.value = val;
                else disp.value += val;
            }
        });
    });

    // Timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!isCollapsing) {
            levelTime++;
            document.getElementById('timer-val').innerText = `${levelTime}s`;
        }
    }, 1000);
}

function setStressType(type) {
    selectedType = type;
    document.querySelectorAll('.btn-toggle').forEach(b => {
        b.classList.remove('active-t', 'active-c', 'active-z');
        if (b.dataset.type === type) {
            if (type === 'Tension') b.classList.add('active-t');
            else if (type === 'Compression') b.classList.add('active-c');
            else b.classList.add('active-z');
        }
    });
}

function updateInspector() {
    let nameElem = document.getElementById('selected-member-name');
    let lenElem = document.getElementById('selected-member-length');

    if (selectedMember) {
        nameElem.innerText = `Selected Member: ${selectedMember.name}`;
        lenElem.innerText = `Length: ${selectedMember.length.toFixed(2)}m`;
    } else {
        nameElem.innerText = `Click any member beam to solve`;
        lenElem.innerText = `Length: --`;
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function worldToScreen(wx, wy) {
    let nodes = currentLevel.structure.nodes;
    let minX = Math.min(...nodes.map(n => n.x));
    let maxX = Math.max(...nodes.map(n => n.x));
    let minY = Math.min(...nodes.map(n => n.y));
    let maxY = Math.max(...nodes.map(n => n.y));

    let spanX = Math.max(1, maxX - minX);
    let spanY = Math.max(1, maxY - minY);
    let margin = 90;

    let availW = canvas.width - 2 * margin;
    let availH = canvas.height - 2 * margin;
    let scale = Math.min(availW / spanX, availH / spanY);

    let sx = margin + (wx - minX) * scale + (availW - spanX * scale) / 2;
    let sy = canvas.height - margin - (wy - minY) * scale - (availH - spanY * scale) / 2;
    return [sx, sy];
}

function distToSegment(px, py, x1, y1, x2, y2) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function triggerCollapse(failedMembers) {
    isCollapsing = true;
    collapseParticles = [];
    collapseBeams = [];
    let ts = currentLevel.structure;

    // Convert nodes to physics particles
    let nodeMap = {};
    for (let n of ts.nodes) {
        let [sx, sy] = worldToScreen(n.x, n.y);
        nodeMap[n.id] = {
            id: n.id, name: n.name, x: sx, y: sy,
            vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 20,
            pinned: n.support === 'pin'
        };
    }

    // Convert members to broken fragments
    for (let m of ts.members) {
        let na = nodeMap[m.nodeA.id];
        let nb = nodeMap[m.nodeB.id];
        let isFailed = failedMembers.includes(m);
        let midX = (na.x + nb.x) / 2;
        let midY = (na.y + nb.y) / 2;

        collapseBeams.push({
            na, nb, broken: isFailed || Math.random() < 0.4,
            frag1: { x: midX, y: midY, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200 },
            frag2: { x: midX, y: midY, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200 }
        });

        // Add sparks
        for (let k = 0; k < 20; k++) {
            collapseParticles.push({
                x: midX, y: midY,
                vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300,
                life: 1.0, color: '#f59e0b'
            });
        }
    }

    document.getElementById('failure-msg').innerText = `Equilibrium violated! Member(s) overloaded: ${failedMembers.map(m=>m.name).join(', ')}`;
    document.getElementById('failure-overlay').classList.remove('hidden');
}

function startLoop() {
    function loop() {
        if (isCollapsing) {
            updateCollapse();
        }
        drawCanvas();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

function updateCollapse() {
    let dt = 0.016;
    let gravity = 800;
    let floorY = canvas.height - 40;

    for (let b of collapseBeams) {
        if (!b.na.pinned) {
            b.na.vy += gravity * dt;
            b.na.x += b.na.vx * dt;
            b.na.y += b.na.vy * dt;
            if (b.na.y >= floorY) { b.na.y = floorY; b.na.vy = -b.na.vy * 0.3; }
        }
        if (!b.nb.pinned) {
            b.nb.vy += gravity * dt;
            b.nb.x += b.nb.vx * dt;
            b.nb.y += b.nb.vy * dt;
            if (b.nb.y >= floorY) { b.nb.y = floorY; b.nb.vy = -b.nb.vy * 0.3; }
        }

        if (b.broken) {
            b.frag1.vy += gravity * dt; b.frag1.x += b.frag1.vx * dt; b.frag1.y += b.frag1.vy * dt;
            b.frag2.vy += gravity * dt; b.frag2.x += b.frag2.vx * dt; b.frag2.y += b.frag2.vy * dt;
        }
    }

    for (let p of collapseParticles) {
        p.life -= dt * 1.5;
        p.vy += gravity * 0.5 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
    }
    collapseParticles = collapseParticles.filter(p => p.life > 0);
}

function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    if (isCollapsing) {
        // Draw collapse physics
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        for (let b of collapseBeams) {
            if (!b.broken) {
                ctx.beginPath(); ctx.moveTo(b.na.x, b.na.y); ctx.lineTo(b.nb.x, b.nb.y); ctx.stroke();
            } else {
                ctx.beginPath(); ctx.moveTo(b.na.x, b.na.y); ctx.lineTo(b.frag1.x, b.frag1.y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(b.nb.x, b.nb.y); ctx.lineTo(b.frag2.x, b.frag2.y); ctx.stroke();
            }
        }
        for (let p of collapseParticles) {
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        return;
    }

    let ts = currentLevel.structure;

    // Draw members
    for (let m of ts.members) {
        let [ax, ay] = worldToScreen(m.nodeA.x, m.nodeA.y);
        let [bx, by] = worldToScreen(m.nodeB.x, m.nodeB.y);

        let color = '#475569';
        if (m.userForce !== null) {
            color = (m.userType === 'Tension') ? '#ef4444' : ((m.userType === 'Compression') ? '#3b82f6' : '#94a3b8');
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = (m === selectedMember) ? 6 : 4;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        if (m === selectedMember) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Tag
        let mx = (ax + bx) / 2;
        let my = (ay + by) / 2;
        let tagStr = m.name;
        if (m.userForce !== null) tagStr += `=${m.userForce}kN (${m.userType[0]})`;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(mx - 25, my - 10, 50, 20);
        ctx.strokeStyle = color; ctx.strokeRect(mx - 25, my - 10, 50, 20);
        ctx.fillStyle = '#f8fafc'; ctx.font = '11px Outfit'; ctx.textAlign = 'center';
        ctx.fillText(tagStr, mx, my + 4);
    }

    // Draw nodes
    for (let n of ts.nodes) {
        let [sx, sy] = worldToScreen(n.x, n.y);
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = (n === selectedNode) ? '#22d3ee' : '#06b6d4';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Outfit';
        ctx.fillText(n.name, sx, sy + 4);

        // Load arrows
        if (n.loadY !== 0) {
            ctx.strokeStyle = '#eab308'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(sx, sy - 50); ctx.lineTo(sx, sy); ctx.stroke();
            ctx.fillStyle = '#eab308';
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 6, sy - 10); ctx.lineTo(sx + 6, sy - 10); ctx.fill();
            ctx.fillText(`P=${Math.abs(n.loadY)}kN`, sx + 30, sy - 30);
        }
    }
}

function renderFBDContent() {
    if (!selectedNode) return;
    let node = selectedNode;
    let container = document.getElementById('fbd-body-content');
    let fbdInfo = currentLevel.structure;

    container.innerHTML = `
        <div style="background:#0f172a; padding:16px; border-radius:8px; font-family:Outfit;">
            <h3 style="color:#06b6d4;">Joint ${node.name} Vector Components</h3>
            <p>External Load: Px=${node.loadX} kN, Py=${node.loadY} kN</p>
            <p>Reactions: Rx=${fbdInfo.reactions[node.id]?.rx || 0} kN, Ry=${fbdInfo.reactions[node.id]?.ry || 0} kN</p>
            <hr style="margin:10px 0; border-color:#334155;">
            <h4>Equilibrium Equations:</h4>
            <code>Σ Fx = 0 => Σ (F_i * cos θ_i) + Rx + Px = 0</code><br>
            <code>Σ Fy = 0 => Σ (F_i * sin θ_i) + Ry + Py = 0</code>
        </div>
    `;
}
