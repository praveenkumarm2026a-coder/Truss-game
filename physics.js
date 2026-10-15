/**
 * Physics Solver Engine & Level Generator in JavaScript
 * Calculates static equilibrium, support reactions, internal member forces, and FBDs.
 */

class Node {
    constructor(id, name, x, y, support = null, loadX = 0, loadY = 0) {
        this.id = id;
        this.name = name;
        this.x = x;
        this.y = y;
        this.support = support; // 'pin', 'roller', or null
        this.loadX = loadX;
        this.loadY = loadY;
    }
}

class Member {
    constructor(id, nodeA, nodeB) {
        this.id = id;
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.calculatedForce = 0;
        this.forceType = 'Zero'; // 'Tension', 'Compression', 'Zero'
        this.userForce = null;
        this.userType = null;
        this.isCorrect = null;
    }

    get name() {
        return `${this.nodeA.name}${this.nodeB.name}`;
    }

    get length() {
        const dx = this.nodeB.x - this.nodeA.x;
        const dy = this.nodeB.y - this.nodeA.y;
        return Math.hypot(dx, dy);
    }

    angleFrom(node) {
        const other = (node === this.nodeA) ? this.nodeB : this.nodeA;
        return Math.atan2(other.y - node.y, other.x - node.x);
    }
}

class TrussStructure {
    constructor() {
        this.nodes = [];
        this.members = [];
        this.reactions = {};
        this.solved = false;
    }

    addNode(name, x, y, support = null, loadX = 0, loadY = 0) {
        const n = new Node(this.nodes.length, name, x, y, support, loadX, loadY);
        this.nodes.push(n);
        return n;
    }

    addMember(nodeA, nodeB) {
        const m = new Member(this.members.length, nodeA, nodeB);
        this.members.push(m);
        return m;
    }

    solve() {
        const N = this.nodes.length;
        const M = this.members.length;
        if (N === 0 || M === 0) return false;

        let pinNode = this.nodes.find(n => n.support === 'pin');
        let rollerNode = this.nodes.find(n => n.support === 'roller');

        if (!pinNode || !rollerNode) return false;

        // Support Reactions via Moment Balance
        let sumMA = 0;
        for (let n of this.nodes) {
            let dx = n.x - pinNode.x;
            let dy = n.y - pinNode.y;
            sumMA += (dx * n.loadY - dy * n.loadX);
        }

        let dxRoller = rollerNode.x - pinNode.x;
        let rBy = (Math.abs(dxRoller) > 1e-5) ? -sumMA / dxRoller : 0;
        let sumPx = this.nodes.reduce((acc, n) => acc + n.loadX, 0);
        let sumPy = this.nodes.reduce((acc, n) => acc + n.loadY, 0);

        let rAx = -sumPx;
        let rAy = -sumPy - rBy;

        this.reactions[pinNode.id] = { rx: Math.round(rAx * 100) / 100, ry: Math.round(rAy * 100) / 100 };
        this.reactions[rollerNode.id] = { rx: 0, ry: Math.round(rBy * 100) / 100 };

        // Linear System for Method of Joints: 2N eqs, M unknowns
        let A = Array(2 * N).fill(0).map(() => Array(M).fill(0));
        let B = Array(2 * N).fill(0);

        for (let i = 0; i < N; i++) {
            let node = this.nodes[i];
            let rx = this.reactions[node.id]?.rx || 0;
            let ry = this.reactions[node.id]?.ry || 0;

            B[2 * i] = -(node.loadX + rx);
            B[2 * i + 1] = -(node.loadY + ry);

            for (let j = 0; j < M; j++) {
                let member = this.members[j];
                let other = null;
                if (member.nodeA === node) other = member.nodeB;
                else if (member.nodeB === node) other = member.nodeA;
                else continue;

                let dx = other.x - node.x;
                let dy = other.y - node.y;
                let L = Math.hypot(dx, dy);
                if (L > 1e-6) {
                    A[2 * i][j] = dx / L;
                    A[2 * i + 1][j] = dy / L;
                }
            }
        }

        // Solve via simple Gaussian elimination / Least Squares
        try {
            let forces = solveLinearSystem(A, B);
            for (let j = 0; j < M; j++) {
                let fVal = forces[j] || 0;
                let fType = 'Zero';
                if (Math.abs(fVal) < 1e-2) {
                    fVal = 0;
                    fType = 'Zero';
                } else if (fVal > 0) {
                    fType = 'Tension';
                } else {
                    fType = 'Compression';
                }
                this.members[j].calculatedForce = Math.round(fVal * 100) / 100;
                this.members[j].forceType = fType;
            }
            this.solved = true;
            return true;
        } catch (e) {
            console.error("Solver error:", e);
            return false;
        }
    }

