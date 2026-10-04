/**
 * OpenEngineLab — Engine Schematic Renderer
 * Visualization of the crank train in side, front, and top views.
 */

// Kinematic helper function: Calculates normalized piston position (0.0 = TDC, 1.0 = BDC)
function getNormalizedPistonPosition(crankAngleRad, strokeMM, rodLengthMM) {
  const R = (strokeMM || 80) / 2;
  const L = rodLengthMM || 140;

  // Exact slider-crank equation for distance: crank center -> gudgeon pin
  const sinAngle = Math.sin(crankAngleRad);
  const cosAngle = Math.cos(crankAngleRad);
  const dist = R * cosAngle + Math.sqrt(Math.max(0, L * L - R * R * sinAngle * sinAngle));

  const maxDist = L + R; // TDC (Top Dead Center)
  const minDist = L - R; // BDC (Bottom Dead Center)

  return 1.0 - (dist - minDist) / (maxDist - minDist);
}

// Color scaling for thermal/mechanical load
function getStressColor(stressFactor) {
  // stressFactor: 0.0 (normal) to 1.0+ (overloaded)
  const val = Math.min(Math.max(stressFactor || 0, 0), 1);
  if (val < 0.5) {
    return "#3DDC97"; // Safe (Green)
  } else if (val < 0.85) {
    return "#FFB627"; // Warning (Yellow/Orange)
  }
  return "#FF2E2E"; // Critical (Red)
}

