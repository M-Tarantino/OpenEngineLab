/* OpenEngineLab :: js/dyno-engine.js — Advanced Dyno Test with Real-Time Thermodynamics */
(function (root) {
  "use strict";

  /**
   * DynoEngine: Realistic wide-open-throttle pull simulation
   * - Time-based simulation (not static peak values)
   * - Real thermodynamics: oil temp, chamber temp, cylinder pressure evolution
   * - Live graphical recording with pause/resume
   * - Automatic stop on knock or critical conditions
   * - Configurable speed (realtime or fast-forward up to 10×)
   * - Peak detection and results display
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
      state: null,
      ecm: null,
      isRunning: false,
      isPaused: false,
      startTime: 0,
      elapsedSeconds: 0,
      boostTargetBar: (Number.isFinite(labels.boostTargetBar) && labels.boostTargetBar > 0) ? labels.boostTargetBar : 1.0,
      timeScale: 1.0, // 1.0 = realtime, 10.0 = 10x speed
      dt: 0.01, // 10ms sim steps
      maxDuration: 20, // seconds (safety limit)
      // Controlled rpm sweep (inertia-dyno style): rpm is prescribed, torque/power are measured at each point
      sweepRateRpmPerS: (Number.isFinite(labels.sweepRateRpmPerS) && labels.sweepRateRpmPerS > 0) ? labels.sweepRateRpmPerS : 500,
      sweepStartRpm: Math.max(1500, Math.ceil(((engine && engine.idleRPM) || 800) * 1.5 / 100) * 100),
      // Knock is recorded and reported; it only aborts the sweep when explicitly requested via labels.stopOnKnock
      stopOnKnock: labels.stopOnKnock === true,
      peakPowerRpm: 0,
      peakTorqueRpm: 0,
      
      // Data recording
      history: [],
      peakPower: 0,
      peakTorque: 0,
      peakOilTemp: 0,
      peakCylinderPressure: 0,
      knockMarginMin: 999,
      knockDetected: false,
      hydrolockDetected: false,
      
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

    // Title + Close
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
      _stopDyno(dyno);
      dyno.container.style.display = "none";
    };
    header.appendChild(closeBtn);
    dyno.container.appendChild(header);

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
    dyno.state = OEL.Engine.createState(dyno.engine, dyno.turbo, dyno.fuel, {});
    dyno.ecm = OEL.ECM.createState();
    dyno.state.rpm = dyno.sweepStartRpm;
    
    dyno.history = [];
    dyno.peakPower = 0;
    dyno.peakTorque = 0;
    dyno.peakPowerRpm = 0;
    dyno.peakTorqueRpm = 0;
    dyno.peakOilTemp = 0;
    dyno.peakCylinderPressure = 0;
    dyno.knockMarginMin = 999;
    dyno.knockDetected = false;
    dyno.hydrolockDetected = false;
    dyno.elapsedSeconds = 0;
    dyno.stepAccumulator = 0;
    dyno.knockSince = null;
    
    dyno.isRunning = true;
    dyno.isPaused = false;
    dyno.startTime = performance.now();

    document.getElementById("dyno-start-btn").disabled = true;
    document.getElementById("dyno-pause-btn").disabled = false;
    document.getElementById("dyno-stop-btn").disabled = false;
    document.getElementById("dyno-speed-select").disabled = false;
    document.getElementById("dyno-speed-select").value = dyno.timeScale;

    _runDynoLoop(dyno);
  }

  function _runDynoLoop(dyno) {
    if (!dyno.isRunning) return;

    if (!dyno.isPaused) {
      const now = performance.now();
      // Clamp real frame time so a background tab cannot trigger a huge catch-up burst
      const realDt = Math.min((now - dyno.startTime) / 1000, 0.1);
      dyno.startTime = now;
      dyno.stepAccumulator += realDt * dyno.timeScale;

      const maxRpm = dyno.engine.revLimiterRPM || 7100;
      let finished = false;
      let steps = 0;

      while (dyno.stepAccumulator >= dyno.dt && steps < 2000 && !finished) {
        dyno.stepAccumulator -= dyno.dt;
        steps++;
        // Prescribed engine speed for this step; the engine model still computes torque, power and thermals
        const targetRpm = Math.min(maxRpm, dyno.sweepStartRpm + dyno.sweepRateRpmPerS * dyno.elapsedSeconds);
        dyno.state.rpm = targetRpm;
        dyno.elapsedSeconds += dyno.dt;

        const ecmOut = OEL.ECM.computeCycle(dyno.ecm, dyno.engine, dyno.turbo, {
          rpm: dyno.state.rpm,
          throttle01: 1.0,
          boostBar: dyno.state.boostBar,
          boostTargetBar: dyno.boostTargetBar,
          knockDetected: dyno.state.knockDetected,
          dt: dyno.dt
        });

        const result = OEL.Engine.step(dyno.state, dyno.dt, {
          throttle01: 1.0,
          ambientC: 25,
          baroBar: 1.0,
          boostCommandBar: ecmOut.boostCommandBar,
          ignitionAdvanceDeg: ecmOut.ignitionAdvanceDeg,
          cutIgnition: ecmOut.cutIgnition,
          nitrousActive: false,
          hybridDeployKw: 0,
          drivetrain: null
        });

        // Knock margin is derived the same way as in the standard benchmark
        const knockMarginPercent = result.knockLimitBar > 0
          ? ((result.knockLimitBar - result.cylinderPressureBar) / result.knockLimitBar) * 100
          : 0;
        const sf = result.weakestLink && Number.isFinite(result.weakestLink.sf) ? result.weakestLink.sf : 99;

        dyno.history.push({
          t: dyno.elapsedSeconds,
          rpm: result.rpm,
          power: result.powerHp,
          torque: result.brakeTorqueNm,
          boost: dyno.state.boostBar,
          oilTemp: dyno.state.oilTempC,
          cylinderPressure: result.cylinderPressureBar,
          knockMargin: knockMarginPercent,
          weakestLinkSf: sf
        });

        if (result.powerHp > dyno.peakPower) { dyno.peakPower = result.powerHp; dyno.peakPowerRpm = result.rpm; }
        if (result.brakeTorqueNm > dyno.peakTorque) { dyno.peakTorque = result.brakeTorqueNm; dyno.peakTorqueRpm = result.rpm; }
        dyno.peakOilTemp = Math.max(dyno.peakOilTemp, dyno.state.oilTempC);
        dyno.peakCylinderPressure = Math.max(dyno.peakCylinderPressure, result.cylinderPressureBar);
        dyno.knockMarginMin = Math.min(dyno.knockMarginMin, knockMarginPercent);

        if (dyno.state.knockDetected) {
          if (dyno.knockSince == null) dyno.knockSince = dyno.elapsedSeconds;
          dyno.knockDetected = true;
        } else {
          dyno.knockSince = null;
        }
        if (dyno.state.hydrolockFailure) dyno.hydrolockDetected = true;

        // Stop conditions: sweep reached the rev limiter, time limit, optional sustained knock (0.5 s), hydrolock, structural failure
        if (targetRpm >= maxRpm) finished = true;
        else if (dyno.elapsedSeconds > dyno.maxDuration) finished = true;
        else if (dyno.stopOnKnock && dyno.knockSince != null && dyno.elapsedSeconds - dyno.knockSince > 0.5) finished = true;
        else if (dyno.hydrolockDetected) finished = true;
        else if (sf < 1.0) finished = true;
      }

      if (dyno.history.length > 0) {
        _updateDynoStatus(dyno);
        _drawDynoChart(dyno);
      }

      if (finished) {
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
    const latest = dyno.history[dyno.history.length - 1];
    if (!latest) return;

    const statusItems = [
      { label: "Time", value: latest.t.toFixed(2) + "s" },
      { label: "RPM", value: Math.round(latest.rpm) },
      { label: "Power", value: latest.power.toFixed(0) + " hp" },
      { label: "Torque", value: latest.torque.toFixed(0) + " Nm" },
      { label: "Boost", value: latest.boost.toFixed(2) + " bar" },
      { label: "Oil Temp", value: latest.oilTemp.toFixed(1) + "°C" },
      { label: "Cyl Press", value: latest.cylinderPressure.toFixed(1) + " bar" },
      { label: "Knock Margin", value: (Number.isFinite(latest.knockMargin) ? latest.knockMargin.toFixed(1) : "—") + "%" },
      { label: "SF", value: _fmtSf(latest.weakestLinkSf) + "×", color: latest.weakestLinkSf < 1.0 ? "#c41e3a" : "#3ddc84" }
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
    if (dyno.history.length < 2) return;

    const mL = 56, mR = 56, mT = 28, mB = 44;
    const gW = w - mL - mR;
    const gH = h - mT - mB;
    const DIV = 5;

    const xMin = dyno.sweepStartRpm;
    const xMax = Math.max(xMin + 1, dyno.engine.revLimiterRPM || 7100);

    let peakP = 0;
    let peakT = 0;
    for (let i = 0; i < dyno.history.length; i++) {
      if (dyno.history[i].power > peakP) peakP = dyno.history[i].power;
      if (dyno.history[i].torque > peakT) peakT = dyno.history[i].torque;
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
      for (let i = 0; i < dyno.history.length; i++) {
        const pt = dyno.history[i];
        const x = xOf(pt.rpm);
        const y = yOf(pt[key], vMax);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    plotCurve("power", pMax, "#FF6B35");
    plotCurve("torque", tMax, "#3ddc84");

    // Axis titles
    ctx.fillStyle = "#FF6B35"; ctx.textAlign = "left";
    ctx.fillText("Power (hp)", mL, 16);
    ctx.fillStyle = "#3ddc84"; ctx.textAlign = "right";
    ctx.fillText("Torque (Nm)", mL + gW, 16);
    ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
    ctx.fillText("Engine speed (rpm)", mL + gW / 2, h - 6);
  }

  function _stopDyno(dyno) {
    dyno.isRunning = false;
    if (dyno.rafId != null) { cancelAnimationFrame(dyno.rafId); dyno.rafId = null; }

    document.getElementById("dyno-start-btn").disabled = false;
    document.getElementById("dyno-pause-btn").disabled = true;
    document.getElementById("dyno-pause-btn").textContent = "PAUSE";
    document.getElementById("dyno-stop-btn").disabled = true;
    document.getElementById("dyno-speed-select").disabled = true;

    _showDynoResults(dyno);
  }

  function _showDynoResults(dyno) {
    dyno.chartsDiv.innerHTML = "";
    dyno.chartsDiv.style.display = "block";

    const results = document.createElement("div");
    results.style.display = "grid";
    results.style.gridTemplateColumns = "repeat(auto-fit, minmax(150px, 1fr))";
    results.style.gap = "12px";

    const resultItems = [
      { label: "Duration", value: dyno.elapsedSeconds.toFixed(2) + "s" },
      { label: "Peak Power", value: dyno.peakPower.toFixed(0) + " hp @ " + Math.round(dyno.peakPowerRpm) + " rpm" },
      { label: "Peak Torque", value: dyno.peakTorque.toFixed(0) + " Nm @ " + Math.round(dyno.peakTorqueRpm) + " rpm" },
      { label: "Peak Oil Temp", value: dyno.peakOilTemp.toFixed(1) + "°C" },
      { label: "Peak Cyl Pressure", value: dyno.peakCylinderPressure.toFixed(1) + " bar" },
      { label: "Knock Margin Min", value: dyno.knockMarginMin.toFixed(1) + "%" },
      { label: "Knock Detected", value: dyno.knockDetected ? "YES" : "NO", color: dyno.knockDetected ? "#c41e3a" : "#3ddc84" },
      { label: "Hydrolock Risk", value: dyno.hydrolockDetected ? "YES" : "NO", color: dyno.hydrolockDetected ? "#c41e3a" : "#3ddc84" }
    ];

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
    createDynoTest
  };
})(typeof window !== "undefined" ? window : global);
