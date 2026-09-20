/* OpenEngineLab :: js/worker.js — simulation inside a Web Worker (decoupled from UI rendering) */
importScripts("engine.js", "ecm.js");

let simState = null;
let ecmState = null;
let running = false;
let lastTickMs = null;
let ignitionOn = true;

let controls = {
  throttle01: 0.15, ambientC: 20, baroBar: 1.0, boostTargetBar: 0,
  alsActive: false, nitrousArmed: false, hybridDeployKw: 0,
  drivetrain: null // { gear, gradePercent, brake01 }
};

function buildState(engine, turbo, fuel, extras) {
  simState = OEL.Engine.createState(engine, turbo, fuel, extras || {});
  ecmState = OEL.ECM.createState();
  if (!ignitionOn) simState.rpm = 0;
}

function tick() {
  if (!running || !simState) return;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (lastTickMs == null) lastTickMs = now;
  let dt = (now - lastTickMs) / 1000;
  lastTickMs = now;
  dt = Math.min(0.05, Math.max(0.001, dt));

  const c = controls;
  const effectiveThrottle = ignitionOn ? c.throttle01 : 0;
  const ecmOut = OEL.ECM.computeCycle(ecmState, simState.engine, simState.turbo, {
    rpm: simState.rpm, throttle01: effectiveThrottle, boostBar: simState.boostBar,
    boostTargetBar: ignitionOn ? c.boostTargetBar : 0, knockDetected: simState.knockDetected, dt,
    alsActive: c.alsActive, nitrousArmed: ignitionOn && c.nitrousArmed, nitrousBottleKg: simState.nitrousRemainingKg
  });
  const result = OEL.Engine.step(simState, dt, {
    throttle01: effectiveThrottle, ambientC: c.ambientC, baroBar: c.baroBar,
    boostCommandBar: ignitionOn ? ecmOut.boostCommandBar : 0, ignitionAdvanceDeg: ecmOut.ignitionAdvanceDeg,
    cutIgnition: !ignitionOn || ecmOut.cutIgnition, nitrousActive: ignitionOn && ecmOut.nitrousActive,
    hybridDeployKw: ignitionOn ? c.hybridDeployKw : 0, drivetrain: c.drivetrain
  });

  if (!ignitionOn && simState.rpm <= 305) {
    simState.rpm = 0;
    result.rpm = 0; result.boostBar = 0; result.cylinderPressureBar = 0;
    result.powerHp = 0; result.brakeTorqueNm = 0; result.knockDetected = false;
  }

  postMessage({ type: "tick", result, ecmOut, rpm: simState.rpm });
}

setInterval(tick, 20);

self.onmessage = function (e) {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      buildState(msg.engine, msg.turbo, msg.fuel, msg.extras);
      running = true;
      lastTickMs = null;
      break;
    case "controls":
      Object.assign(controls, msg.controls);
      break;
    case "setRunning":
      running = msg.running;
      lastTickMs = null;
      break;
    case "resetFailure":
      if (simState) OEL.Engine.resetFailure(simState);
      break;
    case "setIgnition":
      ignitionOn = !!msg.on;
      if (ignitionOn && simState) {
        simState.rpm = Math.max(simState.rpm, simState.engine.idleRPM * 0.35);
      }
      break;
    case "setDiscipline":
      if (simState) {
        const engine = msg.engine || simState.engine;
        const turbo = msg.turbo || simState.turbo;
        const fuel = msg.fuel || simState.fuel;
        buildState(engine, turbo, fuel, msg.extras || {});
      }
      break;
    case "patch":
      if (!simState) break;
      if (msg.target === "geometry") Object.assign(simState.engine.geometry, msg.data);
      else if (msg.target === "fuel") simState.fuel = msg.data;
      break;
    case "importProfile":
      if (!simState) break;
      if (msg.kind === "engine") buildState(msg.data, simState.turbo, simState.fuel, extrasOf(simState));
      else if (msg.kind === "turbo") { simState.turbo = msg.data; }
      else if (msg.kind === "fuel") { simState.fuel = msg.data; }
      break;
  }
};

function extrasOf(state) {
  return { nitrousProfile: state.nitrousProfile, hybridProfile: state.hybridProfile, drivetrainProfile: state.drivetrainProfile };
}
