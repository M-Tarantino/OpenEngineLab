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
      maxDuration: 20, // seconds
      
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
    
    dyno.history = [];
    dyno.peakPower = 0;
    dyno.peakTorque = 0;
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
          rpm: dyno.state.rpm,
          power: result.powerHp,
          torque: result.brakeTorqueNm,
          boost: dyno.state.boostBar,
          oilTemp: dyno.state.oilTempC,
          cylinderPressure: result.cylinderPressureBar,
          knockMargin: knockMarginPercent,
          weakestLinkSf: sf
        });

        dyno.peakPower = Math.max(dyno.peakPower, result.powerHp);
        dyno.peakTorque = Math.max(dyno.peakTorque, result.brakeTorqueNm);
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

        // Stop conditions: rev limiter, time limit, 0.5 s of sustained knock, hydrolock, structural failure
        if (dyno.state.rpm >= maxRpm) finished = true;
        else if (dyno.elapsedSeconds > dyno.maxDuration) finished = true;
        else if (dyno.knockSince != null && dyno.elapsedSeconds - dyno.knockSince > 0.5) finished = true;
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
      { label: "SF", value: latest.weakestLinkSf.toFixed(2) + "×", color: latest.weakestLinkSf < 1.0 ? "#c41e3a" : "#3ddc84" }
    ];

    dyno.statusDiv.innerHTML = statusItems.map(item => {
      const div = document.createElement("div");
      div.innerHTML = `<div style="font-size: 10px; color: #aaa;">${item.label}</div><div style="font-size: 13px; font-weight: bold; color: ${item.color || '#3ddc84'};">${item.value}</div>`;
      return div.outerHTML;
    }).join("");
  }

  function _drawDynoChart(dyno) {
    const canvas = dyno.canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (dyno.history.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    const margin = 40;
    const graphW = w - margin * 2;
    const graphH = h - margin * 2;

    // Background grid
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = margin + (i / 10) * graphW;
      const y = margin + (i / 10) * graphH;
      ctx.beginPath();
      ctx.moveTo(x, margin);
      ctx.lineTo(x, margin + graphH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + graphW, y);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, margin + graphH);
    ctx.lineTo(margin + graphW, margin + graphH);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#aaa";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Time (s)", margin + graphW / 2, h - 8);
    ctx.save();
    ctx.translate(12, margin + graphH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Power (hp)", 0, 0);
    ctx.restore();

    // Find max power for scaling
    let maxPower = Math.max(...dyno.history.map(h => h.power)) * 1.1;
    let maxTime = dyno.history[dyno.history.length - 1].t;

    // Draw power curve
    ctx.strokeStyle = "#FF6B35";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < dyno.history.length; i++) {
      const point = dyno.history[i];
      const x = margin + (point.t / maxTime) * graphW;
      const y = margin + graphH - (point.power / maxPower) * graphH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw torque curve
    ctx.strokeStyle = "#3ddc84";
    ctx.lineWidth = 2;
    let maxTorque = Math.max(...dyno.history.map(h => h.torque)) * 1.1;
    ctx.beginPath();
    for (let i = 0; i < dyno.history.length; i++) {
      const point = dyno.history[i];
      const x = margin + (point.t / maxTime) * graphW;
      const y = margin + graphH - (point.torque / maxTorque) * graphH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend
    ctx.fillStyle = "#FF6B35";
    ctx.fillRect(w - 140, 12, 8, 8);
    ctx.fillStyle = "#fff";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Power (hp)", w - 128, 18);

    ctx.fillStyle = "#3ddc84";
    ctx.fillRect(w - 140, 28, 8, 8);
    ctx.fillStyle = "#fff";
    ctx.fillText("Torque (Nm)", w - 128, 34);
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
      { label: "Peak Power", value: dyno.peakPower.toFixed(0) + " hp" },
      { label: "Peak Torque", value: dyno.peakTorque.toFixed(0) + " Nm" },
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