    checkAnswers() {
        let failed = [];
        let allCorrect = true;

        for (let m of this.members) {
            if (m.userForce === null || m.userType === null) {
                m.isCorrect = false;
                failed.push(m);
                allCorrect = false;
                continue;
            }

            let typeMatch = (m.calculatedForce === 0) ? (m.userType === 'Zero' || Math.abs(m.userForce) <= 0.5) : (m.userType === m.forceType);
            let calcAbs = Math.abs(m.calculatedForce);
            let userAbs = Math.abs(m.userForce);
            let magMatch = (calcAbs < 1e-2) ? (userAbs <= 0.5) : (Math.abs(calcAbs - userAbs) <= 0.5 || Math.abs(calcAbs - userAbs) / calcAbs <= 0.1);

            m.isCorrect = typeMatch && magMatch;
            if (!m.isCorrect) {
                allCorrect = false;
                failed.push(m);
            }
        }
        return { allCorrect, failed };
    }
}

function solveLinearSystem(A, B) {
    // Basic Pseudoinverse / Least Squares for 2N x M
    let rows = A.length;
    let cols = A[0].length;
    let AtA = Array(cols).fill(0).map(() => Array(cols).fill(0));
    let AtB = Array(cols).fill(0);

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
            for (let k = 0; k < rows; k++) {
                AtA[i][j] += A[k][i] * A[k][j];
            }
        }
        for (let k = 0; k < rows; k++) {
            AtB[i] += A[k][i] * B[k];
        }
    }
    return gaussianSolve(AtA, AtB);
}

function gaussianSolve(A, B) {
    let n = B.length;
    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
        }
        [A[i], A[maxRow]] = [A[maxRow], A[i]];
        [B[i], B[maxRow]] = [B[maxRow], B[i]];

        if (Math.abs(A[i][i]) < 1e-10) continue;

        for (let k = i + 1; k < n; k++) {
            let c = -A[k][i] / A[i][i];
            for (let j = i; j < n; j++) {
                if (i === j) A[k][j] = 0;
                else A[k][j] += c * A[i][j];
            }
            B[k] += c * B[i];
        }
    }

    let x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        if (Math.abs(A[i][i]) < 1e-10) continue;
        x[i] = B[i] / A[i][i];
        for (let k = i - 1; k >= 0; k--) {
            B[k] -= A[k][i] * x[i];
        }
    }
    return x;
}

function createLevelWeb(num) {
    const ts = new TrussStructure();
    let name = `Level ${num}`;
    let desc = "";

    if (num === 1) {
        name = "The Simple Triangle";
        desc = "Solve a basic 3-joint triangular truss carrying 10 kN downward load.";
        let a = ts.addNode('A', 0, 0, 'pin');
        let b = ts.addNode('B', 4, 0, 'roller');
        let c = ts.addNode('C', 2, 3, null, 0, -10);
        ts.addMember(a, b); ts.addMember(b, c); ts.addMember(c, a);
    } else if (num === 2) {
        name = "Corner Braced Frame";
        desc = "4-joint frame with diagonal strut and 12 kN load at C.";
        let a = ts.addNode('A', 0, 0, 'pin');
        let b = ts.addNode('B', 4, 0, 'roller');
        let c = ts.addNode('C', 4, 3, null, 0, -12);
        let d = ts.addNode('D', 0, 3);
        ts.addMember(a, b); ts.addMember(b, c); ts.addMember(c, d); ts.addMember(d, a); ts.addMember(a, c);
    } else if (num === 3) {
        name = "Warren Bridge Cell";
        desc = "5-joint Warren truss with 2 apex loads of 15 kN each.";
        let a = ts.addNode('A', 0, 0, 'pin');
        let b = ts.addNode('B', 4, 0);
        let c = ts.addNode('C', 8, 0, 'roller');
        let d = ts.addNode('D', 2, 3, null, 0, -15);
        let e = ts.addNode('E', 6, 3, null, 0, -15);
        ts.addMember(a, b); ts.addMember(b, c); ts.addMember(d, e);
        ts.addMember(a, d); ts.addMember(d, b); ts.addMember(b, e); ts.addMember(e, c);
    } else {
        name = `${num + 2}-Joint Multi-Bay Bridge`;
        desc = "Escalating multi-joint bridge structure.";
        let numBays = num;
        let bNodes = [], tNodes = [];
        for (let i = 0; i <= numBays; i++) {
            let sup = (i === 0) ? 'pin' : ((i === numBays) ? 'roller' : null);
            bNodes.push(ts.addNode(String.fromCharCode(65 + i), i * 3, 0, sup));
        }
        for (let i = 0; i < numBays; i++) {
            tNodes.push(ts.addNode(String.fromCharCode(65 + numBays + 1 + i), (i + 0.5) * 3, 3, null, 0, -20));
        }
        for (let i = 0; i < numBays; i++) ts.addMember(bNodes[i], bNodes[i+1]);
        for (let i = 0; i < numBays - 1; i++) ts.addMember(tNodes[i], tNodes[i+1]);
        for (let i = 0; i < numBays; i++) {
            ts.addMember(bNodes[i], tNodes[i]);
            ts.addMember(tNodes[i], bNodes[i+1]);
        }
    }

    ts.solve();
    return { name, desc, structure: ts };
}
