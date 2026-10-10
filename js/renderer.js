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
    for (const k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rgb(c) {
    return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  }

  function lerpRGB(a, b, t) {
    return [
      lerp(a[0], b[0], t),
      lerp(a[1], b[1], t),
      lerp(a[2], b[2], t)
    ];
  }

  function sfToVisual(sf) {
    if (sf >= 1.43) {
      return { color: rgb(COLOR_SAFE), pulseHz: 0, level: "safe" };
    }
    if (sf >= 1.0) {
      const t = (1.43 - sf) / 0.43;
      return { color: rgb(lerpRGB(COLOR_CAUTION_LOW, COLOR_CAUTION_HIGH, t)), pulseHz: 0, level: "caution" };
    }
    const overshoot = Math.min(1, 1 - sf);
    return { color: rgb(COLOR_CRITICAL), pulseHz: 0.6 + overshoot * 3.4, level: "critical" };
  }

  function _styleNode(node, visual) {
    if (!node) return;

    if (node.classList.contains("top-bore") || 
        node.classList.contains("front-bore") || 
        node.classList.contains("cylinder-outline")) {
      node.style.stroke = visual.color;
      node.style.fill = "transparent";
    } else {
      node.style.fill = visual.color;
      node.style.stroke = visual.color;
    }

    if (visual.pulseHz > 0) {
      node.classList.add("pulse-critical");
      node.style.setProperty("--pulse-dur", (1 / visual.pulseHz).toFixed(2) + "s");
    } else {
      node.classList.remove("pulse-critical");
      node.style.removeProperty("--pulse-dur");
    }
  }

  const TOP_CRANK_PX = 16;
  const TOP_LEGEND_H = 72;
  const WEAK_LIST_LEN = 3;
  const CYCLE_DEG = 720;
  const COMBUSTION_PEAK_DEG = 15;
  const COMBUSTION_SIGMA_DEG = 30;
  const COMBUSTION_MAX_OPACITY = 0.85;
  const PEAK_PRESSURE_DECAY = 0.995;
  const COLOR_COMBUSTION = [255, 183, 3];
  let uidCounter = 0;

  function nextUid(prefix) {
    uidCounter += 1;
    return `${prefix}-${uidCounter}`;
  }

  // Crank-pin phase per cylinder. Banks of a V engine share crank pins,
  // so both cylinders of one pin position receive the same phase.
  function cylinderPinPhaseRad(index, cylCount, isSingleBank) {
    const perBank = isSingleBank ? cylCount : Math.ceil(cylCount / 2);
    const pinIndex = isSingleBank ? index : Math.floor(index / 2);
    return (pinIndex * 2 * Math.PI) / Math.max(1, perBank);
  }

  // Firing position of a cylinder within the 720 deg four-stroke cycle.
  // Uses the 1-based firingOrder from the engine profile when available.
  function firingAngleDeg(index, profile) {
    const cylCount = profile.cylinders;
    let pos = index;
    const order = profile.firingOrder;
    if (Array.isArray(order) && order.length === cylCount) {
      const found = order.indexOf(index + 1);
      if (found >= 0) pos = found;
    }
    return pos * (CYCLE_DEG / cylCount);
  }

  function pistonTravelMM(theta, crankRadiusMM, rodLengthMM) {
    const top = crankRadiusMM + rodLengthMM;
    const pos = crankRadiusMM * Math.cos(theta) +
      Math.sqrt(Math.max(0, rodLengthMM * rodLengthMM - Math.pow(crankRadiusMM * Math.sin(theta), 2)));
    return top - pos;
  }

  function bankPolygon(minCx, maxCx, margin, crankY, dirX, dirY, fromFrac, toFrac, cylLen) {
    const y0 = fromFrac * cylLen;
    const y1 = toFrac * cylLen;
    const x1 = minCx - margin;
    const x2 = maxCx + margin;
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
    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "engine-svg",
      role: "img",
      "aria-label": labels.schematicAlt || "Engine schematic"
    });
    container.appendChild(svg);

    const crankY = height - 70;
    const crankAxis = el("line", { x1: 40, y1: crankY, x2: width - 40, y2: crankY, class: "crank-axis" });
    svg.appendChild(crankAxis);

    const bankCount = isSingleBank ? 1 : 2;
    const bankInfo = [];
    for (let b = 0; b < bankCount; b++) {
      const bank = isSingleBank ? 0 : (b === 0 ? -1 : 1);
      const angle = bank * halfAngleRad;
      const dirX = Math.sin(angle);
      const dirY = -Math.cos(angle);
      const cxs = [];
      for (let i = 0; i < cylCount; i++) {
        const cylBank = isSingleBank ? 0 : (i % 2 === 0 ? -1 : 1);
        if (cylBank !== bank) continue;
        const posIdx = isSingleBank ? i : Math.floor(i / 2);
        cxs.push(base + posIdx * spacing);
      }
      if (cxs.length > 0) {
        bankInfo.push({ dirX, dirY, minCx: Math.min(...cxs), maxCx: Math.max(...cxs) });
      }
    }

    const groups = { block: [], cylinderHead: [], piston: [], rod: [], pistonPin: [], headBolt: [], overall: [] };

    for (const b of bankInfo) {
      const blockPoly = el("polygon", {
        points: bankPolygon(b.minCx, b.maxCx, 40, crankY, b.dirX, b.dirY, 0.04, 0.5, cylLen),
        class: "engine-block"
      });
      const blockTip = el("title", {});
      blockTip.textContent = labels.block || "Engine Block";
      blockPoly.appendChild(blockTip);
      svg.appendChild(blockPoly);
      groups.block.push(blockPoly);

      const headPoly = el("polygon", {
        points: bankPolygon(b.minCx, b.maxCx, 34, crankY, b.dirX, b.dirY, 0.58, 0.88, cylLen),
        class: "cylinder-head"
      });
      const headTip = el("title", {});
      headTip.textContent = labels.cylinderHead || "Cylinder Head";
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
      const dirX = Math.sin(angle);
      const dirY = -Math.cos(angle);

      const headX = cx + dirX * cylLen;
      const headY = crankY + dirY * cylLen;

      const cylOutline = el("line", {
        x1: cx, y1: crankY, x2: headX, y2: headY, class: "cylinder-outline"
      });
      svg.appendChild(cylOutline);
      groups.overall.push(cylOutline);

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

      const perpX = -dirY;
      const perpY = dirX;
      const boltA = el("circle", { cx: headX - perpX * 16 + dirX * 4, cy: headY - perpY * 16 + dirY * 4, r: 4, class: "head-bolt" });
      const boltB = el("circle", { cx: headX + perpX * 16 + dirX * 4, cy: headY + perpY * 16 + dirY * 4, r: 4, class: "head-bolt" });
      svg.appendChild(boltA);
      svg.appendChild(boltB);

      const tip = el("title", {});
      tip.textContent = `${labels.cylinder || "Cylinder"} ${i + 1}`;
      pistonGroup.appendChild(tip);

      cylinders.push({
        index: i,
        cx,
        crankY,
        dirX,
        dirY,
        cylLen,
        phaseRad: cylinderPinPhaseRad(i, cylCount, isSingleBank),
        pistonGroup,
        rod
      });
      groups.rod.push(rod);
      groups.pistonPin.push(pin);
      groups.headBolt.push(boltA, boltB);
      groups.overall.push(piston);
    }

    return {
      svg,
      cylinders,
      groups,
      mode: "side",
      crankRadiusMM: (profile.geometry && profile.geometry.strokeMM) ? profile.geometry.strokeMM / 2 : 40,
      rodLengthMM: (profile.geometry && profile.geometry.rodLengthMM) ? profile.geometry.rodLengthMM : 140
    };
  }

  function buildSchematicFront(container, profile, labels) {
    labels = labels || {};
    container.innerHTML = "";
    const cylCount = profile.cylinders;
    const isSingleBank = profile.configuration === "I";
    const halfAngleRad = isSingleBank ? 0 : ((profile.vAngleDeg || 0) / 2) * Math.PI / 180;
    const width = 380;
    const height = 380;
    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "engine-svg",
      role: "img",
      "aria-label": labels.frontViewAlt || "Engine front view"
    });
    container.appendChild(svg);

    const crankX = width / 2;
    const crankY = height - 70;
    const boreLenPx = 150;
    const boreR = 36;
    const pistonR = 14;
    const groups = { block: [], cylinderHead: [], piston: [], rod: [], pistonPin: [], headBolt: [], overall: [] };
    const cylinders = [];

    const crankcase = el("circle", { cx: crankX, cy: crankY, r: 35, class: "engine-block" });
    svg.appendChild(crankcase);
    groups.block.push(crankcase);

    const banks = isSingleBank ? [0] : [-1, 1];
    for (const bank of banks) {
      const angle = bank * halfAngleRad;
      const dirX = Math.sin(angle);
      const dirY = -Math.cos(angle);
      const baseX = crankX + dirX * boreLenPx;
      const baseY = crankY + dirY * boreLenPx;

      const blockLine = el("line", {
        x1: crankX + dirX * 35,
        y1: crankY + dirY * 35,
        x2: crankX + dirX * (boreLenPx - boreR),
        y2: crankY + dirY * (boreLenPx - boreR),
        class: "engine-block",
        "stroke-width": 12,
        stroke: "#333"
      });
      svg.appendChild(blockLine);
      groups.block.push(blockLine);

      const headCircle = el("circle", { cx: baseX + dirX * 10, cy: baseY + dirY * 10, r: boreR + 6, class: "cylinder-head" });
      svg.appendChild(headCircle);
      groups.cylinderHead.push(headCircle);

      const crankRod = el("line", { x1: crankX, y1: crankY, x2: baseX, y2: baseY, class: "front-bank-line", stroke: "#444", "stroke-dasharray": "3 3" });
      svg.appendChild(crankRod);

      const bore = el("circle", { cx: baseX, cy: baseY, r: boreR, class: "front-bore" });
      const tip = el("title", {});
      tip.textContent = isSingleBank ? (labels.cylinder || "Cylinder") : `${labels.bank || "Bank"} ${bank < 0 ? "A" : "B"}`;
      bore.appendChild(tip);
      svg.appendChild(bore);
      groups.overall.push(bore);

      const innerBore = el("circle", { cx: baseX, cy: baseY, r: boreR - 10, class: "front-bore-inner" });
      svg.appendChild(innerBore);

      const perpX = -dirY;
      const perpY = dirX;
      for (const side of [-1, 1]) {
        const bolt = el("circle", { cx: baseX + side * perpX * (boreR + 2), cy: baseY + side * perpY * (boreR + 2), r: 4, class: "head-bolt" });
        svg.appendChild(bolt);
        groups.headBolt.push(bolt);
      }

      for (let i = 0; i < cylCount; i++) {
        const cylBank = isSingleBank ? 0 : (i % 2 === 0 ? -1 : 1);
        if (cylBank !== bank) continue;

        const phaseRad = cylinderPinPhaseRad(i, cylCount, isSingleBank);

        const crankArm = el("line", { x1: crankX, y1: crankY, x2: crankX, y2: crankY, class: "front-crank-arm", stroke: "#aaa", "stroke-width": 4 });
        svg.appendChild(crankArm);

        const rod = el("line", { x1: crankX, y1: crankY, x2: baseX, y2: baseY, class: "conrod-front", stroke: "#888", "stroke-width": 5 });
        svg.appendChild(rod);
        groups.rod.push(rod);

        const crankPin = el("circle", { cx: crankX, cy: crankY, r: 5, class: "crank-pin", fill: "#ffb703" });
        svg.appendChild(crankPin);

        const pistonGroup = el("g", { transform: `translate(${baseX},${baseY})` });
        svg.appendChild(pistonGroup);

        const piston = el("circle", { cx: 0, cy: 0, r: pistonR, class: "piston" });
        pistonGroup.appendChild(piston);
        groups.piston.push(piston);
        groups.overall.push(piston);

        const pin = el("circle", { cx: 0, cy: 0, r: 4, class: "piston-pin" });
        pistonGroup.appendChild(pin);
        groups.pistonPin.push(pin);

        cylinders.push({
          index: i,
          bank,
          bankAngleRad: angle,
          baseX,
          baseY,
          dirX,
          dirY,
          phaseRad,
          pistonGroup,
          piston,
          pin,
          rod,
          crankArm,
          crankPin,
          crankX,
          crankY,
          boreLenPx
        });
      }
    }

    const crank = el("circle", { cx: crankX, cy: crankY, r: 16, class: "journal", fill: "#555" });
    svg.appendChild(crank);

    return {
      svg,
      cylinders,
      groups,
      mode: "front",
      crankRadiusMM: (profile.geometry && profile.geometry.strokeMM) ? profile.geometry.strokeMM / 2 : 40,
      rodLengthMM: (profile.geometry && profile.geometry.rodLengthMM) ? profile.geometry.rodLengthMM : 140
    };
  }

  function buildSchematicTop(container, profile, labels) {
    labels = labels || {};
    container.innerHTML = "";
    const cylCount = profile.cylinders;
    const isSingleBank = profile.configuration === "I";
    const perBank = isSingleBank ? cylCount : Math.ceil(cylCount / 2);

    const spacing = 90;
    const boreR = 30;
    const pistonR = 14;
    const base = 80;
    const bankGap = isSingleBank ? 0 : 120;
    const outlinePad = 16;
    const headPad = 14;

    const plotH = isSingleBank ? 220 : 320;
    const width = Math.max(400, base * 2 + (perBank - 1) * spacing);
    const height = plotH + TOP_LEGEND_H;
    const centerY = plotH / 2;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "engine-svg",
      role: "img",
      "aria-label": labels.topViewAlt || "Engine top view"
    });
    container.appendChild(svg);

    // Glow filter used to highlight the weakest component
    const glowFilterId = nextUid("oel-weak-glow");
    const defs = el("defs", {});
    const filter = el("filter", { id: glowFilterId, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    filter.appendChild(el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "4", result: "blur" }));
    const merge = el("feMerge", {});
    merge.appendChild(el("feMergeNode", { in: "blur" }));
    merge.appendChild(el("feMergeNode", { in: "SourceGraphic" }));
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    const groups = { block: [], cylinderHead: [], piston: [], rod: [], pistonPin: [], headBolt: [], overall: [] };
    const cylinders = [];

    const crankXStart = base - 40;
    const crankXEnd = base + (perBank - 1) * spacing + 40;
    const blockX = crankXStart - 10;
    const blockY = isSingleBank ? centerY - 80 : centerY - bankGap / 2 - 50;
    const blockW = (crankXEnd - crankXStart) + 20;
    const blockH = isSingleBank ? 160 : bankGap + 100;

    // Engine outline: outer silhouette of the block, drawn behind all components
    svg.appendChild(el("rect", {
      x: blockX - outlinePad,
      y: blockY - outlinePad,
      width: blockW + outlinePad * 2,
      height: blockH + outlinePad * 2,
      rx: 18,
      class: "engine-outline"
    }));

    const blockRect = el("rect", {
      x: blockX, y: blockY, width: blockW, height: blockH, rx: 10, class: "engine-block"
    });
    const blockTip = el("title", {});
    blockTip.textContent = labels.block || "Engine Block";
    blockRect.appendChild(blockTip);
    svg.appendChild(blockRect);
    groups.block.push(blockRect);

    // Per-bank head contour and cylinder centerline
    const bankCenters = isSingleBank ? [centerY - 40] : [centerY - bankGap / 2, centerY + bankGap / 2];
    for (const cy of bankCenters) {
      svg.appendChild(el("rect", {
        x: base - boreR - headPad,
        y: cy - boreR - headPad,
        width: (perBank - 1) * spacing + (boreR + headPad) * 2,
        height: (boreR + headPad) * 2,
        rx: 16,
        class: "head-outline"
      }));
      svg.appendChild(el("line", { x1: crankXStart, y1: cy, x2: crankXEnd, y2: cy, class: "centerline" }));
    }

    const crankLine = el("line", {
      x1: crankXStart, y1: centerY, x2: crankXEnd, y2: centerY, class: "crank-axis", stroke: "#555", "stroke-width": 4
    });
    svg.appendChild(crankLine);
    svg.appendChild(el("circle", { cx: crankXStart, cy: centerY, r: 12, class: "journal" }));

    for (let i = 0; i < cylCount; i++) {
      const bank = isSingleBank ? 0 : (i % 2 === 0 ? -1 : 1);
      const posIdx = isSingleBank ? i : Math.floor(i / 2);

      const baseCx = base + posIdx * spacing;
      const baseCy = isSingleBank ? centerY - 40 : centerY + bank * (bankGap / 2);
      const phaseRad = cylinderPinPhaseRad(i, cylCount, isSingleBank);

      const headRect = el("rect", {
        x: baseCx - boreR - 5,
        y: baseCy - boreR - 5,
        width: (boreR * 2) + 10,
        height: (boreR * 2) + 10,
        rx: 6,
        class: "cylinder-head"
      });
      svg.appendChild(headRect);
      groups.cylinderHead.push(headRect);

      const bore = el("circle", { cx: baseCx, cy: baseCy, r: boreR, class: "top-bore" });
      const tip = el("title", {});
      tip.textContent = `${labels.cylinder || "Cylinder"} ${i + 1}`;
      bore.appendChild(tip);
      svg.appendChild(bore);
      groups.overall.push(bore);

      for (const dx of [-boreR, boreR]) {
        for (const dy of [-boreR, boreR]) {
          const bolt = el("circle", { cx: baseCx + dx, cy: baseCy + dy, r: 3, class: "head-bolt" });
          svg.appendChild(bolt);
          groups.headBolt.push(bolt);
        }
      }

      const plugDir = bank === -1 ? -1 : 1;
      const plugY = isSingleBank ? baseCy - boreR - 5 : baseCy + plugDir * (boreR + 5);
      svg.appendChild(el("circle", { cx: baseCx, cy: plugY, r: 5, class: "top-plug", fill: "#ccc" }));

      svg.appendChild(el("circle", { cx: baseCx, cy: centerY, r: 6, class: "journal" }));

      const crankPin = el("circle", { cx: baseCx, cy: centerY, r: 4, class: "top-crank-pin", fill: "#ffb703" });
      svg.appendChild(crankPin);

      const rod = el("line", {
        x1: baseCx, y1: centerY, x2: baseCx, y2: baseCy, class: "conrod-top", stroke: "#888", "stroke-width": 5
      });
      svg.appendChild(rod);
      groups.rod.push(rod);

      const pistonGroup = el("g", { transform: `translate(${baseCx},${baseCy})` });
      const piston = el("circle", { cx: 0, cy: 0, r: pistonR, class: "piston" });
      pistonGroup.appendChild(piston);
      const pin = el("circle", { cx: 0, cy: 0, r: 3, class: "piston-pin", fill: "#333" });
      pistonGroup.appendChild(pin);
      svg.appendChild(pistonGroup);
      groups.piston.push(piston);
      groups.pistonPin.push(pin);
      groups.overall.push(piston);

      // Combustion flash, driven by firing order and cylinder pressure
      const glow = el("circle", {
        cx: baseCx, cy: baseCy, r: boreR - 1, class: "top-glow", fill: rgb(COLOR_COMBUSTION), opacity: 0
      });
      svg.appendChild(glow);

      const labelY = isSingleBank ? baseCy + boreR + 25 : baseCy + plugDir * (boreR + 25);
      const label = el("text", {
        x: baseCx, y: labelY, class: "top-cyl-label", "text-anchor": "middle", fill: "#fff",
        "font-family": "monospace", "font-size": "14px"
      });
      label.textContent = String(i + 1);
      svg.appendChild(label);

      cylinders.push({
        index: i,
        bank,
        baseCx,
        baseCy,
        crankX: baseCx,
        crankY: centerY,
        phaseRad,
        fireDeg: firingAngleDeg(i, profile),
        pistonGroup,
        piston,
        pin,
        rod,
        crankPin,
        glow
      });
    }

    // Weak-point legend: rank order is filled in by applyWeakPoints every frame
    const legend = el("g", { class: "weak-legend", transform: `translate(12,${plotH + 14})` });
    const legendTitle = el("text", { x: 0, y: 0, class: "weak-legend-title" });
    legendTitle.textContent = labels.weakPointsTitle || "Weak points";
    legend.appendChild(legendTitle);
    const legendRows = [];
    for (let r = 0; r < WEAK_LIST_LEN; r++) {
      const row = el("text", { x: 0, y: 17 * (r + 1), class: "weak-legend-item" });
      legend.appendChild(row);
      legendRows.push(row);
    }
    svg.appendChild(legend);

    return {
      svg,
      cylinders,
      groups,
      mode: "top",
      crankRadiusMM: (profile.geometry && profile.geometry.strokeMM) ? profile.geometry.strokeMM / 2 : 40,
      rodLengthMM: (profile.geometry && profile.geometry.rodLengthMM) ? profile.geometry.rodLengthMM : 140,
      labels,
      glowFilterId,
      legendRows,
      weakNodes: [],
      peakBar: 0
    };
  }

  function updateCrankAngle(handle, thetaRad) {
    if (!handle) return;

    if (Array.isArray(handle)) {
      for (let i = 0; i < handle.length; i++) {
        updateCrankAngle(handle[i], thetaRad);
      }
      return;
    }

    if (!handle.cylinders && typeof handle === "object") {
      for (const k in handle) {
        if (Object.prototype.hasOwnProperty.call(handle, k) && handle[k]) {
          updateCrankAngle(handle[k], thetaRad);
        }
      }
      return;
    }

    if (!handle.cylinders) return;

    const crankR = handle.crankRadiusMM || 40;
    const rodL = handle.rodLengthMM || 140;

    if (handle.mode === "side") {
      const pxPerMM = handle.cylinders[0] ? (handle.cylinders[0].cylLen / (rodL + crankR)) : 1;
      for (const c of handle.cylinders) {
        const localTheta = thetaRad + c.phaseRad;
        const travelMM = pistonTravelMM(localTheta, crankR, rodL);
        const travelPx = travelMM * pxPerMM;

        const headX = c.cx + c.dirX * c.cylLen;
        const headY = c.crankY + c.dirY * c.cylLen;
        const px = headX - c.dirX * travelPx;
        const py = headY - c.dirY * travelPx;

        c.pistonGroup.setAttribute("transform", `translate(${px},${py})`);
        c.rod.setAttribute("x2", px);
        c.rod.setAttribute("y2", py);
      }
    } else if (handle.mode === "front") {
      const totalLenMM = crankR + rodL;
      const scalePxPerMM = 110 / totalLenMM;
      const rCrankPx = crankR * scalePxPerMM;
      const rRodPx = rodL * scalePxPerMM;

      for (const c of handle.cylinders) {
        const alpha = thetaRad + c.phaseRad;

        const cPinX = c.crankX + rCrankPx * Math.sin(alpha);
        const cPinY = c.crankY - rCrankPx * Math.cos(alpha);

        const alphaLocal = alpha - c.bankAngleRad;

        const distPx = rCrankPx * Math.cos(alphaLocal) +
          Math.sqrt(Math.max(0, rRodPx * rRodPx - Math.pow(rCrankPx * Math.sin(alphaLocal), 2)));

        const pistonX = c.crankX + c.dirX * distPx;
        const pistonY = c.crankY + c.dirY * distPx;

        c.pistonGroup.setAttribute("transform", `translate(${pistonX},${pistonY})`);

        if (c.crankArm) {
          c.crankArm.setAttribute("x1", c.crankX);
          c.crankArm.setAttribute("y1", c.crankY);
          c.crankArm.setAttribute("x2", cPinX);
          c.crankArm.setAttribute("y2", cPinY);
        }

        if (c.crankPin) {
          c.crankPin.setAttribute("cx", cPinX);
          c.crankPin.setAttribute("cy", cPinY);
        }

        if (c.rod) {
          c.rod.setAttribute("x1", cPinX);
          c.rod.setAttribute("y1", cPinY);
          c.rod.setAttribute("x2", pistonX);
          c.rod.setAttribute("y2", pistonY);
        }
      }
    } else if (handle.mode === "top") {
      // Top view: crank pin orbit projected onto the deck plane. Pistons do not
      // move visibly from above, so only the crank-pin projection animates.
      for (const c of handle.cylinders) {
        const alpha = thetaRad + c.phaseRad;
        const pinY = c.crankY + TOP_CRANK_PX * Math.sin(alpha);
        if (c.crankPin) {
          c.crankPin.setAttribute("cy", pinY);
        }
        if (c.rod) {
          c.rod.setAttribute("y1", pinY);
        }
      }
    }
  }

  /**
   * Pulses the top-view combustion glow in firing order.
   * Timing comes from the 720 deg cycle angle; amplitude from the simulated
   * cylinder pressure relative to its recent peak (zero when the engine is off).
   * @param {object} handle top-view handle
   * @param {number} cycleRad accumulated crank angle over the four-stroke cycle, radians
   * @param {number} cylinderPressureBar current simulated cylinder pressure
   */
  function updateCombustionPulse(handle, cycleRad, cylinderPressureBar) {
    if (!handle || handle.mode !== "top" || !Array.isArray(handle.cylinders)) return;

    const pressure = Number.isFinite(cylinderPressureBar) ? Math.max(0, cylinderPressureBar) : 0;
    handle.peakBar = Math.max(pressure, (handle.peakBar || 0) * PEAK_PRESSURE_DECAY);
    const load = handle.peakBar > 1e-6 ? Math.min(1, pressure / handle.peakBar) : 0;

    const cycleDeg = ((((cycleRad * 180) / Math.PI) % CYCLE_DEG) + CYCLE_DEG) % CYCLE_DEG;

    for (const c of handle.cylinders) {
      // Signed angle from this cylinder's firing point, in [-360, 360)
      let rel = (cycleDeg - c.fireDeg) % CYCLE_DEG;
      if (rel < 0) rel += CYCLE_DEG;
      if (rel > CYCLE_DEG / 2) rel -= CYCLE_DEG;

      const shape = Math.exp(-Math.pow((rel - COMBUSTION_PEAK_DEG) / COMBUSTION_SIGMA_DEG, 2));
      c.glow.setAttribute("opacity", (shape * load * COMBUSTION_MAX_OPACITY).toFixed(3));
    }
  }

  /**
   * Highlights the weakest component with a glow and lists the three weakest
   * components with their safety factors in the top-view legend.
   * @param {object} handle schematic handle with groups
   * @param {Array<{id:string, sf:number}>} components result.components
   */
  function applyWeakPoints(handle, components) {
    if (!handle || !handle.groups || !Array.isArray(components)) return;

    for (const node of handle.weakNodes || []) {
      node.style.filter = "";
    }
    handle.weakNodes = [];

    const ranked = components
      .filter((c) => Number.isFinite(c.sf))
      .sort((a, b) => a.sf - b.sf);

    if (ranked.length > 0 && handle.glowFilterId) {
      const nodes = handle.groups[ranked[0].id] || [];
      for (const node of nodes) {
        node.style.filter = `url(#${handle.glowFilterId})`;
        handle.weakNodes.push(node);
      }
    }

    if (Array.isArray(handle.legendRows)) {
      const labels = handle.labels || {};
      handle.legendRows.forEach((row, idx) => {
        const c = ranked[idx];
        if (!c) {
          if (row.textContent !== "") row.textContent = "";
          return;
        }
        const sfText = c.sf > 99 ? ">99" : c.sf.toFixed(2);
        const text = `${idx + 1}. ${labels[c.id] || c.id}  SF ${sfText}`;
        if (row.textContent !== text) row.textContent = text;
        const color = sfToVisual(c.sf).color;
        if (row.getAttribute("fill") !== color) row.setAttribute("fill", color);
      });
    }
  }

  function applyStressState(handle, components, labels) {
    if (!handle) return {};

    if (Array.isArray(handle)) {
      let lastInfo = {};
      for (let i = 0; i < handle.length; i++) {
        lastInfo = applyStressState(handle[i], components, labels);
      }
      return lastInfo;
    }

    if (!handle.groups && typeof handle === "object") {
      let lastInfo = {};
      for (const k in handle) {
        if (Object.prototype.hasOwnProperty.call(handle, k) && handle[k]) {
          lastInfo = applyStressState(handle[k], components, labels);
        }
      }
      return lastInfo;
    }

    labels = labels || {};
    const info = {};
    for (const comp of components) {
      const visual = sfToVisual(comp.sf);
      info[comp.id] = visual;
      const elements = handle.groups ? handle.groups[comp.id] || [] : [];
      const label = labels[comp.id] || comp.id;

      for (const node of elements) {
        _styleNode(node, visual);
        node.setAttribute(
          "data-tooltip",
          `${label}: σ=${comp.stress.toFixed(1)} MPa | SF=${comp.sf.toFixed(2)} | D=${(comp.damage * 100).toFixed(4)}%`
        );
      }
    }
    return info;
  }

  function applyOverallStress(handle, weakestLink) {
    if (!handle) return;

    if (Array.isArray(handle)) {
      for (let i = 0; i < handle.length; i++) {
        applyOverallStress(handle[i], weakestLink);
      }
      return;
    }

    if (!handle.groups && typeof handle === "object") {
      for (const k in handle) {
        if (Object.prototype.hasOwnProperty.call(handle, k) && handle[k]) {
          applyOverallStress(handle[k], weakestLink);
        }
      }
      return;
    }

    if (!handle.groups || !handle.groups.overall) return;
    const visual = sfToVisual(weakestLink.sf);

    for (const node of handle.groups.overall) {
      _styleNode(node, visual);
    }
  }

  function drawKennfield(canvas, map, rpmAxis, loadAxis, opPoint, unitLabel) {
    if (!canvas || !map || !map.length || !rpmAxis || !rpmAxis.length || !loadAxis || !loadAxis.length) {
      return;
    }
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    let min = Infinity;
    let max = -Infinity;
    for (const row of map) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const cellW = w / rpmAxis.length;
    const cellH = h / loadAxis.length;

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
    if (!axis || axis.length === 0) return 0.5;
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
  root.OEL.Renderer = {
    buildSchematic,
    updateCrankAngle,
    applyStressState,
    sfToVisual,
    drawKennfield,
    buildSchematicFront,
    buildSchematicTop,
    applyOverallStress,
    updateCombustionPulse,
    applyWeakPoints
  };
})(typeof window !== "undefined" ? window : global);
