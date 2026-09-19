/* OpenEngineLab :: js/ecm.js — virtual ECU (vECU) + extension package (ALS, overrun cut, N2O gating) */
(function (root) {
  "use strict";

  const IGN_RPM_AXIS = [800, 2000, 3500, 5000, 6000, 7000];
  const IGN_LOAD_AXIS = [0, 25, 50, 75, 100];
  const IGN_MAP = [
    [12, 22, 28, 32, 34, 30],
    [10, 19, 25, 29, 30, 26],
    [8, 16, 21, 24, 25, 21],
    [6, 13, 17, 19, 19, 16],
    [4, 10, 13, 14, 14, 12]
  ]; // [loadIdx][rpmIdx] -> Grad v. OT

  const FUEL_RPM_AXIS = IGN_RPM_AXIS;
  const FUEL_LOAD_AXIS = IGN_LOAD_AXIS;
  const FUEL_MAP = [
    [1.2, 1.6, 2.0, 2.3, 2.4, 2.3],
    [2.1, 2.9, 3.6, 4.1, 4.3, 4.1],
    [3.0, 4.3, 5.4, 6.1, 6.4, 6.1],
    [3.9, 5.7, 7.2, 8.2, 8.6, 8.2],
    [4.8, 7.1, 9.0, 10.3, 10.8, 10.3]
  ]; // [loadIdx][rpmIdx] -> mg/Zyklus (Basis)

  function clampIndex(axis, v) {
    if (v <= axis[0]) return { i0: 0, i1: 0, t: 0 };
    if (v >= axis[axis.length - 1]) return { i0: axis.length - 1, i1: axis.length - 1, t: 0 };
    for (let i = 0; i < axis.length - 1; i++) {
      if (v >= axis[i] && v <= axis[i + 1]) {
        const t = (v - axis[i]) / (axis[i + 1] - axis[i]);
        return { i0: i, i1: i + 1, t };
      }
    }
    return { i0: 0, i1: 0, t: 0 };
  }

  /** Bilinear interpolation over map[loadIdx][rpmIdx]. */
  function bilinear(map, rpmAxis, loadAxis, rpm, load) {
    const rx = clampIndex(rpmAxis, rpm);
    const ry = clampIndex(loadAxis, load);
    const v00 = map[ry.i0][rx.i0], v01 = map[ry.i0][rx.i1];
    const v10 = map[ry.i1][rx.i0], v11 = map[ry.i1][rx.i1];
    const vTop = v00 + (v01 - v00) * rx.t;
    const vBot = v10 + (v11 - v10) * rx.t;
    return vTop + (vBot - vTop) * ry.t;
  }

  /** Trilinear interpolation over map3d[zIdx][loadIdx][rpmIdx], e.g. IAT correction. */
  function trilinear(map3d, rpmAxis, loadAxis, zAxis, rpm, load, z) {
    const rz = clampIndex(zAxis, z);
    const loLayer = bilinear(map3d[rz.i0], rpmAxis, loadAxis, rpm, load);
    const hiLayer = bilinear(map3d[rz.i1], rpmAxis, loadAxis, rpm, load);
    return loLayer + (hiLayer - loLayer) * rz.t;
  }

  function createState() {
    return { ignitionTrimDeg: 0, boostIntegral: 0, fuelFilmMg: 0 };
  }

  function loadPercentFromThrottleBoost(throttle01, boostBar, maxBoostBar) {
    return Math.min(100, 100 * (0.4 * throttle01 + 0.6 * (boostBar / Math.max(0.1, maxBoostBar))));
  }

  /**
   * Computes one full ECU cycle.
   * args: { rpm, throttle01, boostBar, boostTargetBar, knockDetected, dt,
   *         alsActive, nitrousArmed, nitrousBottleKg }
   * Returns: { ignitionAdvanceDeg, fuelCommandMg, boostCommandBar, cutIgnition,
   *            revLimiting, loadPercent, overrunActive, alsFiring, nitrousActive }
   */
  function computeCycle(ecmState, engineProfile, turboProfile, args) {
    const rpm = args.rpm, throttle01 = args.throttle01, boostBar = args.boostBar;
    const boostTargetBar = args.boostTargetBar, knockDetected = args.knockDetected, dt = args.dt;

    const load = loadPercentFromThrottleBoost(throttle01, boostBar, turboProfile.limits.maxBoostBar);

    if (knockDetected) ecmState.ignitionTrimDeg = Math.min(8, ecmState.ignitionTrimDeg + 1.0);
    else ecmState.ignitionTrimDeg = Math.max(0, ecmState.ignitionTrimDeg - 0.05);

    const revLimiting = rpm >= engineProfile.revLimiterRPM;

    // Overrun fuel cut: active as long as the throttle is closed and RPM is above idle —
    // just like a real ECU, not as a fixed-duration timer pulse.
    const throttleClosed = throttle01 < 0.08 && rpm > engineProfile.idleRPM * 1.1;
    const alsFiring = throttleClosed && !!args.alsActive;
    const overrunActive = throttleClosed && !args.alsActive;

    const cutIgnition = revLimiting || overrunActive;

    let ignitionAdvanceDeg = bilinear(IGN_MAP, IGN_RPM_AXIS, IGN_LOAD_AXIS, rpm, load) - ecmState.ignitionTrimDeg;
    ignitionAdvanceDeg = Math.max(-5, ignitionAdvanceDeg);
    if (alsFiring) ignitionAdvanceDeg = 2;

    const baseFuelMg = bilinear(FUEL_MAP, FUEL_RPM_AXIS, FUEL_LOAD_AXIS, rpm, load);
    const tau = 0.35, xWetting = 0.22;
    ecmState.fuelFilmMg += ((baseFuelMg - ecmState.fuelFilmMg) / tau) * dt;
    let fuelCommandMg = baseFuelMg * (1 - xWetting) + ecmState.fuelFilmMg * xWetting;
    if (alsFiring) fuelCommandMg *= 1.3;
    if (overrunActive) fuelCommandMg *= 0.1;

    const boostError = boostTargetBar - boostBar;
    ecmState.boostIntegral = Math.max(-1, Math.min(1, ecmState.boostIntegral + boostError * dt * 0.5));
    let boostCommandBar = Math.max(0, Math.min(boostTargetBar, boostBar + boostError * 0.8 + ecmState.boostIntegral));
    boostCommandBar = revLimiting ? Math.max(0, boostBar - 0.5) : boostCommandBar;
    boostCommandBar = Math.min(boostCommandBar, turboProfile.limits.maxBoostBar);
    // With ALS, the boost target is held (the turbine keeps spinning, driven by the
    // after-fired rich mixture) instead of dropping to the (low) part-throttle target.
    if (alsFiring) boostCommandBar = Math.max(boostCommandBar, Math.min(boostBar, boostTargetBar));

    const nitrousActive = !!(args.nitrousArmed && args.nitrousBottleKg > 0 && throttle01 > 0.9 && !revLimiting);

    return {
      ignitionAdvanceDeg, fuelCommandMg, boostCommandBar, cutIgnition, revLimiting,
      loadPercent: load, overrunActive, alsFiring, nitrousActive
    };
  }

  root.OEL = root.OEL || {};
  root.OEL.ECM = {
    IGN_RPM_AXIS, IGN_LOAD_AXIS, IGN_MAP,
    FUEL_RPM_AXIS, FUEL_LOAD_AXIS, FUEL_MAP,
    bilinear, trilinear, createState, computeCycle, loadPercentFromThrottleBoost
  };
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : global));
