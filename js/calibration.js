/* OpenEngineLab :: js/calibration.js — single-factor power calibration against a factory reference (pure logic, no DOM) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  const PS_PER_HP = 1.01387;                     // metric horsepower (PS) per mechanical horsepower
  const HP_PER_KW = 1.34102;                     // mechanical horsepower per kilowatt
  const FACTOR_MIN = 0.2;                        // lower clamp for an automatically computed factor
  const FACTOR_MAX = 5;                          // upper clamp for an automatically computed factor
  const EXTRAPOLATION_BOOST_TOLERANCE = 0.30;    // relative boost deviation from the calibration point that marks a setup as extrapolated
  const UNITS = ["PS", "hp", "kW"];
  const BASES = ["crank", "wheel"];

  function isPositiveFinite(v) {
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  }

  /** Parses a user-entered decimal (accepts a comma as decimal separator). Returns NaN when not numeric. */
  function parseDecimal(input) {
    if (input === null || input === undefined) return NaN;
    const text = String(input).trim().replace(",", ".");
    if (text === "") return NaN;
    return Number(text);
  }

  /** Returns a valid manual factor (finite and > 0) or null. Used for stored values and user input alike. */
  function validateManualFactor(input) {
    if (input === null || input === undefined || input === "") return null;
    const n = typeof input === "string" ? parseDecimal(input) : Number(input);
    return isPositiveFinite(n) ? n : null;
  }

  /** Returns a valid target { value, unit, basis } or null. */
  function normalizeTarget(raw) {
    if (!raw || typeof raw !== "object") return null;
    const value = Number(raw.value);
    if (!isPositiveFinite(value) || UNITS.indexOf(raw.unit) < 0 || BASES.indexOf(raw.basis) < 0) return null;
    return { value, unit: raw.unit, basis: raw.basis };
  }

  /** Converts a target value to mechanical horsepower. Returns null for an invalid target. */
  function targetToHp(target) {
    if (!target || !isPositiveFinite(target.value)) return null;
    if (target.unit === "PS") return target.value / PS_PER_HP;
    if (target.unit === "kW") return target.value * HP_PER_KW;
    if (target.unit === "hp") return target.value;
    return null;
  }

  /**
   * Calibration target of a stock record: the explicit calibration.target if present,
   * otherwise the factory reference peak power (crank basis unless the reference says wheel).
   */
  function targetFromRecord(rec) {
    if (!rec) return null;
    const explicit = rec.calibration ? normalizeTarget(rec.calibration.target) : null;
    if (explicit) return explicit;
    const ref = rec.reference;
    const refPeak = ref ? Number(ref.peakPowerHp) : NaN;
    if (!isPositiveFinite(refPeak)) return null;
    return { value: refPeak, unit: "hp", basis: ref.basis === "wheel" ? "wheel" : "crank" };
  }

  /** Manual factor stored in a stock record (calibration.manualFactor), or null. */
  function manualFactorFromRecord(rec) {
    return rec && rec.calibration ? validateManualFactor(rec.calibration.manualFactor) : null;
  }

  /** Simulated peak power on the target's basis in mechanical hp (crank peak or wheel peak). */
  function simulatedHpOnBasis(peak, basis) {
    if (!peak) return null;
    const v = basis === "wheel" ? peak.wheelPowerHp : peak.powerHp;
    return isPositiveFinite(v) ? v : null;
  }

  /**
   * Computes the automatic factor that maps the uncalibrated simulated peak onto the target.
   * Output is linear in the factor, so the calibrated peak equals the target exactly unless clamped.
   * Returns { factor, rawFactor, clamped, simulatedHp, targetHp } or null if it cannot be computed.
   */
  function computeAutoFactor(target, uncalibratedPeak) {
    const tHp = targetToHp(target);
    const sHp = simulatedHpOnBasis(uncalibratedPeak, target ? target.basis : null);
    if (tHp === null || sHp === null) return null;
    const rawFactor = tHp / sHp;
    const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, rawFactor));
    return { factor, rawFactor, clamped: factor !== rawFactor, simulatedHp: sHp, targetHp: tHp };
  }

  /** Stable description of the charger system ("none x1", "turbocharger x2"). Changes when type or count changes. */
  function chargerSignature(chargerList) {
    const counts = {};
    for (const c of chargerList || []) {
      const type = String(c && c.type ? c.type : "unknown").toLowerCase();
      counts[type] = (counts[type] || 0) + 1;
    }
    return Object.keys(counts).sort().map(t => t + " x" + counts[t]).join(" + ");
  }

  /** Calibration point: the operating configuration the factor was measured at. */
  function makeCalibrationPoint(boostTargetBar, chargerList, fuelId) {
    const boost = Number(boostTargetBar);
    return {
      boostTargetBar: Number.isFinite(boost) && boost >= 0 ? boost : 0,
      chargerSignature: chargerSignature(chargerList),
      fuelId: fuelId || null
    };
  }

  /**
   * Checks whether the current setup has left the calibration point.
   * Returns { extrapolated, reasons: [] } with reasons drawn from "boost" and "chargers".
   */
  function evaluateExtrapolation(point, boostTargetBar, chargerList) {
    const reasons = [];
    if (!point) return { extrapolated: false, reasons };
    const current = Number(boostTargetBar) || 0;
    const calBoost = point.boostTargetBar || 0;
    if (calBoost > 0) {
      if (Math.abs(current - calBoost) / calBoost > EXTRAPOLATION_BOOST_TOLERANCE) reasons.push("boost");
    } else if (current > 0) {
      reasons.push("boost");
    }
    if (point.chargerSignature !== chargerSignature(chargerList)) reasons.push("chargers");
    return { extrapolated: reasons.length > 0, reasons };
  }

  /** Sanitizes an automatic-factor block (from a stored file or a fresh computation). */
  function sanitizeAuto(raw) {
    if (!raw || typeof raw !== "object") return null;
    const factor = Number(raw.factor);
    if (!isPositiveFinite(factor)) return null;
    const finiteOrNull = v => (Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      factor,
      rawFactor: finiteOrNull(raw.rawFactor),
      clamped: !!raw.clamped,
      simulatedHp: finiteOrNull(raw.simulatedHp),
      targetHp: finiteOrNull(raw.targetHp)
    };
  }

  function sanitizePoint(raw) {
    if (!raw || typeof raw !== "object") return null;
    const boost = Number(raw.boostTargetBar);
    return {
      boostTargetBar: Number.isFinite(boost) && boost >= 0 ? boost : 0,
      chargerSignature: typeof raw.chargerSignature === "string" ? raw.chargerSignature : "",
      fuelId: typeof raw.fuelId === "string" ? raw.fuelId : null
    };
  }

  /** Effective factor: a valid manual value wins, then the automatic factor, otherwise 1.0. */
  function resolveEffective(state) {
    if (state && isPositiveFinite(state.manualFactor)) return { factor: state.manualFactor, mode: "manual" };
    if (state && state.auto && isPositiveFinite(state.auto.factor)) return { factor: state.auto.factor, mode: "auto" };
    return { factor: 1, mode: "none" };
  }

  function withResolved(state) {
    const eff = resolveEffective(state);
    state.factor = eff.factor;
    state.mode = eff.mode;
    return state;
  }

  /**
   * Builds a complete calibration state from its parts.
   * input: { target, manualFactor, auto, point } — each optional; invalid parts become null.
   * Result: { target, manualFactor, auto, point, factor, mode } with mode "manual" | "auto" | "none".
   */
  function buildState(input) {
    const src = input || {};
    return withResolved({
      target: normalizeTarget(src.target),
      manualFactor: validateManualFactor(src.manualFactor),
      auto: sanitizeAuto(src.auto),
      point: sanitizePoint(src.point)
    });
  }

  /** Sanitizes a calibration state read from a .oel file. Returns null for absent or invalid data (factor 1.0). */
  function sanitizeState(raw) {
    if (!raw || typeof raw !== "object") return null;
    return buildState(raw);
  }

  /** Plain JSON copy of a state for .oel files and undo snapshots. */
  function serializeState(state) {
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  /** The block the simulation core reads from the engine profile (engine.js resolveTorqueScale). */
  function toEngineBlock(state) {
    if (!state) return null;
    return { factor: state.factor, mode: state.mode, target: state.target, point: state.point };
  }

  /** Returns a shallow copy of an engine profile carrying the calibration of a stored state. */
  function attachToEngine(engineProfile, rawState) {
    return Object.assign({}, engineProfile, { calibration: toEngineBlock(sanitizeState(rawState)) });
  }

  /** Status key for display: extrapolated overrides the mode. */
  function statusKey(state, extrapolation) {
    if (extrapolation && extrapolation.extrapolated) return "calStatusExtrapolated";
    if (!state || state.mode === "none") return "calStatusNone";
    return state.mode === "manual" ? "calStatusManual" : "calStatusCalibrated";
  }

  OEL.Calibration = {
    PS_PER_HP, HP_PER_KW, FACTOR_MIN, FACTOR_MAX, EXTRAPOLATION_BOOST_TOLERANCE,
    parseDecimal, validateManualFactor, normalizeTarget, targetToHp,
    targetFromRecord, manualFactorFromRecord, simulatedHpOnBasis, computeAutoFactor,
    chargerSignature, makeCalibrationPoint, evaluateExtrapolation,
    buildState, sanitizeState, serializeState, toEngineBlock, attachToEngine, statusKey, UNITS
  };
})();
