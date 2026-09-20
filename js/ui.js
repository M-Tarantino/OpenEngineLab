/* OpenEngineLab :: js/ui.js — state, inputs, worker bridge, discipline modules */
(function () {
  "use strict";

  const HISTORY_LEN = 480;
  const T = (k, v) => OEL.I18N.t(k, v);
  const COMP_KEYS = { rod: "compRod", headBolt: "compHeadBolt", pistonPin: "compPistonPin", cylinderHead: "compCylinderHead", block: "compBlock" };
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
      engineBase: deepClone(app.profiles.engineBase),
      turbo: deepClone(app.profiles.turbo),
      mods: deepClone(app.mods),
      boostTargetBar: app.controls.boostTargetBar,
      activeFuelId: app.controls.activeFuelId
    };
  }
  function applySnapshot(app, snap) {
    app.profiles.engineBase = snap.engineBase;
    app.profiles.turbo = snap.turbo;
    app.mods = snap.mods;
    app.controls.boostTargetBar = Math.min(snap.boostTargetBar, app.profiles.turbo.limits.maxBoostBar);
    app.controls.activeFuelId = snap.activeFuelId;
    const fuel = app.profiles.fuels.find(f => f.id === snap.activeFuelId);
    if (fuel) app.worker.postMessage({ type: "patch", target: "fuel", data: fuel });
    app.worker.postMessage({ type: "importProfile", kind: "turbo", data: app.profiles.turbo });
    applyEngineWithMods(app);
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

  // ---------------------------------------------------------------- Engine catalog & mods (Extension 1)
  function ensureBaseStock(engineBase) {
    if (!engineBase.baseStock) {
      engineBase.baseStock = {
        boreMm: engineBase.geometry.boreMM, strokeMm: engineBase.geometry.strokeMM,
        compressionRatio: engineBase.geometry.compressionRatio, maxRpm: engineBase.redlineRPM,
        rotatingMassKg: 25, parasiticLossHp: 15
      };
    }
    return engineBase;
  }

  function applyEngineWithMods(app) {
    ensureBaseStock(app.profiles.engineBase);
    const resolved = OEL.Mods.resolveEngineConfiguration(
      app.profiles.engineBase, app.mods.active, app.mods.variants, app.modsLibrary
    );
    const engineProfile = deepClone(app.profiles.engineBase);
    OEL.Mods.applyResolvedConfig(engineProfile, resolved);
    app.profiles.engine = engineProfile;
    app.lastResolvedMods = resolved;
    app.worker.postMessage({ type: "importProfile", kind: "engine", data: engineProfile });
    rebuildSchematic(app);
    buildLeftPanel(app, qs("#left-panel"));
  }

  async function selectEngine(app, engineId) {
    const entry = app.catalogs.engines.find(e => e.id === engineId);
    if (!entry) return;
    pushUndo(app);
    const data = await fetchJson(entry.file);
    app.profiles.engineBase = data;
    app.mods = { active: [], variants: {} };
    applyEngineWithMods(app);
  }

  async function selectCharger(app, chargerId) {
    const entry = app.catalogs.chargers.find(c => c.id === chargerId);
    if (!entry) return;
    pushUndo(app);
    const data = await fetchJson(entry.file);
    app.profiles.turbo = data;
    app.controls.boostTargetBar = Math.min(app.controls.boostTargetBar, data.limits.maxBoostBar);
    app.worker.postMessage({ type: "importProfile", kind: "turbo", data });
    buildLeftPanel(app, qs("#left-panel"));
  }

  function toggleMod(app, modId, enabled) {
    pushUndo(app);
    if (enabled) {
      if (!app.mods.active.includes(modId)) app.mods.active.push(modId);
    } else {
      app.mods.active = app.mods.active.filter(m => m !== modId);
      delete app.mods.variants[modId];
    }
    applyEngineWithMods(app);
  }

  function setModVariant(app, modId, variantKey) {
    pushUndo(app);
    if (variantKey) app.mods.variants[modId] = variantKey;
    else delete app.mods.variants[modId];
    applyEngineWithMods(app);
  }

  function buildEngineCatalogPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = app.profiles.engine.name; sec.appendChild(title);

    const engineRow = ce("div", "field");
    const engineLabel = ce("label"); engineLabel.textContent = T("engineCatalog"); engineRow.appendChild(engineLabel);
    const engineSelect = ce("select");
    for (const entry of app.catalogs.engines) {
      const o = ce("option"); o.value = entry.id; o.textContent = entry.name;
      if (entry.id === app.profiles.engineBase.id) o.selected = true;
      engineSelect.appendChild(o);
    }
    engineSelect.addEventListener("change", () => selectEngine(app, engineSelect.value));
    engineRow.appendChild(engineSelect);
    sec.appendChild(engineRow);

    const chargerRow = ce("div", "field");
    const chargerLabel = ce("label"); chargerLabel.textContent = T("chargerCatalog"); chargerRow.appendChild(chargerLabel);
    const chargerSelect = ce("select");
    for (const entry of app.catalogs.chargers) {
      const o = ce("option"); o.value = entry.id; o.textContent = entry.name;
      if (entry.id === app.profiles.turbo.id) o.selected = true;
      chargerSelect.appendChild(o);
    }
    chargerSelect.addEventListener("change", () => selectCharger(app, chargerSelect.value));
    chargerRow.appendChild(chargerSelect);
    sec.appendChild(chargerRow);

    return sec;
  }

  function categoryLabel(category) {
    const map = { BOTTOM_END: "catBottomEnd", VALVETRAIN: "catValvetrain", AIRFLOW: "catAirflow",
      FORCED_INDUCTION: "catForcedInduction", DRIVETRAIN: "drivetrain", INTAKE: "catIntake", EXHAUST: "catExhaust" };
    return T(map[category] || category);
  }

  function buildModsPanel(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("modifications"); sec.appendChild(title);

    for (const entry of app.catalogs.mods) {
      const modDef = app.modsLibrary[entry.modId];
      if (!modDef) continue;
      const row = ce("div", "mod-row");

      const labelRow = ce("label", "mod-check-label");
      const checkbox = ce("input"); checkbox.type = "checkbox";
      checkbox.checked = app.mods.active.includes(entry.modId);
      checkbox.title = modDef.description;
      checkbox.addEventListener("change", () => toggleMod(app, entry.modId, checkbox.checked));
      labelRow.appendChild(checkbox);
      const textSpan = ce("span");
      textSpan.textContent = ` ${modDef.name} (${categoryLabel(modDef.category)})`;
      textSpan.title = modDef.description;
      labelRow.appendChild(textSpan);
      row.appendChild(labelRow);

      if (checkbox.checked && modDef.manufacturerOverrides) {
        const variantSelect = ce("select", "mod-variant-select");
        const defaultOpt = ce("option"); defaultOpt.value = ""; defaultOpt.textContent = T("modVariantDefault");
        variantSelect.appendChild(defaultOpt);
        for (const variantKey in modDef.manufacturerOverrides) {
          const o = ce("option"); o.value = variantKey; o.textContent = variantKey.replace(/^spec_/, "").replace(/_/g, " ");
          if (app.mods.variants[entry.modId] === variantKey) o.selected = true;
          variantSelect.appendChild(o);
        }
        variantSelect.addEventListener("change", () => setModVariant(app, entry.modId, variantSelect.value || null));
        row.appendChild(variantSelect);
      }
      sec.appendChild(row);
    }

    if (app.lastResolvedMods) {
      const readout = ce("div", "mod-readout");
      const r = app.lastResolvedMods;
      readout.innerHTML =
        `<div>${T("resolvedConfig")}</div>` +
        `<div>${T("effMaxRpm")}: ${r.effectiveMaxRpm} ${T("rpmUnit")}</div>` +
        `<div>${T("totalMass")}: ${r.totalRotatingMass.toFixed(2)} kg</div>` +
        `<div>${T("strengthFactor")}: ${r.strengthFactor.toFixed(2)}×</div>` +
        `<div>${T("parasiticLoss")}: ${r.parasiticLossHp.toFixed(1)} hp</div>`;
      sec.appendChild(readout);
    }

    return sec;
  }

  // ---------------------------------------------------------------- Left panel
  function buildLeftPanel(app, root) {
    root.innerHTML = "";
    const h = ce("h2"); h.textContent = T("inputs"); root.appendChild(h);

    root.appendChild(buildScenarioShortcuts(app));
    root.appendChild(buildEngineCatalogPanel(app));

    const engSection = ce("div", "panel-section");
    const geo = app.profiles.engineBase.geometry;

    function geometryStepper(label, field, min, max, step, unit) {
      return createStepper({
        label, value: geo[field], min, max, step, unit,
        onChange: v => {
          pushUndo(app);
          geo[field] = v;
          if (field === "boreMM" || field === "strokeMM") {
            geo.displacementCC = displacementFromGeometry(app.profiles.engineBase);
          }
          applyEngineWithMods(app);
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

    root.appendChild(buildModsPanel(app));

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

  // ---------------------------------------------------------------- Discipline panels
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
          app.profiles.engineBase = data;
          app.mods = { active: [], variants: {} };
          applyEngineWithMods(app);
        } else if (data.limits && typeof data.type === "string") {
          app.profiles.turbo = data;
          app.worker.postMessage({ type: "importProfile", kind: "turbo", data });
          buildLeftPanel(app, qs("#left-panel"));
        } else if (data.fuels) {
          app.profiles.fuels = data.fuels;
          buildLeftPanel(app, qs("#left-panel"));
        } else if (data.modId && data.category && data.defaultEffects) {
          app.modsLibrary[data.modId] = data;
          buildLeftPanel(app, qs("#left-panel"));
        }
      } catch (e) { /* invalid file — ignore */ }
    };
    reader.readAsText(file);
  }

  function rebuildSchematic(app) {
    const container = qs("#schematic-container");
    const labels = {
      schematicAlt: T("schematicAlt"), cylinder: T("cylinderLabel"),
      block: componentLabel("block"), cylinderHead: componentLabel("cylinderHead"),
      frontViewAlt: T("frontViewAlt"), topViewAlt: T("topViewAlt"), bank: T("bankLabel")
    };
    const view = app.schematicView || "side";
    if (view === "front") {
      app.render.handle = OEL.Renderer.buildSchematicFront(container, app.profiles.engine, labels);
    } else if (view === "top") {
      app.render.handle = OEL.Renderer.buildSchematicTop(container, app.profiles.engine, labels);
    } else {
      app.render.handle = OEL.Renderer.buildSchematic(container, app.profiles.engine, labels);
    }
    attachTooltip(app);
  }

  function setSchematicView(app, view) {
    app.schematicView = view;
    for (const btn of document.querySelectorAll(".view-toggle-btn")) {
      btn.classList.toggle("active", btn.dataset.view === view);
    }
    rebuildSchematic(app);
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
    if (app.chartA && app.chartA.destroy) app.chartA.destroy();
    if (app.chartB && app.chartB.destroy) app.chartB.destroy();
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
      series: [{}, { label: `${T("oilTempLabel")} (°C)`, stroke: "#FFB627", width: 1.5, scale: "temp" },
        { label: `${T("cylPressureLabel")} (bar)`, stroke: "#FF6B1A", width: 1.5, scale: "press" }],
      axes: [Object.assign({}, axisOpts), Object.assign({ scale: "temp" }, axisOpts), Object.assign({ scale: "press", side: 1 }, axisOpts)]
    }, [[0], [0], [0]], qs("#chart-b"));
  }
  function updateCharts(app) {
    const h = app.history;
    if (h.t.length < 2) return;
    app.chartA.setData([h.t, h.rpm, h.boost]);
    app.chartB.setData([h.t, h.oilTemp, h.cylPressure]);
  }
  function updateLiveReadout(app, result) {
    const afrColor = Math.abs(result.afr - 14.7) > 3 ? "warn" : "";
    const knockClass = result.knockDetected ? "warn" : "";
    qs("#live-readout").innerHTML = `
      <div class="live-tile"><span class="live-label">${T("rpmUnit")}</span><span class="live-value">${result.rpm.toFixed(0)}</span></div>
      <div class="live-tile"><span class="live-label">${T("powerLabel")}</span><span class="live-value">${result.powerHp.toFixed(0)} hp</span></div>
      <div class="live-tile"><span class="live-label">${T("torqueLabel")}</span><span class="live-value">${result.brakeTorqueNm.toFixed(0)} Nm</span></div>
      <div class="live-tile"><span class="live-label">${T("boostLabel")}</span><span class="live-value">${result.boostBar.toFixed(2)} bar</span></div>
      <div class="live-tile"><span class="live-label">${T("afrLabel")}</span><span class="live-value ${afrColor}">${result.afr.toFixed(1)}</span></div>
      <div class="live-tile"><span class="live-label">${T("oilTempLabel")}</span><span class="live-value">${result.oilTempC.toFixed(0)}°C</span></div>
      <div class="live-tile"><span class="live-label">${T("cylPressureLabel")}</span><span class="live-value ${knockClass}">${result.cylinderPressureBar.toFixed(1)} bar</span></div>
      <div class="live-tile"><span class="live-label">${T("weakestLink")}</span><span class="live-value ${result.weakestLink.sf < 1.2 ? "warn" : ""}">${componentLabel(result.weakestLink.id)} ${result.weakestLink.sf.toFixed(2)}×</span></div>
    `;
  }

  function updateStats(app) {
    const h = app.history;
    const rpmS = stats(h.rpm), oilS = stats(h.oilTemp), pS = stats(h.cylPressure);
    qs("#stats-panel").innerHTML =
      row(T("rpmUnit"), rpmS, "") + row(T("oilTempLabel"), oilS, "°C") + row(T("cylPressureLabel"), pS, "bar");
    function row(label, st, unit) {
      return `<div class="stat-row"><span>${label}</span><span>${st.min.toFixed(0)} / ${st.mean.toFixed(0)} / ${st.max.toFixed(0)} ${unit}</span></div>`;
    }
  }
  function exportHistoryCsv(app) {
    const h = app.history;
    if (!h.t.length) return;
    const header = "time_s,rpm,boost_bar,oil_temp_c,power_hp,torque_nm,cylinder_pressure_bar,knock_margin_percent";
    const lines = [header];
    for (let i = 0; i < h.t.length; i++) {
      lines.push([
        h.t[i].toFixed(2), h.rpm[i].toFixed(0), h.boost[i].toFixed(2), h.oilTemp[i].toFixed(1),
        h.powerHp[i].toFixed(1), h.torqueNm[i].toFixed(1), h.cylPressure[i].toFixed(2), h.knockMargin[i].toFixed(1)
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openenginelab_run_${Math.round(app.lastResult ? app.lastResult.time : 0)}s.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function pushHistory(app, r) {
    const h = app.history;
    const knockMarginPercent = r.knockLimitBar > 0 ? ((r.knockLimitBar - r.cylinderPressureBar) / r.knockLimitBar) * 100 : 100;
    h.t.push(r.time); h.rpm.push(r.rpm); h.boost.push(r.boostBar);
    h.oilTemp.push(r.oilTempC); h.cylPressure.push(r.cylinderPressureBar);
    h.powerHp.push(r.powerHp); h.torqueNm.push(r.brakeTorqueNm); h.knockMargin.push(knockMarginPercent);
    if (h.t.length > HISTORY_LEN) {
      h.t.shift(); h.rpm.shift(); h.boost.shift(); h.oilTemp.shift(); h.cylPressure.shift();
      h.powerHp.shift(); h.torqueNm.shift(); h.knockMargin.shift();
    }
  }

  // ---------------------------------------------------------------- Status bar
  function updateStatusBar(app, result) {
    qs("#status-state").textContent = app.running ? T("running") : T("stopped");
    qs("#status-state").className = app.running ? "ok" : "warn";
    qs("#status-time").textContent = `t=${result.time.toFixed(1)}s | ${T("cyclesLabel")} ${result.cycles.toFixed(0)}`;
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

  // ---------------------------------------------------------------- Discipline
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
    app.history = { t: [], rpm: [], boost: [], oilTemp: [], cylPressure: [], powerHp: [], torqueNm: [], knockMargin: [] };
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

  // ---------------------------------------------------------------- Language
  function wireDynoTestButton(app) {
    qs("#dyno-test-btn").addEventListener("click", () => {
      const panel = qs("#dyno-test-panel");
      const isOpen = panel.style.display !== "none";
      if (isOpen) { panel.style.display = "none"; return; }

      const fuel = app.profiles.fuels.find(f => f.id === app.controls.activeFuelId);
      const benchmark = OEL.Benchmark.runWotBenchmark({
        engine: app.profiles.engine, turbo: app.profiles.turbo, fuel,
        extras: {}, boostTargetBar: app.controls.boostTargetBar
      });
      const check = OEL.RealismCheck.checkRealism(app.profiles.engine, app.profiles.turbo, benchmark.peak);
      const levelClass = { ok: "ok", warn: "warn", critical: "critical" };
      const binned = OEL.Benchmark.binSeriesByRpm(benchmark.series, 100);

      let html = `<h3>${T("dynoTestTitle")}</h3>` +
        `<p class="launch-hint">${T("dynoTestExplain")}</p>` +
        `<div class="dyno-peaks">` +
        `<div class="dyno-peak-tile"><span class="live-label">${T("cmpPeakPower")}</span><span class="live-value">${benchmark.peak.powerHp.toFixed(0)} hp @ ${benchmark.peak.powerHpRpm.toFixed(0)} rpm</span></div>` +
        `<div class="dyno-peak-tile"><span class="live-label">${T("cmpPeakTorque")}</span><span class="live-value">${benchmark.peak.brakeTorqueNm.toFixed(0)} Nm @ ${benchmark.peak.torqueRpm.toFixed(0)} rpm</span></div>` +
        `<div class="dyno-peak-tile"><span class="live-label">${T("cmpOilTempPeak")}</span><span class="live-value">${benchmark.peak.oilTempC.toFixed(0)}°C</span></div>` +
        `<div class="dyno-peak-tile"><span class="live-label">${T("cmpWeakestSf")}</span><span class="live-value">${benchmark.peak.weakestSfMin.toFixed(2)}×</span></div>` +
        `</div>` +
        `<div id="dyno-chart" class="chart" style="height:220px;margin:12px 0"></div>` +
        `<div class="launch-summary">`;
      for (const f of check.findings) {
        html += `<div class="launch-alert ${levelClass[f.level]}">${T(f.key).replace("{v}", f.value)}</div>`;
      }
      html += `</div><button id="dyno-test-close" class="icon-btn-text" style="margin-top:10px">${T("close")}</button>`;
      panel.innerHTML = html;
      panel.style.display = "block";
      qs("#dyno-test-close").addEventListener("click", () => { panel.style.display = "none"; });

      if (app.dynoChart) app.dynoChart.destroy();
      app.dynoChart = new uPlot({
        width: qs("#dyno-chart").clientWidth || 400, height: 200,
        scales: { hp: {}, nm: {} },
        series: [
          { label: T("rpmUnit") },
          { label: `${T("cmpPeakPower")} (hp)`, stroke: "#3DDC97", width: 2, scale: "hp" },
          { label: `${T("cmpPeakTorque")} (Nm)`, stroke: "#4A9EFF", width: 2, scale: "nm" }
        ],
        axes: [
          { stroke: "#7C8894", grid: { stroke: "rgba(122,136,148,0.15)" } },
          { scale: "hp", stroke: "#3DDC97", grid: { stroke: "rgba(122,136,148,0.15)" } },
          { scale: "nm", side: 1, stroke: "#4A9EFF", grid: { show: false } }
        ]
      }, [binned.rpm, binned.powerHp, binned.torqueNm], qs("#dyno-chart"));
    });
  }

  function relabelStaticUI(app) {
    qs("#tab-schematic").textContent = T("tabSchematic");
    qs("#tab-kennfield").textContent = T("tabKennfield");
    qs("#tab-launch").textContent = T("tabLaunch");
    qs("#tab-compare").textContent = T("tabCompare");
    qs("#estop").textContent = T("estop");
    qs("#undo-btn").title = T("undo");
    qs("#redo-btn").title = T("redo");
    qs("#report-btn").title = T("report");
    qs("#save-setup-btn").title = T("saveSetup");
    qs("#load-setup-btn").title = T("loadSetup");
    qs("#csv-export-btn").title = T("csvExport");
    qs("#dyno-test-btn").textContent = "▶ " + T("dynoTestBtn");
    qs("#view-side-btn").textContent = T("viewSide");
    qs("#view-front-btn").textContent = T("viewFront");
    qs("#view-top-btn").textContent = T("viewTop");
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
    initCharts(app);
    app.launchViewBuilt = false;
    app.compareViewBuilt = false;
    if (app.view === "launch" || app.view === "compare") setView(app, app.view);
  }

  // ---------------------------------------------------------------- Report
  function wireTopbar(app) {
    qs("#tab-schematic").addEventListener("click", () => setView(app, "schematic"));
    qs("#tab-kennfield").addEventListener("click", () => setView(app, "kennfield"));
    qs("#tab-launch").addEventListener("click", () => setView(app, "launch"));
    qs("#tab-compare").addEventListener("click", () => setView(app, "compare"));
    wireSetupIO(app);
    wireDynoTestButton(app);
    qs("#view-side-btn").addEventListener("click", () => setSchematicView(app, "side"));
    qs("#view-front-btn").addEventListener("click", () => setSchematicView(app, "front"));
    qs("#view-top-btn").addEventListener("click", () => setSchematicView(app, "top"));
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

  // ---------------------------------------------------------------- Launch Simulation (v2 extension)
  async function runLaunchSimulation(app) {
    const dt = 0.02;
    const durationS = 3.0;
    const drivetrain = app.profiles.drivetrain || await fetchJson("data/drivetrain/6-speed-close-ratio.json");
    const fuel = app.profiles.fuels.find(f => f.id === app.controls.activeFuelId);
    const boostTarget = app.controls.boostTargetBar || app.profiles.turbo.limits.maxBoostBar;

    const state = OEL.Engine.createState(app.profiles.engine, app.profiles.turbo, fuel, { drivetrainProfile: drivetrain });
    const ecmState = OEL.ECM.createState();
    const series = { t: [], rpm: [], boost: [], speedKmh: [], slip: [] };
    let hydrolockAtS = null, wheelspinStartS = null, wheelspinEndS = null;

    const totalTicks = Math.round(durationS / dt);
    for (let i = 0; i < totalTicks; i++) {
      const t = i * dt;
      const ecmOut = OEL.ECM.computeCycle(ecmState, app.profiles.engine, app.profiles.turbo, {
        rpm: state.rpm, throttle01: 1.0, boostBar: state.boostBar, boostTargetBar: boostTarget,
        knockDetected: state.knockDetected, dt, alsActive: false, nitrousArmed: false, nitrousBottleKg: 0
      });
      const result = OEL.Engine.step(state, dt, {
        throttle01: 1.0, ambientC: app.controls.ambientC, baroBar: app.controls.baroBar,
        boostCommandBar: ecmOut.boostCommandBar, ignitionAdvanceDeg: ecmOut.ignitionAdvanceDeg,
        cutIgnition: ecmOut.cutIgnition, nitrousActive: false, hybridDeployKw: 0,
        drivetrain: { gear: 1, gradePercent: 0, brake01: 0 }
      });
      series.t.push(+t.toFixed(2)); series.rpm.push(result.rpm); series.boost.push(result.boostBar);
      series.speedKmh.push(result.vehicleSpeedMS * 3.6); series.slip.push(result.wheelSlipping ? 1 : 0);
      if (result.hydrolockFailure && hydrolockAtS === null) hydrolockAtS = t;
      if (result.wheelSlipping && wheelspinStartS === null) wheelspinStartS = t;
      if (!result.wheelSlipping && wheelspinStartS !== null && wheelspinEndS === null) wheelspinEndS = t;
      if (Number.isNaN(state.rpm)) break;
    }
    const wheelspinOngoing = wheelspinStartS !== null && wheelspinEndS === null;
    return { series, hydrolockAtS, wheelspinStartS, wheelspinEndS, wheelspinOngoing };
  }

  function buildLaunchView(app) {
    const root = qs("#launch-view");
    root.innerHTML = `
      <div class="launch-panel">
        <h3>${T("launchTitle")}</h3>
        <p class="launch-hint">${T("launchHint")}</p>
        <button id="launch-run-btn" class="run-btn">${T("launchRun")}</button>
        <div id="launch-summary" class="launch-summary"></div>
        <div id="launch-chart" class="chart" style="height:260px;margin-top:12px"></div>
      </div>`;

    qs("#launch-run-btn").addEventListener("click", async () => {
      qs("#launch-run-btn").disabled = true;
      const { series, hydrolockAtS, wheelspinStartS, wheelspinEndS, wheelspinOngoing } = await runLaunchSimulation(app);
      qs("#launch-run-btn").disabled = false;

      const summaryEl = qs("#launch-summary");
      let html = "";
      if (hydrolockAtS !== null) {
        html += `<div class="launch-alert critical">${T("launchHydrolockRisk")} t=${hydrolockAtS.toFixed(2)}s</div>`;
      } else {
        html += `<div class="launch-alert ok">${T("launchNoHydrolock")}</div>`;
      }
      if (wheelspinStartS === null) {
        html += `<div class="launch-alert ok">${T("launchNoWheelspin")}</div>`;
      } else if (wheelspinOngoing) {
        html += `<div class="launch-alert warn">${T("launchWheelspinOngoing")}</div>`;
      } else {
        html += `<div class="launch-alert warn">${T("launchWheelspinUntil")} t=${wheelspinEndS.toFixed(2)}s</div>`;
      }
      summaryEl.innerHTML = html;

      if (app.launchChart) app.launchChart.destroy();
      app.launchChart = new uPlot({
        width: qs("#launch-chart").clientWidth || 500, height: 240,
        scales: { rpm: {}, other: {} },
        series: [
          {},
          { label: T("rpmUnit"), stroke: "#3DDC97", width: 1.5, scale: "rpm" },
          { label: `${T("boostTarget")} (bar)`, stroke: "#4A9EFF", width: 1.5, scale: "other" },
          { label: `${T("speedLabel")} (km/h)`, stroke: "#FFB627", width: 1.5, scale: "other" }
        ],
        axes: [
          { stroke: "#7C8894", grid: { stroke: "rgba(122,136,148,0.15)" } },
          { scale: "rpm", stroke: "#7C8894", grid: { stroke: "rgba(122,136,148,0.15)" } },
          { scale: "other", side: 1, stroke: "#7C8894", grid: { stroke: "rgba(122,136,148,0.15)" } }
        ]
      }, [series.t, series.rpm, series.boost, series.speedKmh], qs("#launch-chart"));
    });
  }

  // ---------------------------------------------------------------- Comparison Mode (v2 extension)
  function buildCompareView(app) {
    const root = qs("#compare-view");
    root.innerHTML = `
      <div class="compare-panel">
        <h3>${T("realismTitle")}</h3>
        <p class="launch-hint">${T("realismHint")}</p>
        <button id="realism-run-btn" class="run-btn">${T("realismRun")}</button>
        <div id="realism-result" class="launch-summary"></div>

        <h3 style="margin-top:28px">${T("compareTitle")}</h3>
        <p class="launch-hint">${T("compareHint")}</p>
        <div class="compare-inputs">
          <div class="compare-slot">
            <label>${T("compareSetupA")}</label>
            <input type="file" id="compare-file-a" accept=".oel,application/json">
            <div id="compare-name-a" class="compare-filename">—</div>
          </div>
          <div class="compare-slot">
            <label>${T("compareSetupB")}</label>
            <input type="file" id="compare-file-b" accept=".oel,application/json">
            <div id="compare-name-b" class="compare-filename">—</div>
          </div>
        </div>
        <button id="compare-run-btn" class="run-btn" disabled>${T("compareRun")}</button>
        <div id="compare-result"></div>
      </div>`;

    qs("#realism-run-btn").addEventListener("click", () => {
      const fuel = app.profiles.fuels.find(f => f.id === app.controls.activeFuelId);
      const benchmark = OEL.Benchmark.runWotBenchmark({
        engine: app.profiles.engine, turbo: app.profiles.turbo, fuel,
        extras: {}, boostTargetBar: app.controls.boostTargetBar
      });
      const check = OEL.RealismCheck.checkRealism(app.profiles.engine, app.profiles.turbo, benchmark.peak);
      const levelClass = { ok: "ok", warn: "warn", critical: "critical" };
      let html = "";
      for (const f of check.findings) {
        html += `<div class="launch-alert ${levelClass[f.level]}">${T(f.key).replace("{v}", f.value)}</div>`;
      }
      qs("#realism-result").innerHTML = html;
    });

    let setupA = null, setupB = null;
    function updateRunEnabled() { qs("#compare-run-btn").disabled = !(setupA && setupB); }

    function readSetupFile(input, onLoaded, nameElId) {
      input.addEventListener("change", () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = OEL.SetupIO.parseSetup(reader.result);
            onLoaded(parsed);
            qs(nameElId).textContent = parsed.metadata.name + " (v" + parsed.metadata.currentVersion + ")";
            updateRunEnabled();
          } catch (e) {
            qs(nameElId).textContent = T("compareInvalidFile");
          }
        };
        reader.readAsText(file);
      });
    }
    readSetupFile(qs("#compare-file-a"), (p) => { setupA = p; }, "#compare-name-a");
    readSetupFile(qs("#compare-file-b"), (p) => { setupB = p; }, "#compare-name-b");

    qs("#compare-run-btn").addEventListener("click", () => {
      const fuelsById = {};
      app.profiles.fuels.forEach(f => { fuelsById[f.id] = f; });
      const cmp = OEL.Comparison.compareSetups(setupA, setupB, fuelsById);
      renderComparisonTable(cmp);
    });

    function renderComparisonTable(cmp) {
      let html = `<table class="compare-table"><thead><tr><th>${T("compareParameter")}</th>` +
        `<th>${cmp.setupNames[0]}</th><th>${cmp.setupNames[1]}</th><th>${T("compareDiff")}</th></tr></thead><tbody>`;
      for (const row of cmp.rows) {
        const sign = row.diff > 0 ? "+" : "";
        html += `<tr class="diff-${row.direction}"><td>${T(row.labelKey)}</td>` +
          `<td>${row.a.toFixed(2)} ${row.unit}</td><td>${row.b.toFixed(2)} ${row.unit}</td>` +
          `<td>${sign}${row.diff.toFixed(2)} ${row.unit} ${row.direction === "better" ? "✓" : row.direction === "worse" ? "⚠" : ""}</td></tr>`;
      }
      html += "</tbody></table>";
      qs("#compare-result").innerHTML = html;
    }
  }

  // ---------------------------------------------------------------- Setup Save/Load (v2 extension)
  function applyLoadedSetup(app, data) {
    pushUndo(app);
    app.profiles.engineBase = data.config.engineBase;
    app.profiles.turbo = data.config.turbo;
    app.mods = data.config.mods || { active: [], variants: {} };
    app.controls.activeFuelId = data.config.activeFuelId;
    app.controls.boostTargetBar = data.config.boostTargetBar;
    app.setupMeta = data.metadata;
    app.worker.postMessage({ type: "importProfile", kind: "turbo", data: app.profiles.turbo });
    const fuel = app.profiles.fuels.find(f => f.id === app.controls.activeFuelId);
    if (fuel) app.worker.postMessage({ type: "patch", target: "fuel", data: fuel });
    applyEngineWithMods(app);
  }

  async function loadScenario(app, file) {
    try {
      const data = await fetchJson(file);
      applyLoadedSetup(app, data);
      flashAdvisory(app, `${T("loadSetupLoaded")}: ${data.metadata.name}`);
    } catch (e) {
      flashAdvisory(app, T("loadSetupInvalid"));
    }
  }

  function buildScenarioShortcuts(app) {
    const sec = ce("div", "panel-section");
    const title = ce("h3"); title.textContent = T("scenariosTitle"); sec.appendChild(title);
    const row = ce("div", "scenario-row");
    const scenarios = [
      { key: "scenarioLaunch", file: "data/scenarios/scenario-launch.json" },
      { key: "scenarioTrackday", file: "data/scenarios/scenario-trackday.json" },
      { key: "scenarioStreet", file: "data/scenarios/scenario-street.json" }
    ];
    for (const s of scenarios) {
      const btn = ce("button", "scenario-btn");
      btn.textContent = T(s.key);
      btn.addEventListener("click", () => loadScenario(app, s.file));
      row.appendChild(btn);
    }
    sec.appendChild(row);
    return sec;
  }

  function wireSetupIO(app) {
    qs("#save-setup-btn").addEventListener("click", () => {
      const change = window.prompt(T("saveSetupPrompt"), "");
      if (change === null) return;
      const setup = OEL.SetupIO.downloadSetup(app, change || T("saveSetupDefaultChange"));
      flashAdvisory(app, `${T("saveSetupSaved")} v${setup.metadata.currentVersion}`);
    });
    qs("#load-setup-btn").addEventListener("click", () => qs("#load-setup-input").click());
    qs("#load-setup-input").addEventListener("change", () => {
      const file = qs("#load-setup-input").files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = OEL.SetupIO.parseSetup(reader.result);
          applyLoadedSetup(app, data);
          flashAdvisory(app, `${T("loadSetupLoaded")}: ${data.metadata.name} (v${data.metadata.currentVersion})`);
        } catch (e) {
          flashAdvisory(app, T("loadSetupInvalid"));
        }
      };
      reader.readAsText(file);
      qs("#load-setup-input").value = "";
    });
    qs("#csv-export-btn").addEventListener("click", () => exportHistoryCsv(app));
  }

  let advisoryTimeout = null;
  function flashAdvisory(app, text) {
    const el = qs("#status-flash");
    clearTimeout(advisoryTimeout);
    el.textContent = text;
    advisoryTimeout = setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 3500);
  }


  function setView(app, view) {
    app.view = view;
    qs("#schematic-container").style.display = view === "schematic" ? "block" : "none";
    qs("#kennfield-view").style.display = view === "kennfield" ? "block" : "none";
    qs("#launch-view").style.display = view === "launch" ? "block" : "none";
    qs("#compare-view").style.display = view === "compare" ? "block" : "none";
    qs("#dyno-test-btn").style.display = view === "schematic" ? "block" : "none";
    qs("#schematic-view-toggle").style.display = view === "schematic" ? "flex" : "none";
    if (view !== "schematic") qs("#dyno-test-panel").style.display = "none";
    qs("#tab-schematic").classList.toggle("active", view === "schematic");
    qs("#tab-kennfield").classList.toggle("active", view === "kennfield");
    qs("#tab-launch").classList.toggle("active", view === "launch");
    qs("#tab-compare").classList.toggle("active", view === "compare");
    if (view === "launch" && !app.launchViewBuilt) { buildLaunchView(app); app.launchViewBuilt = true; }
    if (view === "compare" && !app.compareViewBuilt) { buildCompareView(app); app.compareViewBuilt = true; }
  }

  // ---------------------------------------------------------------- Render loop
  function renderLoop(app, nowMs) {
    if (app.lastFrameMs == null) app.lastFrameMs = nowMs;
    let dt = (nowMs - app.lastFrameMs) / 1000;
    app.lastFrameMs = nowMs;
    dt = Math.min(0.1, Math.max(0, dt));

    try {
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
        const view = app.schematicView || "side";
        if (view === "side") {
          OEL.Renderer.updateCrankAngle(app.render.handle, app.render.thetaRad);
          OEL.Renderer.applyStressState(app.render.handle, result.components, {
            rod: componentLabel("rod"), headBolt: componentLabel("headBolt"), pistonPin: componentLabel("pistonPin"),
            cylinderHead: componentLabel("cylinderHead"), block: componentLabel("block")
          });
        } else {
          OEL.Renderer.applyOverallStress(app.render.handle, result.weakestLink);
        }
        updateCharts(app);
        updateLiveReadout(app, result);
        updateStats(app);
        updateStatusBar(app, result);
        updateKennfield(app);
        updateDisciplinePanelsLive(app, result);
      }
    } catch (err) {
      // A single bad frame must never permanently freeze the whole simulation —
      // log it for diagnosis and keep the animation loop alive.
      console.error("renderLoop frame error (recovered):", err);
    }
    requestAnimationFrame((t) => renderLoop(app, t));
  }

  // ---------------------------------------------------------------- Init
  async function init() {
    const [engineCatalog, chargerCatalog, modsCatalog, fuelDb] = await Promise.all([
      fetchJson("data/catalog/engines.json"),
      fetchJson("data/catalog/chargers.json"),
      fetchJson("data/catalog/mods.json"),
      fetchJson("data/fuels/pump-fuels.json")
    ]);

    const defaultEngineEntry = engineCatalog.entries[0];
    const defaultChargerEntry = chargerCatalog.entries.find(c => c.type === "turbocharger") || chargerCatalog.entries[0];

    const [engineBase, turbo, ...modDefs] = await Promise.all([
      fetchJson(defaultEngineEntry.file),
      fetchJson(defaultChargerEntry.file),
      ...modsCatalog.entries.map(m => fetchJson(m.file))
    ]);

    const modsLibrary = {};
    modsCatalog.entries.forEach((entry, i) => { modsLibrary[entry.modId] = modDefs[i]; });

    const app = {
      catalogs: { engines: engineCatalog.entries, chargers: chargerCatalog.entries, mods: modsCatalog.entries },
      modsLibrary,
      mods: { active: [], variants: {} },
      profiles: { engineBase: deepClone(engineBase), engine: null, turbo: deepClone(turbo), fuels: fuelDb.fuels, hybrid: null, nitrous: null, drivetrain: null },
      lastResolvedMods: null,
      controls: {
        throttle01: 0.15, ambientC: 20, baroBar: 1.0, boostTargetBar: 0, activeFuelId: fuelDb.fuels[1].id,
        altitudeM: 0, alsActive: false, nitrousArmed: false, hybridDeployPct: 0, gear: 0, gradePercent: 0, brake01: 0
      },
      discipline: "standard", panels: {},
      history: { t: [], rpm: [], boost: [], oilTemp: [], cylPressure: [], powerHp: [], torqueNm: [], knockMargin: [] },
      render: { handle: null, thetaRad: 0 },
      track: { profile: null, player: null }, trackPanelEl: null,
      undo: { stack: [], redoStack: [] },
      view: "schematic", schematicView: "side", running: true, lastFrameMs: null,
      lastResult: null, lastEcmOut: null
    };
    window.OEL_APP = app;

    const resolved = OEL.Mods.resolveEngineConfiguration(ensureBaseStock(app.profiles.engineBase), app.mods.active, app.mods.variants, app.modsLibrary);
    const initialEngine = deepClone(app.profiles.engineBase);
    OEL.Mods.applyResolvedConfig(initialEngine, resolved);
    app.profiles.engine = initialEngine;
    app.lastResolvedMods = resolved;

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
