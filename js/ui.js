/* OpenEngineLab :: js/ui.js — Complete UI Management & Feature Integration */
(function () {
  "use strict";

  // Global application state
  const app = {
    isRunning: false,
    isPaused: false,
    throttle01: 0,
    boostTarget: 1.0,
    ambientC: 25,
    currentTab: "side",
    profiles: {
      engine: null,
      turbo: null,
      fuel: null,
      mods: {}
    },
    history: {
      rpm: [],
      power: [],
      torque: [],
      boost: [],
      oilTemp: [],
      cylinderPressure: [],
      knockMargin: []
    },
    stats: {
      minRpm: 800,
      maxRpm: 800,
      avgOilTemp: 20,
      maxCylPress: 0
    }
  };

  // Initialize when DOM is ready
  document.addEventListener("DOMContentLoaded", async () => {
    await loadInitialConfig();
    setupEventListeners();
    initializeNewFeatures();
    renderUI();
    startSimulationLoop();
  });

  // Load initial engine/turbo/fuel configuration
  async function loadInitialConfig() {
    try {
      // Load Nissan VR38DETT as default
      const engineResp = await fetch("data/engines/vr38dett.json");
      app.profiles.engine = await engineResp.json();

      // Load Garrett G35-900 as default turbo
      const turboResp = await fetch("data/parts/turbos/garrett-g35.json");
      app.profiles.turbo = await turboResp.json();

      // Load Super Plus 98 as default fuel
      const fuelsResp = await fetch("data/fuels/pump-fuels.json");
      const fuels = await fuelsResp.json();
      app.profiles.fuel = fuels.find(f => f.id === "super-plus-98") || fuels[0];

      console.log("[UI] Initial config loaded");
    } catch (err) {
      console.error("[UI] Failed to load initial config:", err);
    }
  }

  // Setup all event listeners
  function setupEventListeners() {
    // Engine selection
    document.getElementById("select-engine").addEventListener("change", async (e) => {
      try {
        const resp = await fetch(`data/engines/${e.target.value}.json`);
        app.profiles.engine = await resp.json();
        console.log("[UI] Engine changed to:", app.profiles.engine.name);
        renderUI();
      } catch (err) {
        console.error("[UI] Failed to load engine:", err);
      }
    });

    // Turbo selection
    document.getElementById("select-turbo").addEventListener("change", async (e) => {
      try {
        const resp = await fetch(`data/parts/turbos/${e.target.value}.json`);
        app.profiles.turbo = await resp.json();
        console.log("[UI] Turbo changed to:", app.profiles.turbo.name);
        renderUI();
      } catch (err) {
        console.error("[UI] Failed to load turbo:", err);
      }
    });

    // Fuel selection
    document.getElementById("select-fuel").addEventListener("change", async (e) => {
      try {
        const resp = await fetch("data/fuels/pump-fuels.json");
        const fuels = await resp.json();
        app.profiles.fuel = fuels.find(f => f.id === e.target.value) || fuels[0];
        console.log("[UI] Fuel changed to:", app.profiles.fuel.name);
      } catch (err) {
        console.error("[UI] Failed to load fuel:", err);
      }
    });

    // Throttle slider
    document.getElementById("slider-throttle").addEventListener("input", (e) => {
      app.throttle01 = parseFloat(e.target.value);
      document.getElementById("display-throttle").textContent = Math.round(app.throttle01 * 100) + "%";
    });

    // Boost slider
    document.getElementById("slider-boost").addEventListener("input", (e) => {
      app.boostTarget = parseFloat(e.target.value);
      document.getElementById("display-boost").textContent = app.boostTarget.toFixed(1) + " bar";
    });

    // Ambient temp input
    document.getElementById("input-ambient").addEventListener("change", (e) => {
      app.ambientC = parseFloat(e.target.value);
    });

    // Ignition button
    document.getElementById("btn-ignition").addEventListener("click", () => {
      app.isRunning = !app.isRunning;
      const btn = document.getElementById("btn-ignition");
      if (app.isRunning) {
        btn.textContent = "⏻ STOP";
        btn.style.background = "#c41e3a";
        document.getElementById("status-message").textContent = "Running";
        document.getElementById("status-message").style.color = "#FF6B35";
      } else {
        btn.textContent = "⏻ START";
        btn.style.background = "#FF6B35";
        document.getElementById("status-message").textContent = "Idle";
        document.getElementById("status-message").style.color = "#3ddc84";
      }
    });

    // E-STOP button
    document.getElementById("btn-estop").addEventListener("click", () => {
      app.isRunning = false;
      app.throttle01 = 0;
      document.getElementById("slider-throttle").value = 0;
      document.getElementById("display-throttle").textContent = "0%";
      document.getElementById("btn-ignition").textContent = "⏻ START";
      document.getElementById("btn-ignition").style.background = "#FF6B35";
      document.getElementById("status-message").textContent = "Stopped";
      document.getElementById("status-message").style.color = "#c41e3a";
    });

    // Dyno Test button
    document.getElementById("btn-dyno-test").addEventListener("click", () => {
      runDynoTest();
    });

    // Preset buttons
    document.getElementById("preset-launch").addEventListener("click", () => loadPreset("launch"));
    document.getElementById("preset-trackday").addEventListener("click", () => loadPreset("trackday"));
    document.getElementById("preset-street").addEventListener("click", () => loadPreset("street"));

    // Map Editor button
    document.getElementById("btn-map-editor").addEventListener("click", () => {
      const panel = document.getElementById("map-editor-panel");
      if (panel.style.display === "none") {
        panel.style.display = "flex";
        initializeMapEditor();
      } else {
        panel.style.display = "none";
      }
    });

    // Dyno Engine button
    document.getElementById("btn-dyno-engine").addEventListener("click", () => {
      const panel = document.getElementById("dyno-engine-panel");
      if (panel.style.display === "none") {
        panel.style.display = "flex";
        initializeDynoEngine();
      } else {
        panel.style.display = "none";
      }
    });

    // Schematic tabs
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        app.currentTab = e.target.dataset.tab;
        renderSchematic();
      });
    });

    // Import button
    document.getElementById("btn-import").addEventListener("click", () => {
      document.getElementById("hidden-import-input").click();
    });

    document.getElementById("hidden-import-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (data.engineBase || data.geometry) {
          app.profiles.engine = data.engineBase || app.profiles.engine;
          console.log("[UI] Engine imported");
        }
        if (data.turbo) {
          app.profiles.turbo = data.turbo;
          console.log("[UI] Turbo imported");
        }
        if (data.activeFuelId) {
          // Load fuel by ID
          const resp = await fetch("data/fuels/pump-fuels.json");
          const fuels = await resp.json();
          app.profiles.fuel = fuels.find(f => f.id === data.activeFuelId) || app.profiles.fuel;
          console.log("[UI] Fuel imported");
        }
        renderUI();
      } catch (err) {
        console.error("[UI] Import failed:", err);
        alert("Failed to import file. Ensure it's valid JSON.");
      }
    });

    // Save button
    document.getElementById("btn-save").addEventListener("click", () => {
      if (OEL.SetupIO) {
        OEL.SetupIO.saveSetup({
          engine: app.profiles.engine,
          turbo: app.profiles.turbo,
          fuel: app.profiles.fuel,
          mods: app.profiles.mods,
          boostTarget: app.boostTarget
        });
      }
    });

    console.log("[UI] Event listeners initialized");
  }

  // Load preset configuration
  async function loadPreset(presetName) {
    try {
      const resp = await fetch(`data/scenarios/scenario-${presetName}.json`);
      const preset = await resp.json();
      
      app.profiles.engine = preset.config.engineBase;
      app.profiles.turbo = preset.config.turbo;
      app.boostTarget = preset.config.boostTargetBar;
      document.getElementById("slider-boost").value = app.boostTarget;
      document.getElementById("display-boost").textContent = app.boostTarget.toFixed(1) + " bar";
      
      renderUI();
      console.log("[UI] Preset loaded:", presetName);
    } catch (err) {
      console.error("[UI] Failed to load preset:", err);
    }
  }

  // Run dyno test
  async function runDynoTest() {
    if (!OEL.Benchmark) {
      console.error("[UI] Benchmark module not loaded");
      return;
    }

    console.log("[UI] Starting Dyno Test");
    const result = OEL.Benchmark.runBenchmark(
      app.profiles.engine,
      app.profiles.turbo,
      app.profiles.fuel,
      {}
    );

    alert(`Dyno Test Results:\n\nPeak Power: ${result.peakPower.toFixed(0)} hp\nPeak Torque: ${result.peakTorque.toFixed(0)} Nm\nPeak Oil Temp: ${result.peakOilTemp.toFixed(1)}°C\nKnock Margin Min: ${result.knockMarginMin.toFixed(1)}%\nWeakest Link SF: ${result.weakestLinkSf.toFixed(2)}×`);
  }

  // Initialize Map Editor
  function initializeMapEditor() {
    const panelDiv = document.getElementById("map-editor-panel");
    panelDiv.innerHTML = "";

    if (!OEL.MapEditor || !OEL.ECM) {
      panelDiv.innerHTML = "<p style='color: red;'>Error: Map Editor module not loaded</p>";
      return;
    }

    // Create containers
    const fuelContainer = document.createElement("div");
    fuelContainer.id = "fuel-map-editor-internal";
    fuelContainer.style.flex = "1";
    panelDiv.appendChild(fuelContainer);

    const ignContainer = document.createElement("div");
    ignContainer.id = "ignition-map-editor-internal";
    ignContainer.style.flex = "1";
    ignContainer.style.borderLeft = "1px solid #444";
    panelDiv.appendChild(ignContainer);

    // Initialize editors
    OEL.MapEditor.createEditor(
      "fuel-map-editor-internal",
      "FUEL",
      OEL.ECM.FUEL_MAP,
      OEL.ECM.FUEL_RPM_AXIS,
      OEL.ECM.FUEL_LOAD_AXIS,
      (editedMap) => {
        Object.assign(OEL.ECM.FUEL_MAP, editedMap);
        console.log("[MapEditor] Fuel map updated in real-time");
      },
      { title: "Fuel Map Editor" }
    );

    OEL.MapEditor.createEditor(
      "ignition-map-editor-internal",
      "IGN",
      OEL.ECM.IGN_MAP,
      OEL.ECM.IGN_RPM_AXIS,
      OEL.ECM.IGN_LOAD_AXIS,
      (editedMap) => {
        Object.assign(OEL.ECM.IGN_MAP, editedMap);
        console.log("[MapEditor] Ignition map updated in real-time");
      },
      { title: "Ignition Map Editor" }
    );

    console.log("[UI] Map Editor initialized");
  }

  // Initialize Dyno Engine
  function initializeDynoEngine() {
    const panelDiv = document.getElementById("dyno-engine-panel");
    panelDiv.innerHTML = "";

    if (!OEL.DynoEngine) {
      panelDiv.innerHTML = "<p style='color: red;'>Error: Dyno Engine module not loaded</p>";
      return;
    }

    OEL.DynoEngine.createDynoTest(
      "dyno-engine-panel",
      app.profiles.engine,
      app.profiles.turbo,
      app.profiles.fuel,
      { title: `Dyno Test — ${app.profiles.engine.name}` }
    );

    console.log("[UI] Dyno Engine initialized");
  }

  // Initialize new features
  function initializeNewFeatures() {
    // Ensure containers exist
    let mapPanel = document.getElementById("map-editor-panel");
    if (!mapPanel) {
      mapPanel = document.createElement("div");
      mapPanel.id = "map-editor-panel";
      mapPanel.style.display = "none";
      document.getElementById("center-panel").appendChild(mapPanel);
    }

    let dynoPanel = document.getElementById("dyno-engine-panel");
    if (!dynoPanel) {
      dynoPanel = document.createElement("div");
      dynoPanel.id = "dyno-engine-panel";
      dynoPanel.style.display = "none";
      document.getElementById("center-panel").appendChild(dynoPanel);
    }

    console.log("[UI] New features containers initialized");
  }

  // Render UI updates
  function renderUI() {
    renderSchematic();
    updateTelemetry();
  }

  // Render engine schematic
  function renderSchematic() {
    if (!OEL.Renderer) return;

    const svg = document.getElementById("engine-schematic");
    svg.innerHTML = "";

    // Call renderer based on current tab
    if (app.currentTab === "side") {
      OEL.Renderer.renderSideView(svg, app.profiles.engine, { scale: 0.8 });
    } else if (app.currentTab === "front") {
      OEL.Renderer.renderFrontView(svg, app.profiles.engine, { scale: 0.8 });
    } else if (app.currentTab === "top") {
      OEL.Renderer.renderTopView(svg, app.profiles.engine, { scale: 0.8 });
    }
  }

  // Update telemetry displays
  function updateTelemetry() {
    // This will be called continuously in the simulation loop
    // Values are updated by the simulation engine
  }

  // Main simulation loop
  function startSimulationLoop() {
    function loop() {
      if (app.isRunning && app.profiles.engine && OEL.Engine && OEL.ECM) {
        // Simulate one step
        const state = OEL.Engine.getCurrentState ? OEL.Engine.getCurrentState() : null;
        
        if (state) {
          // Update displays
          document.getElementById("display-rpm").textContent = Math.round(state.rpm);
          document.getElementById("display-power").textContent = (state.powerHp || 0).toFixed(0);
          document.getElementById("display-torque").textContent = (state.brakeTorqueNm || 0).toFixed(0);
          document.getElementById("display-current-boost").textContent = (state.boostBar || 0).toFixed(2);
          document.getElementById("display-oil-temp").textContent = (state.oilTempC || 20).toFixed(1);
          document.getElementById("display-cyl-pressure").textContent = (state.cylinderPressureBar || 0).toFixed(1);
          document.getElementById("display-knock-margin").textContent = (state.knockMarginPercent || 100).toFixed(0);
          document.getElementById("display-sf").textContent = (state.weakestLinkSf || "∞").toFixed(2);

          // Update stats
          if (app.history.rpm.length === 0 || state.rpm < app.stats.minRpm) app.stats.minRpm = state.rpm;
          if (state.rpm > app.stats.maxRpm) app.stats.maxRpm = state.rpm;
          if (state.cylinderPressureBar > app.stats.maxCylPress) app.stats.maxCylPress = state.cylinderPressureBar;

          app.history.rpm.push(state.rpm);
          app.history.power.push(state.powerHp || 0);
          app.history.torque.push(state.brakeTorqueNm || 0);
          app.history.boost.push(state.boostBar || 0);
          app.history.oilTemp.push(state.oilTempC || 20);
          app.history.cylinderPressure.push(state.cylinderPressureBar || 0);
          app.history.knockMargin.push(state.knockMarginPercent || 100);

          // Keep history size manageable
          if (app.history.rpm.length > 500) {
            app.history.rpm.shift();
            app.history.power.shift();
            app.history.torque.shift();
            app.history.boost.shift();
            app.history.oilTemp.shift();
            app.history.cylinderPressure.shift();
            app.history.knockMargin.shift();
          }

          document.getElementById("stat-min-rpm").textContent = Math.round(app.stats.minRpm);
          document.getElementById("stat-max-rpm").textContent = Math.round(app.stats.maxRpm);
          document.getElementById("stat-avg-oil").textContent = (app.history.oilTemp.reduce((a, b) => a + b, 0) / Math.max(1, app.history.oilTemp.length)).toFixed(1) + "°C";
          document.getElementById("stat-max-cyl").textContent = app.stats.maxCylPress.toFixed(1) + " bar";
        }
      }

      requestAnimationFrame(loop);
    }
    loop();
  }

  // Export to window
  window.OEL = window.OEL || {};
  window.OEL.UI = { app, setupEventListeners, initializeNewFeatures };
})();
