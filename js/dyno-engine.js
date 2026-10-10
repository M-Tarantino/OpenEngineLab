/* OpenEngineLab :: js/dyno-engine.js — live Dyno v2: renders the shared sweep core from OEL.Benchmark in real time */
(function (root) {
  "use strict";

  /**
   * DynoEngine: live view of the standardized WOT sweep.
   * - Steps the exact same core as the Dyno Test, Comparison Mode and Realism Check
   *   (OEL.Benchmark.createSweepRun), so identical setups give identical numbers
   * - Controlled rpm sweep after a full-throttle spool-up hold
   * - Live power/torque-vs-rpm chart with independent axes, pause/resume, 1x/5x/10x speed
   * - Peak detection, knock/hydrolock/structural reporting after the run
   *
   * labels: { title, showHeader, boostTargetBar, ambientC, baroBar, sweepRateRpmPerS, drivelineLossPct, onDrivelineLossChange }
   * Optional reference curve: load a CSV (rpm,torque_nm,power_hp, "# basis=wheel|crank") to overlay real dyno data
   */

  function createDynoTest(containerDivId, engine, turbo, fuel, labels) {
    labels = labels || {};
    const container = document.getElementById(containerDivId);
    if (!container) {
      console.error(`Container #${containerDivId} not found`);
      return null;
    }

    const dyno = {
      engine,
      turbo,
      fuel,
      labels,
      run: null,
      reference: null, // optional real dyno curve for calibration: { name, basis, rpm[], torqueNm[], powerHp[] }
      isRunning: false,
      isPaused: false,
      lastFrameTime: 0,
      stepAccumulator: 0,
      timeScale: 1.0, // 1.0 = realtime, 10.0 = 10x speed
      rafId: null,

      // UI
      container,
      canvas: null,
      statusDiv: null,
      controlsDiv: null,
      chartsDiv: null
    };

    _buildDynoUI(dyno);
    return dyno;
  }

  const HP_K = 7127; // hp = Nm * rpm / HP_K (same constant as the engine model)

  // Parses a reference dyno curve. Columns: rpm, torque_nm, power_hp (header optional).
  // Optional comment line "# basis=wheel" or "# basis=crank" tells which power the data represents.
  function parseReferenceCsv(text, fileName) {
    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
    let basis = "crank";
    const rows = [];
    let delimiter = null;
    let cols = { rpm: 0, torque: 1, power: 2 };
    let powerFactor = 1;
    let headerSeen = false;

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li].trim();
      if (!raw) continue;
      if (raw.charAt(0) === "#") {
        const m = /basis\s*=\s*(wheel|crank)/i.exec(raw);
        if (m) basis = m[1].toLowerCase();
        continue;
      }
      if (!delimiter) delimiter = raw.indexOf(";") >= 0 ? ";" : (raw.indexOf("\t") >= 0 ? "\t" : ",");
      const fields = raw.split(delimiter).map(f => f.trim());
      const numeric = fields.map(f => parseFloat(delimiter === "," ? f : f.replace(",", ".")));

      if (!headerSeen && fields.some(f => /[a-z]/i.test(f))) {
        headerSeen = true;
        const names = fields.map(f => f.toLowerCase());
        const find = (re) => names.findIndex(n => re.test(n));
        const iRpm = find(/rpm|drehzahl/);
        const iTq = find(/torque|nm|moment/);
        const iPw = find(/power|hp|ps|kw|leistung/);
        if (iRpm < 0 || iTq < 0 || iPw < 0) throw new Error("CSV header needs rpm, torque and power columns");
        cols = { rpm: iRpm, torque: iTq, power: iPw };
        const pn = names[iPw];
        if (/kw/.test(pn)) powerFactor = 1.34102;
        else if (/ps/.test(pn) && !/hp/.test(pn)) powerFactor = 1 / 1.01387;
        continue;
      }
      headerSeen = true;
      const rpm = numeric[cols.rpm];
      const tq = numeric[cols.torque];
      const pw = numeric[cols.power];
      if (Number.isFinite(rpm) && Number.isFinite(tq) && Number.isFinite(pw) && rpm > 0) {
        rows.push({ rpm, tq, pw: pw * powerFactor });
      }
    }

    if (rows.length < 5) throw new Error("CSV needs at least 5 valid rows (rpm, torque, power)");
    rows.sort((a, b) => a.rpm - b.rpm);
    return {
      name: fileName || "reference",
      basis,
      rpm: rows.map(r => r.rpm),
      torqueNm: rows.map(r => r.tq),
      powerHp: rows.map(r => r.pw)
    };
  }

  // Linear interpolation on a sorted x array
  function _interp(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  }

  // Compares the recorded sweep with the loaded reference curve on the reference's own basis
  // (wheel reference -> simulated wheel power; crank reference -> simulated crank power)
  function _compareToReference(dyno) {
    const ref = dyno.reference;
    const series = dyno.run ? dyno.run.series : [];
    if (!ref || series.length < 2) return null;
    const wheel = ref.basis === "wheel";
    const simRpm = series.map(p => p.rpm);
    const simPower = series.map(p => (wheel ? p.wheelPowerHp : p.powerHp));
    const simTorque = series.map(p => (wheel ? (p.rpm > 0 ? (p.wheelPowerHp * HP_K) / p.rpm : 0) : p.brakeTorqueNm));
    const lo = Math.max(simRpm[0], ref.rpm[0]);
    const hi = Math.min(simRpm[simRpm.length - 1], ref.rpm[ref.rpm.length - 1]);
    if (!(hi > lo)) return null;

    let sumP = 0, sumT = 0, n = 0;
    for (let i = 0; i < ref.rpm.length; i++) {
      const r = ref.rpm[i];
      if (r < lo || r > hi || ref.powerHp[i] <= 0 || ref.torqueNm[i] <= 0) continue;
      sumP += Math.abs(_interp(simRpm, simPower, r) - ref.powerHp[i]) / ref.powerHp[i];
      sumT += Math.abs(_interp(simRpm, simTorque, r) - ref.torqueNm[i]) / ref.torqueNm[i];
      n++;
    }
    if (n === 0) return null;

    const argMax = (arr, xs) => { let k = 0; for (let i = 1; i < arr.length; i++) if (arr[i] > arr[k]) k = i; return { v: arr[k], rpm: xs[k] }; };
    const sp = argMax(simPower, simRpm), st = argMax(simTorque, simRpm);
    const rp = argMax(ref.powerHp, ref.rpm), rt = argMax(ref.torqueNm, ref.rpm);
    return {
      basis: ref.basis,
      mapePower: (sumP / n) * 100,
      mapeTorque: (sumT / n) * 100,
      simPeakPower: sp, refPeakPower: rp,
      simPeakTorque: st, refPeakTorque: rt
    };
  }

  function _setReference(dyno, text, fileName) {
    const status = document.getElementById("dyno-ref-status");
    try {
      dyno.reference = parseReferenceCsv(text, fileName);
      if (status) { status.textContent = dyno.reference.name + " (" + dyno.reference.basis + ")"; status.style.color = "#6EC1FF"; }
    } catch (err) {
      dyno.reference = null;
      if (status) { status.textContent = String(err.message || err); status.style.color = "#c41e3a"; }
    }
    _drawDynoChart(dyno);
  }

  function _buildDynoUI(dyno) {
    dyno.container.innerHTML = "";
    dyno.container.style.display = "flex";
    dyno.container.style.flexDirection = "column";
    dyno.container.style.gap = "12px";
    dyno.container.style.padding = "16px";
    dyno.container.style.backgroundColor = "#0a0a0a";
    dyno.container.style.borderRadius = "8px";
    dyno.container.style.color = "#fff";
    dyno.container.style.fontFamily = "JetBrains Mono, monospace";

    // Title + Close (optional: the host panel may provide its own)
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.borderBottom = "1px solid #444";
    header.style.paddingBottom = "8px";

    const title = document.createElement("h3");
    title.textContent = dyno.labels.title || "Dyno Test (Real-Time)";
    title.style.margin = "0";
    title.style.fontSize = "16px";
    title.style.color = "#FF6B35";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.width = "32px";
    closeBtn.style.height = "32px";
    closeBtn.style.border = "none";
    closeBtn.style.backgroundColor = "#333";
    closeBtn.style.color = "#fff";
    closeBtn.style.borderRadius = "4px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "18px";
    closeBtn.onclick = () => {
      if (dyno.isRunning) _stopDyno(dyno);
      dyno.container.style.display = "none";
    };
    header.appendChild(closeBtn);
    if (dyno.labels.showHeader !== false) dyno.container.appendChild(header);

    // Controls
    dyno.controlsDiv = document.createElement("div");
    dyno.controlsDiv.style.display = "flex";
    dyno.controlsDiv.style.gap = "8px";
    dyno.controlsDiv.style.flexWrap = "wrap";
    dyno.controlsDiv.style.alignItems = "center";

    // Start Button
    const startBtn = document.createElement("button");
    startBtn.id = "dyno-start-btn";
    startBtn.textContent = "START";
    startBtn.style.padding = "8px 16px";
    startBtn.style.border = "1px solid #FF6B35";
    startBtn.style.borderRadius = "4px";
    startBtn.style.backgroundColor = "#FF6B35";
    startBtn.style.color = "#000";
    startBtn.style.cursor = "pointer";
    startBtn.style.fontSize = "13px";
    startBtn.style.fontWeight = "bold";
    startBtn.onclick = () => {
      if (!dyno.isRunning) {
        _startDyno(dyno);
      }
    };
    dyno.controlsDiv.appendChild(startBtn);

    // Pause/Resume Button
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "dyno-pause-btn";
    pauseBtn.textContent = "PAUSE";
    pauseBtn.style.padding = "8px 16px";
    pauseBtn.style.border = "1px solid #666";
    pauseBtn.style.borderRadius = "4px";
    pauseBtn.style.backgroundColor = "#333";
    pauseBtn.style.color = "#aaa";
    pauseBtn.style.cursor = "pointer";
    pauseBtn.style.fontSize = "13px";
    pauseBtn.disabled = true;
    pauseBtn.onclick = () => {
      dyno.isPaused = !dyno.isPaused;
      pauseBtn.textContent = dyno.isPaused ? "RESUME" : "PAUSE";
      pauseBtn.style.backgroundColor = dyno.isPaused ? "#1a3a1a" : "#333";
    };
    dyno.controlsDiv.appendChild(pauseBtn);

    // Stop Button
    const stopBtn = document.createElement("button");
    stopBtn.id = "dyno-stop-btn";
    stopBtn.textContent = "STOP";
    stopBtn.style.padding = "8px 16px";
    stopBtn.style.border = "1px solid #c41e3a";
    stopBtn.style.borderRadius = "4px";
    stopBtn.style.backgroundColor = "#333";
    stopBtn.style.color = "#c41e3a";
    stopBtn.style.cursor = "pointer";
    stopBtn.style.fontSize = "13px";
    stopBtn.disabled = true;
    stopBtn.onclick = () => _stopDyno(dyno);
    dyno.controlsDiv.appendChild(stopBtn);

    // Speed selector
    const speedLabel = document.createElement("span");
    speedLabel.textContent = "Speed: ";
    speedLabel.style.color = "#aaa";
    speedLabel.style.fontSize = "12px";
    dyno.controlsDiv.appendChild(speedLabel);

    const speedSelect = document.createElement("select");
    speedSelect.style.padding = "4px 8px";
    speedSelect.style.border = "1px solid #555";
    speedSelect.style.borderRadius = "4px";
    speedSelect.style.backgroundColor = "#222";
    speedSelect.style.color = "#fff";
    speedSelect.style.fontSize = "12px";
    speedSelect.disabled = true;
    speedSelect.id = "dyno-speed-select";

    [
      { label: "Real-Time (1×)", value: 1 },
      { label: "Fast (5×)", value: 5 },
      { label: "Very Fast (10×)", value: 10 }
    ].forEach(opt => {
      const option = document.createElement("option");
      option.textContent = opt.label;
      option.value = opt.value;
      speedSelect.appendChild(option);
    });

    speedSelect.onchange = () => {
      dyno.timeScale = parseFloat(speedSelect.value);
    };
    dyno.controlsDiv.appendChild(speedSelect);

    // Driveline loss (crank power -> wheel power); applied when the next run starts
    const lossLabel = document.createElement("span");
    lossLabel.textContent = "Driveline loss (%): ";
    lossLabel.style.color = "#aaa";
    lossLabel.style.fontSize = "12px";
    dyno.controlsDiv.appendChild(lossLabel);

    const lossInput = document.createElement("input");
    lossInput.id = "dyno-loss-input";
    lossInput.type = "number";
    lossInput.min = "0";
    lossInput.max = "60";
    lossInput.step = "1";
    lossInput.value = String(Number.isFinite(dyno.labels.drivelineLossPct) ? dyno.labels.drivelineLossPct : OEL.Benchmark.DEFAULT_DRIVELINE_LOSS_PCT);
    lossInput.style.width = "64px";
    lossInput.style.padding = "4px 8px";
    lossInput.style.border = "1px solid #555";
    lossInput.style.borderRadius = "4px";
    lossInput.style.backgroundColor = "#222";
    lossInput.style.color = "#fff";
    lossInput.style.fontSize = "12px";
    lossInput.onchange = () => {
      const v = Math.min(60, Math.max(0, parseFloat(lossInput.value)));
      const pct = Number.isFinite(v) ? v : OEL.Benchmark.DEFAULT_DRIVELINE_LOSS_PCT;
      lossInput.value = String(pct);
      dyno.labels.drivelineLossPct = pct;
      if (typeof dyno.labels.onDrivelineLossChange === "function") dyno.labels.onDrivelineLossChange(pct);
    };
    dyno.controlsDiv.appendChild(lossInput);

    // Reference curve (CSV) for calibration: drawn dotted over the simulated curves
    const refLabel = document.createElement("span");
    refLabel.textContent = "Reference curve (CSV): ";
    refLabel.style.color = "#aaa";
    refLabel.style.fontSize = "12px";
    dyno.controlsDiv.appendChild(refLabel);

    const refInput = document.createElement("input");
    refInput.id = "dyno-ref-input";
    refInput.type = "file";
    refInput.accept = ".csv,.txt,text/csv,text/plain";
    refInput.style.fontSize = "12px";
    refInput.style.color = "#aaa";
    refInput.onchange = () => {
      const file = refInput.files && refInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => _setReference(dyno, reader.result, file.name);
      reader.readAsText(file);
    };
    dyno.controlsDiv.appendChild(refInput);

    const refStatus = document.createElement("span");
    refStatus.id = "dyno-ref-status";
    refStatus.textContent = "none";
    refStatus.style.fontSize = "12px";
    refStatus.style.color = "#777";
    dyno.controlsDiv.appendChild(refStatus);

    const refClear = document.createElement("button");
    refClear.id = "dyno-ref-clear";
    refClear.textContent = "✕";
    refClear.title = "Remove reference curve";
    refClear.style.padding = "2px 8px";
    refClear.style.border = "1px solid #555";
    refClear.style.borderRadius = "4px";
    refClear.style.backgroundColor = "#222";
    refClear.style.color = "#fff";
    refClear.style.cursor = "pointer";
    refClear.onclick = () => {
      dyno.reference = null;
      refInput.value = "";
      refStatus.textContent = "none";
      refStatus.style.color = "#777";
      _drawDynoChart(dyno);
    };
    dyno.controlsDiv.appendChild(refClear);

    dyno.container.appendChild(dyno.controlsDiv);

    // Status readout
    dyno.statusDiv = document.createElement("div");
    dyno.statusDiv.style.display = "grid";
    dyno.statusDiv.style.gridTemplateColumns = "repeat(auto-fit, minmax(120px, 1fr))";
    dyno.statusDiv.style.gap = "8px";
    dyno.statusDiv.style.padding = "12px";
    dyno.statusDiv.style.backgroundColor = "#111";
    dyno.statusDiv.style.borderRadius = "4px";
    dyno.statusDiv.style.border = "1px solid #333";
    dyno.statusDiv.style.fontSize = "11px";

    dyno.container.appendChild(dyno.statusDiv);

    // Canvas for live chart
    dyno.canvas = document.createElement("canvas");
    dyno.canvas.width = 600;
    dyno.canvas.height = 300;
    dyno.canvas.style.border = "1px solid #333";
    dyno.canvas.style.borderRadius = "4px";
    dyno.canvas.style.backgroundColor = "#000";
    dyno.canvas.style.width = "100%";
    dyno.canvas.style.height = "auto";
    dyno.canvas.style.aspectRatio = "2 / 1";
    dyno.container.appendChild(dyno.canvas);

    // Results section
    dyno.chartsDiv = document.createElement("div");
    dyno.chartsDiv.style.display = "none";
    dyno.chartsDiv.style.borderTop = "1px solid #444";
    dyno.chartsDiv.style.paddingTop = "12px";
    dyno.chartsDiv.style.marginTop = "12px";
    dyno.container.appendChild(dyno.chartsDiv);
  }

  function _startDyno(dyno) {
    // Same setup object shape as every other benchmark call site
    dyno.run = OEL.Benchmark.createSweepRun({
      engine: dyno.engine,
      turbo: dyno.turbo,
      fuel: dyno.fuel,
      extras: {},
      boostTargetBar: dyno.labels.boostTargetBar,
      ambientC: dyno.labels.ambientC,
      baroBar: dyno.labels.baroBar,
      sweepRateRpmPerS: dyno.labels.sweepRateRpmPerS,
      drivelineLossPct: dyno.labels.drivelineLossPct
    });

    dyno.stepAccumulator = 0;
    dyno.lastFrameTime = performance.now();
    dyno.isRunning = true;
    dyno.isPaused = false;

    document.getElementById("dyno-start-btn").disabled = true;
    document.getElementById("dyno-pause-btn").disabled = false;
    document.getElementById("dyno-stop-btn").disabled = false;
    document.getElementById("dyno-speed-select").disabled = false;
    document.getElementById("dyno-loss-input").disabled = true;

    dyno.chartsDiv.style.display = "none";
    dyno.chartsDiv.innerHTML = "";
    dyno.canvas.getContext("2d").clearRect(0, 0, dyno.canvas.width, dyno.canvas.height);

    dyno.rafId = requestAnimationFrame(() => _runDynoLoop(dyno));
  }

  function _runDynoLoop(dyno) {
    if (!dyno.isRunning) return;
    const run = dyno.run;
    const now = performance.now();

    if (dyno.isPaused) {
      // Keep the frame clock current so resuming does not trigger a catch-up burst
      dyno.lastFrameTime = now;
    } else {
      // Clamp real frame time so a background tab cannot trigger a huge catch-up burst
      const realDt = Math.min((now - dyno.lastFrameTime) / 1000, 0.1);
      dyno.lastFrameTime = now;
      dyno.stepAccumulator += realDt * dyno.timeScale;

      let steps = 0;
      while (dyno.stepAccumulator >= run.config.dt && steps < 2000 && !run.done) {
        dyno.stepAccumulator -= run.config.dt;
        run.step();
        steps++;
      }

      if (run.latest) _updateDynoStatus(dyno);
      _drawDynoChart(dyno);

      if (run.done) {
        _stopDyno(dyno);
        return;
      }
    }

    dyno.rafId = requestAnimationFrame(() => _runDynoLoop(dyno));
  }

  // Safety factors explode toward infinity when the load is near zero; show a capped value instead
  function _fmtSf(sf) {
    return Number.isFinite(sf) && sf <= 99 ? sf.toFixed(2) : ">99";
  }

  function _updateDynoStatus(dyno) {
    const run = dyno.run;
    const s = run.latest;
    if (!s) return;

    const statusItems = [
      { label: "Phase", value: s.phase === "hold" ? "Spool-up" : "Sweep" },
      { label: "Time", value: run.timeS.toFixed(2) + "s" },
      { label: "RPM", value: Math.round(s.rpm) },
      { label: "Power (crank)", value: s.powerHp.toFixed(0) + " hp" },
      { label: "Power (wheels)", value: s.wheelPowerHp.toFixed(0) + " hp" },
      { label: "Torque", value: s.brakeTorqueNm.toFixed(0) + " Nm" },
      { label: "Boost", value: s.boostBar.toFixed(2) + " bar" },
      { label: "Boost Target", value: run.config.boostTargetBar.toFixed(2) + " bar" },
      { label: "Oil Temp", value: s.oilTempC.toFixed(1) + "°C" },
      { label: "Cyl Press", value: s.cylinderPressureBar.toFixed(1) + " bar" },
      { label: "Knock Margin", value: (Number.isFinite(s.knockMarginPercent) ? s.knockMarginPercent.toFixed(1) : "—") + "%", color: s.knockDetected ? "#c41e3a" : "#3ddc84" },
      { label: "SF", value: _fmtSf(s.weakestSf) + "×", color: s.weakestSf < 1.0 ? "#c41e3a" : "#3ddc84" }
    ];

    dyno.statusDiv.innerHTML = statusItems.map(item => {
      const div = document.createElement("div");
      div.innerHTML = `<div style="font-size: 10px; color: #aaa;">${item.label}</div><div style="font-size: 13px; font-weight: bold; color: ${item.color || '#3ddc84'};">${item.value}</div>`;
      return div.outerHTML;
    }).join("");
  }

  // Rounds a maximum up so that `divisions` equal grid steps land on "nice" numbers
  function _niceCeil(value, divisions) {
    if (!(value > 0)) return divisions;
    const raw = value / divisions;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 8, 10];
    let step = 10;
    for (let i = 0; i < steps.length; i++) {
      if (norm <= steps[i]) { step = steps[i]; break; }
    }
    return step * mag * divisions;
  }

  function _drawDynoChart(dyno) {
    const canvas = dyno.canvas;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const series = dyno.run ? dyno.run.series : [];
    const ref = dyno.reference;
    if (series.length < 2 && !ref) return;

    const mL = 56, mR = 56, mT = 28, mB = 44;
    const gW = w - mL - mR;
    const gH = h - mT - mB;
    const DIV = 5;

    // X range: the sweep range once a run exists, otherwise the range of the reference curve
    const xMin = dyno.run ? dyno.run.config.startRpm : ref.rpm[0];
    const xMax = dyno.run ? dyno.run.config.endRpm : ref.rpm[ref.rpm.length - 1];

    let peakP = 0;
    let peakT = 0;
    for (let i = 0; i < series.length; i++) {
      if (series[i].powerHp > peakP) peakP = series[i].powerHp;
      if (series[i].brakeTorqueNm > peakT) peakT = series[i].brakeTorqueNm;
    }
    if (ref) {
      for (let i = 0; i < ref.rpm.length; i++) {
        if (ref.powerHp[i] > peakP) peakP = ref.powerHp[i];
        if (ref.torqueNm[i] > peakT) peakT = ref.torqueNm[i];
      }
    }
    // Each quantity has its own axis; both share the same 5 grid lines
    const pMax = _niceCeil(peakP, DIV);
    const tMax = _niceCeil(peakT, DIV);

    const xOf = (rpm) => mL + ((rpm - xMin) / (xMax - xMin)) * gW;
    const yOf = (v, vMax) => mT + gH - (v / vMax) * gH;

    ctx.font = "11px monospace";
    ctx.lineWidth = 0.5;

    // Horizontal grid with both y-axis labels
    for (let i = 0; i <= DIV; i++) {
      const y = mT + gH - (i / DIV) * gH;
      ctx.strokeStyle = "#222";
      ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + gW, y); ctx.stroke();
      ctx.fillStyle = "#FF6B35"; ctx.textAlign = "right";
      ctx.fillText(String(Math.round((pMax * i) / DIV)), mL - 6, y + 4);
      ctx.fillStyle = "#3ddc84"; ctx.textAlign = "left";
      ctx.fillText(String(Math.round((tMax * i) / DIV)), mL + gW + 6, y + 4);
    }

    // Vertical grid with rpm labels
    const xStep = (xMax - xMin) > 4000 ? 1000 : 500;
    ctx.textAlign = "center";
    for (let r = Math.ceil(xMin / xStep) * xStep; r <= xMax; r += xStep) {
      const x = xOf(r);
      ctx.strokeStyle = "#222";
      ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + gH); ctx.stroke();
      ctx.fillStyle = "#aaa";
      ctx.fillText(String(r), x, mT + gH + 16);
    }

    // Axes
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mL, mT);
    ctx.lineTo(mL, mT + gH);
    ctx.lineTo(mL + gW, mT + gH);
    ctx.lineTo(mL + gW, mT);
    ctx.stroke();

    // Curves over engine speed
    const plotCurve = (key, vMax, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < series.length; i++) {
        const x = xOf(series[i].rpm);
        const y = yOf(series[i][key], vMax);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    plotCurve("powerHp", pMax, "#FF6B35");
    ctx.setLineDash([6, 4]);
    plotCurve("wheelPowerHp", pMax, "#FFB38F");
    ctx.setLineDash([]);
    plotCurve("brakeTorqueNm", tMax, "#3ddc84");

    // Reference curve (real dyno data), dotted
    if (ref) {
      const plotRef = (xs, ys, vMax, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < xs.length; i++) {
          if (xs[i] < xMin || xs[i] > xMax) continue;
          const x = xOf(xs[i]);
          const y = yOf(ys[i], vMax);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      ctx.setLineDash([2, 3]);
      plotRef(ref.rpm, ref.powerHp, pMax, "#6EC1FF");
      plotRef(ref.rpm, ref.torqueNm, tMax, "#C9A6FF");
      ctx.setLineDash([]);
      ctx.fillStyle = "#6EC1FF"; ctx.textAlign = "center";
      ctx.fillText("dotted = ref (" + ref.basis + ")", mL + gW / 2, 16);
    }

    // Axis titles
    ctx.fillStyle = "#FF6B35"; ctx.textAlign = "left";
    ctx.fillText("bhp (solid) / whp (dashed)", mL, 16);
    ctx.fillStyle = "#3ddc84"; ctx.textAlign = "right";
    ctx.fillText("Torque (Nm)", mL + gW, 16);
    ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
    ctx.fillText("Engine speed (rpm)", mL + gW / 2, h - 6);
  }

  function _stopDyno(dyno) {
    if (!dyno.isRunning) return;
    dyno.isRunning = false;
    if (dyno.rafId != null) { cancelAnimationFrame(dyno.rafId); dyno.rafId = null; }

    document.getElementById("dyno-start-btn").disabled = false;
    document.getElementById("dyno-pause-btn").disabled = true;
    document.getElementById("dyno-pause-btn").textContent = "PAUSE";
    document.getElementById("dyno-stop-btn").disabled = true;
    document.getElementById("dyno-speed-select").disabled = true;
    document.getElementById("dyno-loss-input").disabled = false;

    _drawDynoChart(dyno);
    _showDynoResults(dyno);
  }

  function _showDynoResults(dyno) {
    const run = dyno.run;
    const peak = run.peak;
    dyno.chartsDiv.innerHTML = "";
    dyno.chartsDiv.style.display = "block";

    const endText = {
      structural: "Structural failure",
      hydrolock: "Hydrolock",
      numeric: "Numeric error"
    }[peak.failure] || (run.done ? "Sweep complete" : "Stopped manually");
    const endColor = peak.failure ? "#c41e3a" : "#3ddc84";

    const results = document.createElement("div");
    results.style.display = "grid";
    results.style.gridTemplateColumns = "repeat(auto-fit, minmax(150px, 1fr))";
    results.style.gap = "12px";

    const resultItems = [
      { label: "Run Ended", value: endText + " @ " + Math.round(peak.endRpm) + " rpm", color: endColor },
      { label: "Duration", value: run.timeS.toFixed(2) + "s" },
      { label: "Boost Target", value: run.config.boostTargetBar.toFixed(2) + " bar" },
      { label: "Peak Power (crank, bhp)", value: peak.powerHp.toFixed(0) + " hp (" + OEL.Benchmark.hpToPs(peak.powerHp).toFixed(0) + " PS) @ " + Math.round(peak.powerHpRpm) + " rpm" },
      { label: "Peak Power (wheels, whp)", value: peak.wheelPowerHp.toFixed(0) + " hp (" + OEL.Benchmark.hpToPs(peak.wheelPowerHp).toFixed(0) + " PS) @ " + Math.round(peak.wheelPowerHpRpm) + " rpm" },
      { label: "Driveline Loss", value: run.config.drivelineLossPct.toFixed(0) + "%" },
      { label: "Peak Torque", value: peak.brakeTorqueNm.toFixed(0) + " Nm @ " + Math.round(peak.torqueRpm) + " rpm" },
      { label: "Peak Oil Temp", value: peak.oilTempC.toFixed(1) + "°C" },
      { label: "Peak Cyl Pressure", value: peak.cylinderPressureBar.toFixed(1) + " bar" },
      { label: "Knock Margin Min", value: peak.knockMarginPercentMin.toFixed(1) + "%" },
      { label: "Knock Detected", value: peak.knockDetected ? "YES" : "NO", color: peak.knockDetected ? "#c41e3a" : "#3ddc84" },
      { label: "Weakest Link SF", value: _fmtSf(peak.weakestSfMin) + "×", color: peak.weakestSfMin < 1.0 ? "#c41e3a" : "#3ddc84" },
      { label: "Hydrolock Risk", value: peak.failure === "hydrolock" ? "YES" : "NO", color: peak.failure === "hydrolock" ? "#c41e3a" : "#3ddc84" }
    ];

    // Calibration view: deviation of the simulated sweep from the loaded reference curve
    const cmp = _compareToReference(dyno);
    if (cmp) {
      const errColor = (pct) => (pct <= 5 ? "#3ddc84" : (pct <= 15 ? "#FFB627" : "#c41e3a"));
      const signed = (sim, ref) => { const p = ((sim - ref) / ref) * 100; return (p >= 0 ? "+" : "") + p.toFixed(0) + "%"; };
      resultItems.push(
        { label: "Reference", value: dyno.reference.name + " (" + cmp.basis + ")", color: "#6EC1FF" },
        { label: "Power error vs ref (mean abs)", value: cmp.mapePower.toFixed(1) + "%", color: errColor(cmp.mapePower) },
        { label: "Torque error vs ref (mean abs)", value: cmp.mapeTorque.toFixed(1) + "%", color: errColor(cmp.mapeTorque) },
        { label: "Peak power sim vs ref", value: cmp.simPeakPower.v.toFixed(0) + " vs " + cmp.refPeakPower.v.toFixed(0) + " hp (" + signed(cmp.simPeakPower.v, cmp.refPeakPower.v) + ") @ " + Math.round(cmp.simPeakPower.rpm) + " vs " + Math.round(cmp.refPeakPower.rpm) + " rpm" },
        { label: "Peak torque sim vs ref", value: cmp.simPeakTorque.v.toFixed(0) + " vs " + cmp.refPeakTorque.v.toFixed(0) + " Nm (" + signed(cmp.simPeakTorque.v, cmp.refPeakTorque.v) + ") @ " + Math.round(cmp.simPeakTorque.rpm) + " vs " + Math.round(cmp.refPeakTorque.rpm) + " rpm" }
      );
    }

    resultItems.forEach(item => {
      const div = document.createElement("div");
      div.style.padding = "12px";
      div.style.backgroundColor = "#111";
      div.style.borderRadius = "4px";
      div.style.border = "1px solid #333";
      div.innerHTML = `<div style="font-size: 10px; color: #aaa; margin-bottom: 4px;">${item.label}</div><div style="font-size: 14px; font-weight: bold; color: ${item.color || '#3ddc84'};">${item.value}</div>`;
      results.appendChild(div);
    });

    dyno.chartsDiv.appendChild(results);
  }

  root.OEL = root.OEL || {};
  root.OEL.DynoEngine = {
    createDynoTest,
    parseReferenceCsv
  };
})(typeof window !== "undefined" ? window : global);
