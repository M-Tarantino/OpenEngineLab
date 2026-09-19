/* OpenEngineLab :: js/mods.js — modular component architecture (Extension 1) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  /**
   * Resolves the abstract configuration that results from stacking a set of active
   * modification modules on top of a base engine's stock baseline. This is a direct
   * port of the calculation pipeline described in the modular engine architecture
   * specification: delta values (mass, parasitic loss) combine additively, while
   * structural capability limits (strength, RPM ceiling) combine multiplicatively.
   *
   * baseEngine: engine profile object, must include a `baseStock` block:
   *   { boreMm, strokeMm, compressionRatio, maxRpm, rotatingMassKg, parasiticLossHp }
   * activeModKeys: array of modId strings that are currently enabled
   * selectedVariants: { [modId]: variantKey } — optional manufacturer-override
   *   selection per active mod; a mod with no entry here uses its defaultEffects
   * modsLibrary: { [modId]: modDefinition } — every available mod definition,
   *   keyed by modId
   *
   * Returns: {
   *   displacementCC, effectiveMaxRpm, totalRotatingMass, parasiticLossHp,
   *   strengthFactor, rpmMultiplierAccumulator, intercoolerEfficiencyDelta
   * }
   */
  function resolveEngineConfiguration(baseEngine, activeModKeys, selectedVariants, modsLibrary) {
    const resolved = {
      displacementCC: baseEngine.geometry.displacementCC,
      effectiveMaxRpm: baseEngine.baseStock.maxRpm,
      totalRotatingMass: baseEngine.baseStock.rotatingMassKg,
      parasiticLossHp: baseEngine.baseStock.parasiticLossHp,
      strengthFactor: 1.0,
      rpmMultiplierAccumulator: 1.0,
      intercoolerEfficiencyDelta: 0
    };

    for (let i = 0; i < activeModKeys.length; i++) {
      const modKey = activeModKeys[i];
      const modDef = modsLibrary[modKey];
      if (!modDef) continue;

      // Resolve effects: start from the mod's default effects, then apply a
      // manufacturer-specific override on top where one is selected.
      const effects = Object.assign({}, modDef.defaultEffects);
      const variantKey = selectedVariants[modKey];
      if (variantKey && modDef.manufacturerOverrides && modDef.manufacturerOverrides[variantKey]) {
        const overrides = modDef.manufacturerOverrides[variantKey];
        for (const prop in overrides) {
          if (Object.prototype.hasOwnProperty.call(overrides, prop)) effects[prop] = overrides[prop];
        }
      }

      // Accumulate physical parameters: deltas add, multipliers multiply.
      if (effects.massDeltaKg) resolved.totalRotatingMass += effects.massDeltaKg;
      if (effects.rpmMultiplier) resolved.rpmMultiplierAccumulator *= effects.rpmMultiplier;
      if (effects.parasiticLossDeltaHp) resolved.parasiticLossHp += effects.parasiticLossDeltaHp;
      if (effects.strengthMultiplier) resolved.strengthFactor *= effects.strengthMultiplier;
      if (effects.intercoolerEfficiencyDelta) resolved.intercoolerEfficiencyDelta += effects.intercoolerEfficiencyDelta;
    }

    resolved.effectiveMaxRpm = Math.floor(baseEngine.baseStock.maxRpm * resolved.rpmMultiplierAccumulator);
    return resolved;
  }

  /**
   * Translates a resolved abstract configuration onto a concrete engine profile,
   * mutating the physics fields that engine.js actually consumes. The engine
   * profile passed in should already be a deep clone of the base engine — this
   * function mutates it in place and also returns it for convenience.
   */
  function applyResolvedConfig(engineProfile, resolved) {
    const baseline = engineProfile.baseStock;

    // RPM ceiling: scale both the soft redline and the hard rev limiter by the
    // accumulated multiplier, preserving their original margin above one another.
    const rpmFactor = resolved.rpmMultiplierAccumulator;
    engineProfile.redlineRPM = Math.round(engineProfile.redlineRPM * rpmFactor);
    engineProfile.revLimiterRPM = Math.round(engineProfile.revLimiterRPM * rpmFactor);

    // Rotating mass: convert the mass delta (kg) into a moment-of-inertia delta
    // using a representative crank-throw radius, then add it onto the engine's
    // base rotating inertia. Floors at a sane minimum so a very light build can
    // never reach zero or negative inertia.
    const massDeltaKg = resolved.totalRotatingMass - baseline.rotatingMassKg;
    const representativeRadiusM = 0.045;
    engineProfile.dynamics.rotatingInertiaKgM2 = Math.max(0.05,
      engineProfile.dynamics.rotatingInertiaKgM2 + massDeltaKg * representativeRadiusM * representativeRadiusM);

    // Parasitic loss: scale the base friction torque proportionally to the change
    // in parasitic horsepower relative to the stock baseline.
    const hpRatio = Math.max(0.2, resolved.parasiticLossHp / Math.max(1, baseline.parasiticLossHp));
    engineProfile.dynamics.frictionTorqueBaseNm = engineProfile.dynamics.frictionTorqueBaseNm * hpRatio;
    engineProfile.dynamics.frictionTorquePerRPM = engineProfile.dynamics.frictionTorquePerRPM * hpRatio;

    // Structural strength: a stronger bottom end raises the yield strength ceiling
    // of every stressed component uniformly. A real build sizes each part
    // individually, but this keeps the weakest-link model consistent with the
    // abstract mod stack described in the modular architecture spec.
    for (const key in engineProfile.materials) {
      if (Object.prototype.hasOwnProperty.call(engineProfile.materials, key)) {
        engineProfile.materials[key].yieldStrengthMPa *= resolved.strengthFactor;
      }
    }

    // Charge cooling: intercooler upgrades raise the effective intercooler
    // efficiency, capped at a realistic ceiling.
    if (resolved.intercoolerEfficiencyDelta) {
      engineProfile.intercoolerEfficiency = Math.min(0.95,
        Math.max(0, (engineProfile.intercoolerEfficiency || 0) + resolved.intercoolerEfficiencyDelta));
    }

    return engineProfile;
  }

  OEL.Mods = { resolveEngineConfiguration, applyResolvedConfig };
})();
