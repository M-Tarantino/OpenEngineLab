/* OpenEngineLab :: js/ui.js — State, Eingaben, Worker-Anbindung, Diszipline-Module */
(function () {
  "use strict";

  const HISTORY_LEN = 480;
  const T = (k, v) => OEL.I18N.t(k, v);
  const COMP_KEYS = { rod: "compRod", headBolt: "compHeadBolt", pistonPin: "compPistonPin" };
  const componentLabel = (id) => T(COMP_KEYS[id] || id);

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function ce(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function stats(arr) {
    if (!arr.length) return { min: 0, max: 0, mean: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of arr) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, mean: sum / arr.length };
  }

  // ---------------------------------------------------------------- Steppers/Sliders
  function createStepper(opts) {
    const wrap = ce("div", "field");
    const label = ce("label"); label.textContent = opts.label;
    const row = ce("div", "stepper");
    const dec = ce("button", "stepper-btn"); dec.type = "button"; dec.textContent = "−";
    const input = ce("input", "stepper-input");
    input.type = "number"; input.step = opts.step || 0.1;
    input.min = opts.min; input.max = opts.max; input.value = opts.value;
    const inc = ce("button", "stepper-btn"); inc.type = "button"; inc.textContent = "+";
    const unit = ce("span", "unit"); unit.textContent = opts.unit || "";
    row.appendChild(dec); row.appendChild(input); row.appendChild(inc); row.appendChild(unit);
    wrap.appendChild(label); wrap.appendChild(row);
    function fire(v) {
      v = Math.max(opts.min, Math.min(opts.max, v));
      input.value = v;
      opts.onChange(v);
    }
    dec.addEventListener("click", () => fire(parseFloat(input.value) - (opts.step || 0.1)));
    inc.addEventListener("click", () => fire(parseFloat(input.value) + (opts.step || 0.1)));
    input.addEventListener("change", () => fire(parseFloat(input.value)));
    return wrap;
  }

  function createSlider(opts) {
    const wrap = ce("div", "field");
    const label = ce("label");
    const valSpan = ce("span", "slider-val");
    valSpan.textContent = opts.format ? opts.format(opts.value) : opts.value;
    label.textContent = opts.label + " ";
    label.appendChild(valSpan);
    const input = ce("input", "slider-input");
    input.type = "range"; input.min = opts.min; input.max = opts.max; input.step = opts.step || 1;
    input.value = opts.value;
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      valSpan.textContent = opts.format ? opts.format(v) : v;
      opts.onChange(v);
    });
    wrap.appendChild(label); wrap.appendChild(input);
    wrap._input = input;
    return wrap;
  }

  function createToggle(opts) {
    const btn = ce("button", "toggle-btn");
    btn.type = "button";
    btn.textContent = opts.label;
    btn.addEventListener("click", () => opts.onToggle(btn));
    return btn;
  }

  // ---------------------------------------------------------------- Undo/Redo
  function snapshotParams(app) {
    return {
      geometry: Object.assign({}, app.profiles.engine.geometry),
      boostTargetBar: app.controls.boostTargetBar,
      activeFuelId: app.controls.activeFuelId
    };
  }
  function applySnapshot(app, snap) {
    Object.assign(app.profiles.engine.geometry, snap.geometry);
    app.controls.boostTargetBar = snap.boostTargetBar;
    app.controls.activeFuelId = snap.activeFuelId;
    const fuel = app.profiles.fuels.find(f => f.id === snap.activeFuelId);
    app.worker.postMessage({ type: "patch", target: "geometry", data: snap.geometry });
    if (fuel) app.worker.postMessage({ type: "patch", target: "fuel", data: fuel });
    rebuildSchematic(app);
    buildLeftPanel(app, qs("#left-panel"));
  }
  function pushUndo(app) {
    app.undo.stack.push(snapshotParams(app));
    if (app.undo.stack.length > 40) app.undo.stack.shift();
    app.undo.redoStack.length = 0;
    updateUndoRedoButtons(app);
  }
  function doUndo(app) {
    if (!app.undo.stack.length) return;
    app.undo.redoStack.push(snapshotParams(app));
    applySnapshot(app, app.undo.stack.pop());
    updateUndoRedoButtons(app);
  }
  function doRedo(app) {
    if (!app.undo.redoStack.length) return;
    app.undo.stack.push(snapshotParams(app));
    applySnapshot(app, app.undo.redoStack.pop());
    updateUndoRedoButtons(app);
  }
  function updateUndoRedoButtons(app) {
    qs("#undo-btn").disabled = app.undo.stack.length === 0;
    qs("#redo-btn").disabled = app.undo.redoStack.length === 0;
  }

  // ---------------------------------------------------------------- Left panel
  function buildLeftPanel(app, root) {
    root.innerHTML = "";
    const h = ce("h2"); h.textContent = T("inputs"); root.appendChild(h);

    const engSection = ce("div", "panel-section");
    const engTitle = ce("h3"); engTitle.textContent = app.profiles.engine.name; engSection.appendChild(engTitle);
    const geo = app.profiles.engine.geometry;

    function geometryStepper(label, field, min, max, step, unit) {
      return createStepper({
        label, value: geo[field], min, max, step, unit,
        onChange: v => {
          pushUndo(app);
          geo[field] = v;
          if (field === "boreMM" || field === "strokeMM") {
            geo.displacementCC = displacementFromGeometry(app.profiles.engine);
          }
          app.worker.postMessage({ type: "patch", target: "geometry", data: geo });
          rebuildSchematic(app);
        }
      });
    }
    engSection.appendChild(geometryStepper(T("bore"), "boreMM", 40, 130, 0.1, "mm"));
    engSection.appendChild(geometryStepper(T("stroke"), "strokeMM", 30, 130, 0.1, "mm"));
    engSection.appendChild(geometryStepper(T("rodLength"), "rodLengthMM", 80, 220, 0.1, "mm"));
    engSection.appendChild(geometryStepper(T("compressionRatio"), "compressionRatio", 6, 15, 0.1, ":1"));
    engSection.appendChild(createStepper({
      label: T("boostTarget"), value: app.controls.boostTargetBar, min: 0, max: app.profiles.turbo.limits.maxBoostBar,
      step: 0.05, unit: "bar",
      onChange: v => { pushUndo(app); app.controls.boostTargetBar = v; }
    }));
    root.appendChild(engSection);

    const fuelSection = ce("div", "panel-section");
    const fuelLabel = ce("label"); fuelLabel.textContent = T("fuel");
    const fuelSelect = ce("select");
    for (const f of app.profiles.fuels) {
      const o = ce("option"); o.value = f.id; o.textContent = f.name;
      if (f.id === app.controls.activeFuelId) o.selected = true;
      fuelSelect.appendChild(o);
    }
    fuelSelect.addEventListener("change", () => {
      pushUndo(app);
      app.controls.activeFuelId = fuelSelect.value;
      const fuel = app.profiles.fuels.find(f => f.id === fuelSelect.value);
      app.worker.postMessage({ type: "patch", target: "fuel", data: fuel });
    });
    fuelSection.appendChild(fuelLabel); fuelSection.appendChild(fuelSelect);
    root.appendChild(fuelSection);

    const sliderSection = ce("div", "panel-section");
    const sTitle = ce("h3"); sTitle.textContent = T("transientParams"); sliderSection.appendChild(sTitle);
    sliderSection.appendChild(createSlider({
      label: T("throttle"), value: app.controls.throttle01 * 100, min: 0, max: 100, step: 1,
      format: v => v.toFixed(0) + " %",
      onChange: v => { app.controls.throttle01 = v / 100; }
    }));
    sliderSection.appendChild(createSlider({
      label: T("ambientTemp"), value: app.controls.ambientC, min: -40, max: 60, step: 1,
      format: v => v.toFixed(0) + " °C",
      onChange: v => { app.controls.ambientC = v; }
    }));
    if (app.panels.altitude) {
      sliderSection.appendChild(createSlider({
        label: T("altitude"), value: app.controls.altitudeM, min: 0, max: 4500, step: 50,
        format: v => v.toFixed(0) + " m",
        onChange: v => {
          app.controls.altitudeM = v;
          app.controls.baroBar = OEL.Engine.baroAtAltitude(1.01325, v);
        }
      }));
    } else {
      sliderSection.appendChild(createSlider({
        label: T("airPressure"), value: app.controls.baroBar, min: 0.6, max: 1.1, step: 0.01,
        format: v => v.toFixed(2) + " bar",
        onChange: v => { app.controls.baroBar = v; }
      }));
    }
    root.appendChild(sliderSection);

    if (app.panels.hybrid) root.appendChild(buildHybridPanel(app));
    if (app.panels.nitrous) root.appendChild(buildNitrousPanel(app));
    if (app.panels.als) root.appendChild(buildAlsPanel(app));
    if (app.profiles.drivetrain) root.appendChild(buildDrivetrainPanel(app));
    if (app.track.profile) root.appendChild(buildTrackPanel(app));

    const ioSection = ce("div", "panel-section");
    const ioTitle = ce("h3"); ioTitle.textContent = T("importSection"); ioSection.appendChild(ioTitle);
    const fileInput = ce("input"); fileInput.type = "file"; fileInput.accept = ".json";
    fileInput.addEventListener("change", () => handleImport(app, fileInput.files[0]));
    ioSection.appendChild(fileInput);
    const hint = ce("p", "hint"); hint.textContent = T("importHint");
    ioSection.appendChild(hint);
    root.appendChild(ioSection);

    updateUndoRedoButtons(app);
  }

  function displacementFromGeometry(engine) {
    const g = engine.geometry;
    const cylVolCC = (Math.PI / 4) * Math.pow(g.boreMM / 10, 2) * (g.strokeMM / 10);
    return Math.round(cylVolCC * engine.cylinders);
  }

  // ---------------------------------------------------------------- Diszipline-Panels
  function buildDrivetrainPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("drivetrain"); sec.appendChild(title);

    const gearRow = ce("div", "field");
    const gearLabel = ce("label"); gearLabel.textContent = T("gear"); gearRow.appendChild(gearLabel);
    const row = ce("div", "gear-row");
    const dec = ce("button"); dec.type = "button"; dec.textContent = "−";
    const disp = ce("span", "gear-display");
    const inc = ce("button"); inc.type = "button"; inc.textContent = "+";
    function refresh() { disp.textContent = app.controls.gear === 0 ? T("neutral") : String(app.controls.gear); }
    dec.addEventListener("click", () => { app.controls.gear = Math.max(0, app.controls.gear - 1); refresh(); });
    inc.addEventListener("click", () => {
      const maxGear = app.profiles.drivetrain.gearRatios.length;
      app.controls.gear = Math.min(maxGear, app.controls.gear + 1); refresh();
    });
    refresh();
    row.appendChild(dec); row.appendChild(disp); row.appendChild(inc);
    gearRow.appendChild(row);
    sec.appendChild(gearRow);

    sec.appendChild(createSlider({
      label: T("grade"), value: app.controls.gradePercent, min: -15, max: 20, step: 1,
      format: v => v.toFixed(0) + " %",
      onChange: v => { app.controls.gradePercent = v; }
    }));
    sec.appendChild(createSlider({
      label: T("brake"), value: app.controls.brake01 * 100, min: 0, max: 100, step: 1,
      format: v => v.toFixed(0) + " %",
      onChange: v => { app.controls.brake01 = v / 100; }
    }));
    return sec;
  }

  function buildTrackPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("track") + ": " + app.track.profile.name; sec.appendChild(title);
    const ctrls = ce("div", "track-controls");
    const playBtn = ce("button"); playBtn.textContent = T("trackPlay");
    const pauseBtn = ce("button"); pauseBtn.textContent = T("trackPause");
    const stopBtn = ce("button"); stopBtn.textContent = T("trackStop");
    playBtn.addEventListener("click", () => OEL.Track.play(app.track.player));
    pauseBtn.addEventListener("click", () => OEL.Track.pause(app.track.player));
    stopBtn.addEventListener("click", () => OEL.Track.stop(app.track.player));
    ctrls.appendChild(playBtn); ctrls.appendChild(pauseBtn); ctrls.appendChild(stopBtn);
    sec.appendChild(ctrls);
    const progress = ce("div", "track-progress");
    const fill = ce("div", "track-progress-fill"); fill.style.width = "0%";
    progress.appendChild(fill);
    sec.appendChild(progress);
    const note = ce("div", "track-note");
    sec.appendChild(note);
    sec._progressFill = fill; sec._note = note;
    app.trackPanelEl = sec;
    return sec;
  }

  function buildHybridPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("hybridPanel"); sec.appendChild(title);
    if (app.profiles.hybrid.hasMguH) {
      const p = ce("p", "hint"); p.textContent = T("mguhActive"); sec.appendChild(p);
    }
    sec.appendChild(createSlider({
      label: T("ersDeploy"), value: app.controls.hybridDeployPct, min: -100, max: 100, step: 1,
      format: v => v.toFixed(0) + " %",
      onChange: v => { app.controls.hybridDeployPct = v; }
    }));
    const gaugeLabel = ce("div", "gauge-label");
    const gl1 = ce("span"); gl1.textContent = T("batterySoC");
    const gl2 = ce("span"); gl2.id = "battery-soc-value"; gl2.textContent = "—";
    gaugeLabel.appendChild(gl1); gaugeLabel.appendChild(gl2);
    const bar = ce("div", "gauge-bar");
    const fill = ce("div", "gauge-fill"); fill.id = "battery-soc-fill"; fill.style.width = "50%";
    bar.appendChild(fill);
    sec.appendChild(gaugeLabel); sec.appendChild(bar);
    return sec;
  }

  function buildNitrousPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("nitrousPanel"); sec.appendChild(title);
    const btn = createToggle({
      label: T("nitrousArm"),
      onToggle: (b) => {
        app.controls.nitrousArmed = !app.controls.nitrousArmed;
        b.classList.toggle("armed", app.controls.nitrousArmed);
        b.textContent = app.controls.nitrousArmed ? T("nitrousActive") : T("nitrousArm");
      }
    });
    sec.appendChild(btn);
    const gaugeLabel = ce("div", "gauge-label");
    const gl1 = ce("span"); gl1.textContent = T("nitrousBottle");
    const gl2 = ce("span"); gl2.id = "nitrous-bottle-value"; gl2.textContent = "—";
    gaugeLabel.appendChild(gl1); gaugeLabel.appendChild(gl2);
    const bar = ce("div", "gauge-bar");
    const fill = ce("div", "gauge-fill"); fill.id = "nitrous-bottle-fill"; fill.style.width = "100%";
    bar.appendChild(fill);
    sec.appendChild(gaugeLabel); sec.appendChild(bar);
    return sec;
  }

  function buildAlsPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("alsPanel"); sec.appendChild(title);
    const btn = createToggle({
      label: T("alsEnable"),
      onToggle: (b) => {
        app.controls.alsActive = !app.controls.alsActive;
        b.classList.toggle("armed", app.controls.alsActive);
      }
    });
    sec.appendChild(btn);
    return sec;
  }

  function updateDisciplinePanelsLive(app, result) {
    if (app.panels.hybrid && result.batterySoC != null) {
      const pct = (result.batterySoC * 100).toFixed(0) + "%";
      const v = qs("#battery-soc-value"); if (v) v.textContent = pct;
      const f = qs("#battery-soc-fill"); if (f) { f.style.width = pct; f.classList.toggle("low", result.batterySoC < 0.15); }
    }
    if (app.panels.nitrous && app.profiles.nitrous) {
      const pct = (result.nitrousRemainingKg / app.profiles.nitrous.bottleCapacityKg) * 100;
      const v = qs("#nitrous-bottle-value"); if (v) v.textContent = pct.toFixed(0) + "%";
      const f = qs("#nitrous-bottle-fill"); if (f) { f.style.width = pct + "%"; f.classList.toggle("low", pct < 15); }
    }
    if (app.profiles.drivetrain) {
      const el = qs("#status-drivetrain");
      if (el) {
        const spin = result.wheelSlipping ? ` ⚠ ${T("wheelspin")}` : "";
        el.textContent = `${T("gear")} ${app.controls.gear || T("neutral")} | ${(result.vehicleSpeedMS * 3.6).toFixed(0)} km/h${spin}`;
        el.classList.toggle("warn", !!result.wheelSlipping);
      }
    }
    if (app.trackPanelEl && app.track.player) {
      const st = OEL.Track.currentState(app.track.player);
      app.trackPanelEl._progressFill.style.width = (st.progress01 * 100).toFixed(1) + "%";
      app.trackPanelEl._note.textContent = st.note || "";
    }
  }

  // ---------------------------------------------------------------- Import
  function handleImport(app, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.geometry && data.materials && data.cylinders) {
          app.profiles.engine = data;
          app.worker.postMessage({ type: "importProfile", kind: "engine", data });
          rebuildSchematic(app);
          buildLeftPanel(app, qs("#left-panel"));
        } else if (data.limits && data.compressor) {
          app.profiles.turbo = data;
          app.worker.postMessage({ type: "importProfile", kind: "turbo", data });
        } else if (data.fuels) {
          app.profiles.fuels = data.fuels;
          buildLeftPanel(app, qs("#left-panel"));
        }
      } catch (e) { /* ungültige Datei — ignorieren */ }
    };
    reader.readAsText(file);
  }

  function rebuildSchematic(app) {
    app.render.handle = OEL.Renderer.buildSchematic(qs("#schematic-container"), app.profiles.engine);
    attachTooltip(app);
  }

  function attachTooltip(app) {
    const container = qs("#schematic-container");
    const tip = qs("#tooltip");
    container.onmousemove = (e) => {
      const t = e.target.getAttribute && e.target.getAttribute("data-tooltip");
      if (t) {
        tip.textContent = t; tip.style.display = "block";
        tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 10) + "px";
      } else { tip.style.display = "none"; }
    };
    container.onmouseleave = () => { tip.style.display = "none"; };
  }

  // ---------------------------------------------------------------- Charts
  function initCharts(app) {
    const axisOpts = { stroke: "#7C8894", grid: { stroke: "rgba(122,136,148,0.15)" } };
    app.chartA = new uPlot({
      width: qs("#chart-a").clientWidth || 300, height: 150,
      scales: { rpm: {}, boost: {} },
      series: [{}, { label: T("rpmUnit"), stroke: "#3DDC97", width: 1.5, scale: "rpm" },
        { label: "Boost (bar)", stroke: "#4A9EFF", width: 1.5, scale: "boost" }],
      axes: [Object.assign({}, axisOpts), Object.assign({ scale: "rpm" }, axisOpts), Object.assign({ scale: "boost", side: 1 }, axisOpts)]
    }, [[0], [0], [0]], qs("#chart-a"));

    app.chartB = new uPlot({
      width: qs("#chart-b").clientWidth || 300, height: 150,
      scales: { temp: {}, press: {} },
      series: [{}, { label: "Öl (°C)", stroke: "#FFB627", width: 1.5, scale: "temp" },
        { label: "Zyl. (bar)", stroke: "#FF6B1A", width: 1.5, scale: "press" }],
      axes: [Object.assign({}, axisOpts), Object.assign({ scale: "temp" }, axisOpts), Object.assign({ scale: "press", side: 1 }, axisOpts)]
    }, [[0], [0], [0]], qs("#chart-b"));
  }
  function updateCharts(app) {
    const h = app.history;
    if (h.t.length < 2) return;
    app.chartA.setData([h.t, h.rpm, h.boost]);
    app.chartB.setData([h.t, h.oilTemp, h.cylPressure]);
  }
  function updateStats(app) {
    const h = app.history;
    const rpmS = stats(h.rpm), oilS = stats(h.oilTemp), pS = stats(h.cylPressure);
    qs("#stats-panel").innerHTML =
      row(T("rpmUnit"), rpmS, "") + row("Öl", oilS, "°C") + row("Zyl.-Druck", pS, "bar");
    function row(label, st, unit) {
      return `<div class="stat-row"><span>${label}</span><span>${st.min.toFixed(0)} / ${st.mean.toFixed(0)} / ${st.max.toFixed(0)} ${unit}</span></div>`;
    }
  }
  function pushHistory(app, r) {
    const h = app.history;
    h.t.push(r.time); h.rpm.push(r.rpm); h.boost.push(r.boostBar);
    h.oilTemp.push(r.oilTempC); h.cylPressure.push(r.cylinderPressureBar);
    if (h.t.length > HISTORY_LEN) { h.t.shift(); h.rpm.shift(); h.boost.shift(); h.oilTemp.shift(); h.cylPressure.shift(); }
  }

  // ---------------------------------------------------------------- Status bar
  function updateStatusBar(app, result) {
    qs("#status-state").textContent = app.running ? T("running") : T("stopped");
    qs("#status-state").className = app.running ? "ok" : "warn";
    qs("#status-time").textContent = `t=${result.time.toFixed(1)}s | Zyklen ${result.cycles.toFixed(0)}`;
    const w = result.weakestLink;
    const wEl = qs("#status-weakest");
    wEl.textContent = `${T("weakestLink")}: ${componentLabel(w.id)} @ SF ${w.sf.toFixed(2)}`;
    wEl.className = w.sf < 1.0 ? "critical" : (w.sf < 1.43 ? "warn" : "ok");
    const advisory = qs("#status-advisory");
    const ecmOut = app.lastEcmOut || {};
    if (result.knockDetected) { advisory.textContent = T("knockWarning"); advisory.className = "warn"; }
    else if (!result.oilFilmOK) { advisory.textContent = T("oilFilmWarning"); advisory.className = "critical"; }
    else if (ecmOut.overrunActive) { advisory.textContent = T("overrunActive"); advisory.className = ""; }
    else if (ecmOut.alsFiring) { advisory.textContent = T("alsFiring"); advisory.className = "ok"; }
    else { advisory.textContent = ""; advisory.className = ""; }

    const banner = qs("#hydrolock-banner");
    if (result.hydrolockFailure) {
      banner.style.display = "flex";
      banner.querySelector(".hydrolock-text").textContent = T("hydrolockBanner");
      banner.querySelector("#rebuild-engine-btn").textContent = T("rebuildEngine");
    } else {
      banner.style.display = "none";
    }
  }

  function updateKennfield(app) {
    if (app.view !== "kennfield" || !app.lastResult || !app.lastEcmOut) return;
    const canvas = qs("#kennfield-canvas");
    const which = qs("#kennfield-select").value;
    const rpm = app.lastResult.rpm, load = app.lastEcmOut.loadPercent;
    if (which === "ignition") {
      OEL.Renderer.drawKennfield(canvas, OEL.ECM.IGN_MAP, OEL.ECM.IGN_RPM_AXIS, OEL.ECM.IGN_LOAD_AXIS, { rpm, load }, T("kennfieldIgnition"));
    } else {
      OEL.Renderer.drawKennfield(canvas, OEL.ECM.FUEL_MAP, OEL.ECM.FUEL_RPM_AXIS, OEL.ECM.FUEL_LOAD_AXIS, { rpm, load }, T("kennfieldFuel"));
    }
  }

  // ---------------------------------------------------------------- Worker
  function createWorker(app) {
    app.worker = new Worker("js/worker.js");
    app.worker.onmessage = (e) => {
      if (e.data.type === "tick") {
        app.lastResult = e.data.result;
        app.lastEcmOut = e.data.ecmOut;
        pushHistory(app, e.data.result);
      }
    };
  }

  function sendControls(app) {
    app.worker.postMessage({
      type: "controls",
      controls: {
        throttle01: app.controls.throttle01, ambientC: app.controls.ambientC, baroBar: app.controls.baroBar,
        boostTargetBar: app.controls.boostTargetBar, alsActive: app.controls.alsActive,
        nitrousArmed: app.controls.nitrousArmed,
        hybridDeployKw: app.profiles.hybrid ? (app.profiles.hybrid.maxDeployKw * app.controls.hybridDeployPct / 100) : 0,
        drivetrain: app.profiles.drivetrain
          ? { gear: app.controls.gear, gradePercent: app.controls.gradePercent, brake01: app.controls.brake01 }
          : null
      }
    });
  }

  // ---------------------------------------------------------------- Diszipline
  async function fetchJson(path) { return fetch(path).then(r => r.json()); }

  async function setDiscipline(app, id) {
    const cfg = OEL.Disciplines.get(id);
    app.discipline = id;
    app.panels = cfg.panels || {};

    const extras = {};
    if (cfg.hybridProfilePath) extras.hybridProfile = await fetchJson(cfg.hybridProfilePath);
    if (cfg.nitrousProfilePath) extras.nitrousProfile = await fetchJson(cfg.nitrousProfilePath);
    if (cfg.drivetrainProfilePath) extras.drivetrainProfile = await fetchJson(cfg.drivetrainProfilePath);
    app.profiles.hybrid = extras.hybridProfile || null;
    app.profiles.nitrous = extras.nitrousProfile || null;
    app.profiles.drivetrain = extras.drivetrainProfile || null;

    app.controls.gear = cfg.driveMode === "vehicle" ? 1 : 0;
    app.controls.gradePercent = 0; app.controls.brake01 = 0;
    app.controls.nitrousArmed = false; app.controls.alsActive = false;
    app.controls.hybridDeployPct = 0; app.controls.altitudeM = 0;

    if (cfg.trackProfilePath) {
      const trackData = await fetchJson(cfg.trackProfilePath);
      app.track.profile = trackData;
      app.track.player = OEL.Track.createPlayer(trackData);
    } else {
      app.track.profile = null; app.track.player = null;
    }
    app.trackPanelEl = null;

    app.worker.postMessage({ type: "setDiscipline", extras });
    app.history = { t: [], rpm: [], boost: [], oilTemp: [], cylPressure: [] };
    app.lastResult = null; app.lastEcmOut = null;
    buildLeftPanel(app, qs("#left-panel"));
  }

  function populateDisciplineSelect(app) {
    const sel = qs("#discipline-select");
    sel.innerHTML = "";
    for (const id of OEL.Disciplines.list) {
      const cfg = OEL.Disciplines.get(id);
      const o = ce("option"); o.value = id; o.textContent = T(cfg.labelKey);
      sel.appendChild(o);
    }
    sel.value = app.discipline;
    sel.onchange = () => setDiscipline(app, sel.value);
  }

  // ---------------------------------------------------------------- Sprache
  function relabelStaticUI(app) {
    qs("#tab-schematic").textContent = T("tabSchematic");
    qs("#tab-kennfield").textContent = T("tabKennfield");
    qs("#estop").textContent = T("estop");
    qs("#undo-btn").title = T("undo");
    qs("#redo-btn").title = T("redo");
    qs("#report-btn").title = T("report");
    const opts = qs("#kennfield-select").options;
    opts[0].textContent = T("kennfieldIgnition"); opts[1].textContent = T("kennfieldFuel");
    qs(".sidebar-right h2").textContent = T("telemetry");
    qs(".sidebar-right h3").textContent = T("stats");
    populateDisciplineSelect(app);
  }

  function setLanguage(app, lang) {
    OEL.I18N.setLang(lang);
    relabelStaticUI(app);
    buildLeftPanel(app, qs("#left-panel"));
  }

  // ---------------------------------------------------------------- Report
  function wireTopbar(app) {
    qs("#tab-schematic").addEventListener("click", () => setView(app, "schematic"));
    qs("#tab-kennfield").addEventListener("click", () => setView(app, "kennfield"));
    qs("#estop").addEventListener("click", () => {
      app.controls.throttle01 = 0; app.controls.boostTargetBar = 0;
      sendControls(app);
      app.running = false;
      app.worker.postMessage({ type: "setRunning", running: false });
      setTimeout(() => {
        app.running = true;
        app.worker.postMessage({ type: "setRunning", running: true });
      }, 600);
    });
    qs("#undo-btn").addEventListener("click", () => doUndo(app));
    qs("#redo-btn").addEventListener("click", () => doRedo(app));
    qs("#report-btn").addEventListener("click", () => OEL.Report.generate(app));
    qs("#rebuild-engine-btn").addEventListener("click", () => {
      app.controls.nitrousArmed = false;
      app.controls.throttle01 = 0.1;
      const throttleSlider = qs(".sidebar-left input[type=range]");
      if (throttleSlider) { throttleSlider.value = 10; throttleSlider.dispatchEvent(new Event("input")); }
      const nosBtn = [...document.querySelectorAll("#left-panel button")].find(b => b.classList.contains("armed"));
      if (nosBtn) { nosBtn.classList.remove("armed"); nosBtn.textContent = T("nitrousArm"); }
      app.worker.postMessage({ type: "resetFailure" });
    });
    qs("#lang-select").value = OEL.I18N.current;
    qs("#lang-select").addEventListener("change", (e) => setLanguage(app, e.target.value));
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(app); }
      else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); doRedo(app); }
    });
  }

  function setView(app, view) {
    app.view = view;
    qs("#schematic-container").style.display = view === "schematic" ? "block" : "none";
    qs("#kennfield-view").style.display = view === "kennfield" ? "block" : "none";
    qs("#tab-schematic").classList.toggle("active", view === "schematic");
    qs("#tab-kennfield").classList.toggle("active", view === "kennfield");
  }

  // ---------------------------------------------------------------- Render-Loop
  function renderLoop(app, nowMs) {
    if (app.lastFrameMs == null) app.lastFrameMs = nowMs;
    let dt = (nowMs - app.lastFrameMs) / 1000;
    app.lastFrameMs = nowMs;
    dt = Math.min(0.1, Math.max(0, dt));

    if (app.track.player && app.track.player.playing) {
      const st = OEL.Track.advance(app.track.player, dt);
      app.controls.throttle01 = st.throttle01;
      app.controls.gear = st.gear;
      app.controls.gradePercent = st.gradePercent;
      app.controls.brake01 = st.brake01;
    }

    if (app.running) sendControls(app);

    if (app.lastResult) {
      const result = app.lastResult;
      app.render.thetaRad = (app.render.thetaRad + (result.rpm * 2 * Math.PI / 60) * dt) % (2 * Math.PI);
      OEL.Renderer.updateCrankAngle(app.render.handle, app.render.thetaRad);
      OEL.Renderer.applyStressState(app.render.handle, result.components, {
        rod: componentLabel("rod"), headBolt: componentLabel("headBolt"), pistonPin: componentLabel("pistonPin")
      });
      updateCharts(app);
      updateStats(app);
      updateStatusBar(app, result);
      updateKennfield(app);
      updateDisciplinePanelsLive(app, result);
    }
    requestAnimationFrame((t) => renderLoop(app, t));
  }

  // ---------------------------------------------------------------- Init
  async function init() {
    const [engine, turbo, fuelDb] = await Promise.all([
      fetchJson("data/engines/vr38dett.json"),
      fetchJson("data/parts/turbos/garrett-g35.json"),
      fetchJson("data/fuels/pump-fuels.json")
    ]);

    const app = {
      profiles: { engine: deepClone(engine), turbo: deepClone(turbo), fuels: fuelDb.fuels, hybrid: null, nitrous: null, drivetrain: null },
      controls: {
        throttle01: 0.15, ambientC: 20, baroBar: 1.0, boostTargetBar: 0, activeFuelId: fuelDb.fuels[1].id,
        altitudeM: 0, alsActive: false, nitrousArmed: false, hybridDeployPct: 0, gear: 0, gradePercent: 0, brake01: 0
      },
      discipline: "standard", panels: {},
      history: { t: [], rpm: [], boost: [], oilTemp: [], cylPressure: [] },
      render: { handle: null, thetaRad: 0 },
      track: { profile: null, player: null }, trackPanelEl: null,
      undo: { stack: [], redoStack: [] },
      view: "schematic", running: true, lastFrameMs: null,
      lastResult: null, lastEcmOut: null
    };
    window.OEL_APP = app;

    createWorker(app);
    app.worker.postMessage({
      type: "init", engine: app.profiles.engine, turbo: app.profiles.turbo,
      fuel: app.profiles.fuels.find(f => f.id === app.controls.activeFuelId), extras: {}
    });

    populateDisciplineSelect(app);
    buildLeftPanel(app, qs("#left-panel"));
    rebuildSchematic(app);
    wireTopbar(app);
    initCharts(app);
    setView(app, "schematic");
    relabelStaticUI(app);
    requestAnimationFrame((t) => renderLoop(app, t));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
