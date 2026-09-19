/* OpenEngineLab :: js/renderer.js — procedural SVG engine + stress heatmap */
(function (root) {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const COLOR_SAFE = [61, 220, 151];
  const COLOR_CAUTION_LOW = [255, 210, 61];
  const COLOR_CAUTION_HIGH = [255, 138, 30];
  const COLOR_CRITICAL = [255, 46, 46];

  function el(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgb(c) { return `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`; }
  function lerpRGB(a, b, t) { return [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)]; }

  function sfToVisual(sf) {
    if (sf >= 1.43) return { color: rgb(COLOR_SAFE), pulseHz: 0, level: "safe" };
    if (sf >= 1.0) {
      const t = (1.43 - sf) / 0.43;
      return { color: rgb(lerpRGB(COLOR_CAUTION_LOW, COLOR_CAUTION_HIGH, t)), pulseHz: 0, level: "caution" };
    }
    const overshoot = Math.min(1, 1 - sf);
    return { color: rgb(COLOR_CRITICAL), pulseHz: 0.6 + overshoot * 3.4, level: "critical" };
  }

  /** Slider-crank kinematics: piston travel from TDC at crank angle theta (rad). */
  function pistonTravelMM(theta, crankRadiusMM, rodLengthMM) {
    const top = crankRadiusMM + rodLengthMM;
    const pos = crankRadiusMM * Math.cos(theta) +
      Math.sqrt(Math.max(0, rodLengthMM * rodLengthMM - Math.pow(crankRadiusMM * Math.sin(theta), 2)));
    return top - pos;
  }

  function bankPolygon(minCx, maxCx, margin, crankY, dirX, dirY, fromFrac, toFrac, cylLen) {
    const y0 = fromFrac * cylLen, y1 = toFrac * cylLen;
    const x1 = minCx - margin, x2 = maxCx + margin;
    const p1 = [x1 + dirX * y0, crankY + dirY * y0];
    const p2 = [x2 + dirX * y0, crankY + dirY * y0];
    const p3 = [x2 + dirX * y1, crankY + dirY * y1];
    const p4 = [x1 + dirX * y1, crankY + dirY * y1];
    return [p1, p2, p3, p4].map(p => p.join(",")).join(" ");
  }

  function buildSchematic(container, profile, labels) {
    labels = labels || {};
    container.innerHTML = "";
    const cylCount = profile.cylinders;
    const isSingleBank = profile.configuration === "I";
    const halfAngleRad = isSingleBank ? 0 : ((profile.vAngleDeg || 0) / 2) * Math.PI / 180;
    const perBank = isSingleBank ? cylCount : Math.ceil(cylCount / 2);
    const spacing = 90;
    const cylLen = 140;
    const base = 130;

    const width = Math.max(420, base * 2 + (perBank - 1) * spacing);
    const height = 420;
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "engine-svg", role: "img", "aria-label": labels.schematicAlt || "Engine schematic" });
    container.appendChild(svg);

    const crankY = height - 70;
    const crankAxis = el("line", { x1: 40, y1: crankY, x2: width - 40, y2: crankY, class: "crank-axis" });
    svg.appendChild(crankAxis);

    // First pass: figure out each bank's cylinder-center span, so the block
    // and cylinder head shapes can be sized to actually enclose their bank.
    const bankCount = isSingleBank ? 1 : 2;
    const bankInfo = [];
    for (let b = 0; b < bankCount; b++) {
      const bank = isSingleBank ? 0 : (b === 0 ? -1 : 1);
      const angle = bank * halfAngleRad;
      const dirX = Math.sin(angle), dirY = -Math.cos(angle);
      const cxs = [];
      for (let i = 0; i < cylCount; i++) {
        const cylBank = isSingleBank ? 0 : (i % 2 === 0 ? -1 : 1);
        if (cylBank !== bank) continue;
        const posIdx = isSingleBank ? i : Math.floor(i / 2);
        cxs.push(base + posIdx * spacing);
      }
      bankInfo.push({ dirX, dirY, minCx: Math.min(...cxs), maxCx: Math.max(...cxs) });
    }

    const groups = { rod: [], headBolt: [], pistonPin: [], cylinderHead: [], block: [] };

    // Block and cylinder head shapes, drawn first so pistons/rods layer on top.
    for (const b of bankInfo) {
      const blockPoly = el("polygon", {
        points: bankPolygon(b.minCx, b.maxCx, 40, crankY, b.dirX, b.dirY, 0.04, 0.5, cylLen),
        class: "engine-block"
      });
      const blockTip = el("title", {}); blockTip.textContent = labels.block || "Engine Block";
      blockPoly.appendChild(blockTip);
      svg.appendChild(blockPoly);
      groups.block.push(blockPoly);

      const headPoly = el("polygon", {
        points: bankPolygon(b.minCx, b.maxCx, 34, crankY, b.dirX, b.dirY, 0.58, 0.88, cylLen),
        class: "cylinder-head"
      });
      const headTip = el("title", {}); headTip.textContent = labels.cylinderHead || "Cylinder Head";
      headPoly.appendChild(headTip);
      svg.appendChild(headPoly);
      groups.cylinderHead.push(headPoly);
    }

    const cylinders = [];

    for (let i = 0; i < cylCount; i++) {
      const bank = isSingleBank ? 0 : (i % 2 === 0 ? -1 : 1);
      const posIdx = isSingleBank ? i : Math.floor(i / 2);
      const cx = base + posIdx * spacing;
      const angle = bank * halfAngleRad;
      const dirX = Math.sin(angle), dirY = -Math.cos(angle);

      const headX = cx + dirX * cylLen;
      const headY = crankY + dirY * cylLen;

      const cylOutline = el("line", {
        x1: cx, y1: crankY, x2: headX, y2: headY, class: "cylinder-outline"
      });
      svg.appendChild(cylOutline);

      const journal = el("circle", { cx, cy: crankY, r: 9, class: "journal" });
      svg.appendChild(journal);

      const piston = el("rect", { x: -14, y: -10, width: 28, height: 20, rx: 3, class: "piston" });
      const pistonGroup = el("g", { transform: `translate(${headX},${headY})` });
      pistonGroup.appendChild(piston);
      svg.appendChild(pistonGroup);

      const rod = el("line", { x1: cx, y1: crankY, x2: headX, y2: headY, class: "conrod" });
      svg.appendChild(rod);

      const pin = el("circle", { r: 5, class: "piston-pin" });
      pistonGroup.appendChild(pin);

      const boltA = el("circle", { cx: headX - 16, cy: headY - dirY * 4, r: 4, class: "head-bolt" });
      const boltB = el("circle", { cx: headX + 16, cy: headY - dirY * 4, r: 4, class: "head-bolt" });
      svg.appendChild(boltA); svg.appendChild(boltB);

      const tip = el("title", {});
      tip.textContent = `${labels.cylinder || "Cylinder"} ${i + 1}`;
      pistonGroup.appendChild(tip);

      cylinders.push({
        index: i, cx, crankY, dirX, dirY, cylLen,
        phaseRad: (i * (360 / cylCount)) * Math.PI / 180,
        pistonGroup, rod
      });
      groups.rod.push(rod);
      groups.pistonPin.push(pin);
      groups.headBolt.push(boltA, boltB);
    }

    return { svg, cylinders, groups, crankRadiusMM: profile.geometry.strokeMM / 2, rodLengthMM: profile.geometry.rodLengthMM };
  }

  function updateCrankAngle(handle, thetaRad) {
    const pxPerMM = handle.cylinders[0] ? (handle.cylinders[0].cylLen / (handle.rodLengthMM + handle.crankRadiusMM)) : 1;
    for (const c of handle.cylinders) {
      const localTheta = thetaRad + c.phaseRad;
      const travelMM = pistonTravelMM(localTheta, handle.crankRadiusMM, handle.rodLengthMM);
      const travelPx = travelMM * pxPerMM;
      const headX = c.cx + c.dirX * c.cylLen;
      const headY = c.crankY + c.dirY * c.cylLen;
      const px = headX - c.dirX * travelPx;
      const py = headY - c.dirY * travelPx;
      c.pistonGroup.setAttribute("transform", `translate(${px},${py})`);
      c.rod.setAttribute("x2", px);
      c.rod.setAttribute("y2", py);
    }
  }

  function applyStressState(handle, components, labels) {
    labels = labels || {};
    const info = {};
    for (const comp of components) {
      const visual = sfToVisual(comp.sf);
      info[comp.id] = visual;
      const elements = handle.groups[comp.id] || [];
      const label = labels[comp.id] || comp.id;
      for (const node of elements) {
        node.style.fill = visual.color;
        node.style.stroke = visual.color;
        if (visual.pulseHz > 0) {
          node.classList.add("pulse-critical");
          node.style.setProperty("--pulse-dur", (1 / visual.pulseHz).toFixed(2) + "s");
        } else {
          node.classList.remove("pulse-critical");
          node.style.removeProperty("--pulse-dur");
        }
        node.setAttribute("data-tooltip",
          `${label}: σ=${comp.stress.toFixed(1)} MPa | SF=${comp.sf.toFixed(2)} | D=${(comp.damage * 100).toFixed(4)}%`);
      }
    }
    return info;
  }

  /** Draws the ignition or fuel map onto a canvas, including the live operating point. */
  function drawKennfield(canvas, map, rpmAxis, loadAxis, opPoint, unitLabel) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    let min = Infinity, max = -Infinity;
    for (const row of map) for (const v of row) { if (v < min) min = v; if (v > max) max = v; }
    const cellW = w / rpmAxis.length, cellH = h / loadAxis.length;
    for (let ly = 0; ly < loadAxis.length; ly++) {
      for (let lx = 0; lx < rpmAxis.length; lx++) {
        const v = map[ly][lx];
        const t = (v - min) / Math.max(1e-6, max - min);
        ctx.fillStyle = rgb(lerpRGB([61, 120, 220], [255, 138, 30], t));
        const y = h - (ly + 1) * cellH;
        ctx.fillRect(lx * cellW, y, cellW - 1, cellH - 1);
        ctx.fillStyle = "rgba(228,233,237,0.75)";
        ctx.font = "9px monospace";
        ctx.fillText(v.toFixed(1), lx * cellW + 3, y + 11);
      }
    }
    if (opPoint) {
      const rx = interpAxisPos(rpmAxis, opPoint.rpm) * cellW;
      const ry = h - interpAxisPos(loadAxis, opPoint.load) * cellH;
      ctx.beginPath();
      ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#FF2E2E";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function interpAxisPos(axis, v) {
    if (v <= axis[0]) return 0.5;
    if (v >= axis[axis.length - 1]) return axis.length - 0.5;
    for (let i = 0; i < axis.length - 1; i++) {
      if (v >= axis[i] && v <= axis[i + 1]) {
        const t = (v - axis[i]) / (axis[i + 1] - axis[i]);
        return i + 0.5 + t;
      }
    }
    return 0.5;
  }

  root.OEL = root.OEL || {};
  root.OEL.Renderer = { buildSchematic, updateCrankAngle, applyStressState, sfToVisual, drawKennfield };
})(typeof window !== "undefined" ? window : global);