export class EngineRenderer {
  constructor(containerId) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.currentView = 'side';
    this.svg = null;
  }

  // Initializes the SVG structure within the container
  initSVG(engineData) {
    if (!this.container) return;
    this.container.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'engine-svg');
    svg.setAttribute('viewBox', '0 0 800 500');
    this.container.appendChild(svg);
    this.svg = svg;

    this.buildViewStructure(engineData);
  }

  // Builds the base SVG elements for all three view perspectives
  buildViewStructure(engineData) {
    if (!this.svg) return;
    this.svg.innerHTML = '';

    const cylinders = engineData?.cylinders || 4;

    // --- SIDE VIEW GROUP ---
    const gSide = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gSide.setAttribute('id', 'view-side-group');
    gSide.style.display = this.currentView === 'side' ? 'block' : 'none';

    // Crankshaft axis
    const crankAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    crankAxis.setAttribute('x1', '50'); crankAxis.setAttribute('y1', '350');
    crankAxis.setAttribute('x2', '750'); crankAxis.setAttribute('y2', '350');
    crankAxis.setAttribute('class', 'crank-axis');
    gSide.appendChild(crankAxis);

    const spacing = 680 / (cylinders + 1);

    for (let i = 0; i < cylinders; i++) {
      const cx = 60 + spacing * (i + 1);

      // Cylinder wall
      const cyl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      cyl.setAttribute('d', `M ${cx - 30} 120 L ${cx - 30} 300 M ${cx + 30} 120 L ${cx + 30} 300`);
      cyl.setAttribute('class', 'cylinder-outline');
      gSide.appendChild(cyl);

      // Connecting rod
      const rod = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      rod.setAttribute('id', `side-rod-${i}`);
      rod.setAttribute('class', 'conrod');
      gSide.appendChild(rod);

      // Piston
      const piston = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      piston.setAttribute('id', `side-piston-${i}`);
      piston.setAttribute('width', '56');
      piston.setAttribute('height', '40');
      piston.setAttribute('rx', '3');
      piston.setAttribute('class', 'piston');
      gSide.appendChild(piston);

      // Crankpin / journal
      const journal = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      journal.setAttribute('id', `side-journal-${i}`);
      journal.setAttribute('r', '8');
      journal.setAttribute('class', 'journal');
      gSide.appendChild(journal);
    }
    this.svg.appendChild(gSide);

    // --- FRONT VIEW GROUP ---
    const gFront = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gFront.setAttribute('id', 'view-front-group');
    gFront.style.display = this.currentView === 'front' ? 'block' : 'none';

    const vAngleDeg = engineData?.vAngleDeg || (engineData?.configuration === 'V' ? 60 : 0);
    const halfV = (vAngleDeg / 2) * (Math.PI / 180);

    // Draw cylinder banks
    [-1, 1].forEach(bankSign => {
      if (engineData?.configuration !== 'V' && bankSign === 1) return;
      const angle = bankSign * halfV;
      const x2 = 400 + Math.sin(angle) * 220;
      const y2 = 350 - Math.cos(angle) * 220;

      const bankLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      bankLine.setAttribute('x1', '400'); bankLine.setAttribute('y1', '350');
      bankLine.setAttribute('x2', x2); bankLine.setAttribute('y2', y2);
      bankLine.setAttribute('class', 'front-bank-line');
      gFront.appendChild(bankLine);
    });

    for (let i = 0; i < cylinders; i++) {
      const bankSign = (engineData?.configuration === 'V' && i % 2 !== 0) ? 1 : -1;
      const angle = (engineData?.configuration === 'V') ? (bankSign * halfV) : 0;
      const baseX = 400 + Math.sin(angle) * 140;
      const baseY = 350 - Math.cos(angle) * 140;

      const gCyl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gCyl.setAttribute('id', `front-cyl-group-${i}`);
      gCyl.setAttribute('transform', `translate(${baseX}, ${baseY}) rotate(${(angle * 180) / Math.PI})`);

      const bore = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bore.setAttribute('x', '-35'); bore.setAttribute('y', '-60');
      bore.setAttribute('width', '70'); bore.setAttribute('height', '120');
      bore.setAttribute('class', 'front-bore');
      bore.setAttribute('id', `front-bore-${i}`);
      gCyl.appendChild(bore);

      const piston = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      piston.setAttribute('id', `front-piston-${i}`);
      piston.setAttribute('x', '-32'); piston.setAttribute('y', '-55');
      piston.setAttribute('width', '64'); piston.setAttribute('height', '35');
      piston.setAttribute('rx', '2');
      piston.setAttribute('class', 'piston');
      gCyl.appendChild(piston);

      gFront.appendChild(gCyl);
    }
    this.svg.appendChild(gFront);

    // --- TOP VIEW GROUP ---
    const gTop = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gTop.setAttribute('id', 'view-top-group');
    gTop.style.display = this.currentView === 'top' ? 'block' : 'none';

    for (let i = 0; i < cylinders; i++) {
      const cx = 60 + spacing * (i + 1);

      const topBore = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      topBore.setAttribute('cx', cx); topBore.setAttribute('cy', '250');
      topBore.setAttribute('r', '38');
      topBore.setAttribute('class', 'top-bore');
      topBore.setAttribute('id', `top-bore-${i}`);
      gTop.appendChild(topBore);

      const topPiston = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      topPiston.setAttribute('id', `top-piston-${i}`);
      topPiston.setAttribute('cx', cx); topPiston.setAttribute('cy', '250');
      topPiston.setAttribute('r', '32');
      topPiston.setAttribute('class', 'piston');
      gTop.appendChild(topPiston);

      const crankPin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      crankPin.setAttribute('id', `top-crankpin-${i}`);
      crankPin.setAttribute('cx', cx); crankPin.setAttribute('cy', '250');
      crankPin.setAttribute('r', '7');
      crankPin.setAttribute('class', 'journal');
      gTop.appendChild(crankPin);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx); label.setAttribute('y', '310');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'top-cyl-label');
      label.textContent = `Cyl ${i + 1}`;
      gTop.appendChild(label);
    }
    this.svg.appendChild(gTop);
  }

  // Toggles the visible perspective
  setView(viewName) {
    this.currentView = viewName;
    ['side', 'front', 'top'].forEach(v => {
      const el = document.getElementById(`view-${v}-group`);
      if (el) el.style.display = (v === viewName) ? 'block' : 'none';
    });
  }

  // Updates animations synchronously with telemetry data
  update(telemetry, engineData) {
    if (!this.svg) this.initSVG(engineData);

    const crankAngleDeg = telemetry?.crankAngleDeg || 0;
    const cylinders = engineData?.cylinders || 4;
    const strokeMM = engineData?.geometry?.strokeMM || 80;
    const rodLengthMM = engineData?.geometry?.rodLengthMM || 140;
    const firingOrder = engineData?.firingOrder || Array.from({ length: cylinders }, (_, i) => i + 1);

    const stressColor = getStressColor(telemetry?.stressFactor || 0);

    for (let i = 0; i < cylinders; i++) {
      // Phase offset per cylinder according to firing order
      const phaseOffsetDeg = (360 / cylinders) * (firingOrder[i] - 1);
      const cylAngleRad = ((crankAngleDeg + phaseOffsetDeg) * Math.PI) / 180;
      const yNorm = getNormalizedPistonPosition(cylAngleRad, strokeMM, rodLengthMM);

      if (this.currentView === 'side') {
        const spacing = 680 / (cylinders + 1);
        const cx = 60 + spacing * (i + 1);

        const crankRadiusPx = 35;
        const pinX = cx + Math.sin(cylAngleRad) * crankRadiusPx;
        const pinY = 350 - Math.cos(cylAngleRad) * crankRadiusPx;

        const pistonY = 130 + yNorm * 90;

        const journal = document.getElementById(`side-journal-${i}`);
        if (journal) { journal.setAttribute('cx', pinX); journal.setAttribute('cy', pinY); }

        const piston = document.getElementById(`side-piston-${i}`);
        if (piston) { piston.setAttribute('x', cx - 28); piston.setAttribute('y', pistonY); }

        const rod = document.getElementById(`side-rod-${i}`);
        if (rod) {
          rod.setAttribute('x1', pinX); rod.setAttribute('y1', pinY);
          rod.setAttribute('x2', cx); rod.setAttribute('y2', pistonY + 20);
          rod.style.stroke = stressColor;
        }

      } else if (this.currentView === 'front') {
        const strokePx = 65; // Stroke distance in SVG pixels
        const pistonEl = document.getElementById(`front-piston-${i}`);
        const boreEl = document.getElementById(`front-bore-${i}`);

        if (pistonEl) {
          // Displacement along the cylinder axis
          const dy = -40 + yNorm * strokePx;
          pistonEl.setAttribute('y', dy.toFixed(2));
        }

        if (boreEl) {
          boreEl.style.stroke = stressColor;
        }

      } else if (this.currentView === 'top') {
        const spacing = 680 / (cylinders + 1);
        const cx = 60 + spacing * (i + 1);
        const crankRadiusPx = 22;

        const pinX = cx + Math.sin(cylAngleRad) * crankRadiusPx;
        const pinY = 250 - Math.cos(cylAngleRad) * (crankRadiusPx * 0.45); // Perspective compression

        const crankPinEl = document.getElementById(`top-crankpin-${i}`);
        if (crankPinEl) {
          crankPinEl.setAttribute('cx', pinX.toFixed(2));
          crankPinEl.setAttribute('cy', pinY.toFixed(2));
        }

        const topPistonEl = document.getElementById(`top-piston-${i}`);
        const topBoreEl = document.getElementById(`top-bore-${i}`);

        if (topPistonEl) {
          // Depth effect (piston appears larger near TDC)
          const dynamicRadius = 28 + (1.0 - yNorm) * 6;
          topPistonEl.setAttribute('r', dynamicRadius.toFixed(2));
        }

        if (topBoreEl) {
          topBoreEl.style.stroke = stressColor;
        }
      }
    }
  }
}
