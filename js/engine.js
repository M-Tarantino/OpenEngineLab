/* OpenEngineLab :: js/engine.js — physics simulation core (+ extension package) */
(function (root) {
  "use strict";

  const R_AIR = 287.05;      // J/(kg*K)
  const KAPPA = 1.35;        // Polytropenexponent, Luft/Kraftstoff-Gemisch
  const G = 9.81;

  function pistonAreaMM2(boreMM) {
    return Math.PI * Math.pow(boreMM / 2, 2);
  }

  function airDensityKgM3(baroBar, ambientC) {
    const p = baroBar * 1e5;
    const T = ambientC + 273.15;
    return p / (R_AIR * T);
  }

  /** Barometric altitude formula: air pressure (bar) at sea level -> altitude (m). */
  function baroAtAltitude(seaLevelBar, altitudeM) {
    return seaLevelBar * Math.exp(-altitudeM / 8434);
  }

  function volumetricEfficiency(throttle01, rpm, redlineRPM) {
    const over = Math.max(0, rpm / redlineRPM - 0.85);
    const rpmFactor = 1 - 0.35 * over * over;
    return Math.min(1.05, Math.max(0.35, (0.55 + 0.45 * throttle01) * rpmFactor));
  }

  function oilViscosity(tempC, eta0, alpha, refTempC) {
    return eta0 * Math.exp(alpha * (tempC - refTempC));
  }

  function thermalDerationFactor(tempC, baselineC, rate) {
    if (tempC <= baselineC) return 1;
    return Math.max(0.5, 1 - rate * (tempC - baselineC));
  }

  function knockLimitBar(ronOctane, chamberTempC, iatK, compressionRatio) {
    const base = 60 + (ronOctane - 87) * 4.5;
    const tempPenalty = Math.max(0, chamberTempC - 400) * 0.05;
    const iatPenalty = Math.max(0, iatK - 313) * 0.15;
    const crPenalty = Math.max(0, compressionRatio - 9.0) * 3.5;
    return Math.max(15, base - tempPenalty - iatPenalty - crPenalty);
  }

  /**
   * Creates a new simulation state.
   * extras (optional): { nitrousProfile, hybridProfile, drivetrainProfile }
   */
  function createState(engineProfile, turboProfile, fuel, extras) {
    extras = extras || {};
    return {
      engine: engineProfile,
      turbo: turboProfile,
      fuel: fuel,
      nitrousProfile: extras.nitrousProfile || null,
      hybridProfile: extras.hybridProfile || null,
      drivetrainProfile: extras.drivetrainProfile || null,
      time: 0,
      cycles: 0,
      rpm: engineProfile.idleRPM,
      boostBar: 0,
      oilTempC: 20,
      chamberTempC: 20,
      oilFilmOK: true,
      knockDetected: false,
      hydrolockFailure: false,
      damage: { rod: 0, headBolt: 0, pistonPin: 0, cylinderHead: 0, block: 0 },
      nitrousRemainingKg: extras.nitrousProfile ? extras.nitrousProfile.bottleCapacityKg : 0,
      batterySoC: extras.hybridProfile ? 0.5 : 0,
      vehicleSpeedMS: 0,
      lastResult: null
    };
  }

  /** Resets damage, operating temperatures and failures (fresh engine / rebuild). */
  function resetFailure(state) {
    state.damage = { rod: 0, headBolt: 0, pistonPin: 0, cylinderHead: 0, block: 0 };
    state.hydrolockFailure = false;
    state.oilTempC = 20;
    state.chamberTempC = 20;
    state.nitrousRemainingKg = state.nitrousProfile ? state.nitrousProfile.bottleCapacityKg : 0;
    state.batterySoC = state.hybridProfile ? 0.5 : 0;
  }

  /**
   * Runs one simulation step.
   * inputs: {
   *   throttle01, ambientC, baroBar, boostCommandBar, ignitionAdvanceDeg, cutIgnition,
   *   nitrousActive, hybridDeployKw, boostLerpRateOverride,
   *   drivetrain: { gear, gradePercent, brake01 } | null
   * }
   */
  function step(state, dt, inputs) {
    const eg = state.engine.geometry;
    const th = state.engine.thermal;
    const mats = state.engine.materials;
    const cyl = state.engine.cylinders;
    const redline = state.engine.redlineRPM;

    const rpm = state.rpm;
    const throttle = inputs.throttle01;
    const baro = inputs.baroBar;
    const ambientC = inputs.ambientC;

    const hasMguH = !!(state.hybridProfile && state.hybridProfile.hasMguH);
    const isSupercharger = (state.turbo.type || "").toLowerCase() === "supercharger";
    
    if (isSupercharger) {
      // Supercharger: RPM-dependent, no turbo lag, instant response
      // Boost = (RPM / maxRPM) × maxBoost × throttle_correction × cooler_effect
      const maxRpm = state.turbo.limits.maxRPM || 8000;
      const maxBoost = state.turbo.limits.maxBoostBar;
      const baseBoost = (rpm / maxRpm) * maxBoost * Math.max(0.1, throttle);
      const coolerDelta = Math.min(20, Math.abs(ambientC - (state.turbo.cooler?.targetInletTempC || 35)));
      const coolerPenalty = 1 - (coolerDelta / 50) * 0.15; // Cooler efficiency degrades in heat
      state.boostBar = baseBoost * coolerPenalty;
    } else {
      // Turbocharger: Lag-based boost response (original logic)
      let boostRate = inputs.boostLerpRateOverride || 3.2;
      let boostTargetThisTick = inputs.boostCommandBar;
      if (inputs.cutIgnition) { boostTargetThisTick = 0; boostRate = 0.6; }
      if (hasMguH) boostRate = Math.max(boostRate, 20);
      state.boostBar += (boostTargetThisTick - state.boostBar) * Math.min(1, dt * boostRate);
    }
    state.boostBar = Math.max(0, Math.min(state.turbo.limits.maxBoostBar, state.boostBar));

    const rho = airDensityKgM3(baro, ambientC);
    const seaLevelRho = airDensityKgM3(1.01325, 15);
    const densityRatio = Math.min(1, rho / seaLevelRho);

    const ve = volumetricEfficiency(throttle, rpm, redline);
    const displM3 = eg.displacementCC * 1e-6;
    const mdotAirKgS = rho * ve * displM3 * (rpm / 120);

    const intakeAbsBar = state.boostBar + baro * (0.25 + 0.75 * throttle);
    const iatK = (ambientC + 273.15) *
      Math.pow(intakeAbsBar / baro, (KAPPA - 1) / KAPPA) * (1 - state.engine.intercoolerEfficiency) +
      (ambientC + 273.15) * state.engine.intercoolerEfficiency;

    const mdotFuelKgS = mdotAirKgS / state.fuel.afrStoich;
    let fuelEnergyRateW = mdotFuelKgS * state.fuel.lhvMJPerKg * 1e6;

    const ignitionDeg = inputs.ignitionAdvanceDeg;
    const optimalAdvance = 18;
    const retardPenalty = Math.max(0, optimalAdvance - ignitionDeg) * 0.045;
    const compressedBar = intakeAbsBar * Math.pow(eg.compressionRatio, KAPPA);
    const combustionMultiplier = Math.max(0.6, 1.3 + 1.9 * Math.pow(throttle, 1.6) - retardPenalty);
    let cylinderPressureBar = inputs.cutIgnition ? intakeAbsBar : compressedBar * combustionMultiplier;

    let extraHeatFraction = 0;
    let nitrousEnrichFactor = 1;
    const nitrousActive = !!(inputs.nitrousActive && state.nitrousProfile && state.nitrousRemainingKg > 0);
    if (nitrousActive) {
      const np = state.nitrousProfile;
      nitrousEnrichFactor = 1 + np.shotEquivalentBar / 150;
      cylinderPressureBar += np.shotEquivalentBar * throttle;
      extraHeatFraction = np.heatFractionBoost;
      fuelEnergyRateW *= nitrousEnrichFactor;
      state.nitrousRemainingKg = Math.max(0, state.nitrousRemainingKg - (np.flowRateKgMin / 60) * dt);
    }

    state.chamberTempC = ambientC + state.oilTempC * 0.55 + (rpm / redline) * 300 * throttle;

    const knockLimit = knockLimitBar(state.fuel.ronOctane, state.chamberTempC, iatK, eg.compressionRatio);
    state.knockDetected = !inputs.cutIgnition && cylinderPressureBar > knockLimit;

    const afr = mdotFuelKgS > 0 ? mdotAirKgS / (mdotFuelKgS * nitrousEnrichFactor) : state.fuel.afrStoich;
    if (nitrousActive && state.nitrousProfile.hydrolockAfrThreshold && afr < state.nitrousProfile.hydrolockAfrThreshold) {
      state.hydrolockFailure = true;
    }

    const forceN = cylinderPressureBar * 1e5 * (pistonAreaMM2(eg.boreMM) * 1e-6);
    const deration = thermalDerationFactor(state.chamberTempC, th.thermalDerationBaselineC, th.thermalDerationRate);

    const sigmaRodMPa = forceN / mats.connectingRod.crossSectionAreaMM2;
    const sigmaBoltMPa = (forceN / mats.headBolt.boltsPerCylinder) / mats.headBolt.crossSectionAreaMM2;
    const sigmaPinMPa = forceN / mats.pistonPin.crossSectionAreaMM2;
    const sigmaHeadMPa = mats.cylinderHead ? forceN / mats.cylinderHead.crossSectionAreaMM2 : 0;
    const sigmaBlockMPa = mats.block ? forceN / mats.block.crossSectionAreaMM2 : 0;

    const yieldRod = mats.connectingRod.yieldStrengthMPa * deration;
    const yieldBolt = mats.headBolt.yieldStrengthMPa * deration;
    const yieldPin = mats.pistonPin.yieldStrengthMPa * deration;
    const yieldHead = mats.cylinderHead ? mats.cylinderHead.yieldStrengthMPa * deration : Infinity;
    const yieldBlock = mats.block ? mats.block.yieldStrengthMPa * deration : Infinity;

    const sfRod = state.hydrolockFailure ? 0 : yieldRod / Math.max(1e-6, sigmaRodMPa);
    const sfBolt = state.hydrolockFailure ? 0 : yieldBolt / Math.max(1e-6, sigmaBoltMPa);
    const sfPin = state.hydrolockFailure ? 0 : yieldPin / Math.max(1e-6, sigmaPinMPa);
    const sfHead = state.hydrolockFailure ? 0 : (mats.cylinderHead ? yieldHead / Math.max(1e-6, sigmaHeadMPa) : Infinity);
    const sfBlock = state.hydrolockFailure ? 0 : (mats.block ? yieldBlock / Math.max(1e-6, sigmaBlockMPa) : Infinity);

    const cyclesThisTick = (rpm / 120) * dt;
    accumulateDamage(state.damage, "rod", sigmaRodMPa, mats.connectingRod, cyclesThisTick);
    accumulateDamage(state.damage, "headBolt", sigmaBoltMPa, mats.headBolt, cyclesThisTick);
    accumulateDamage(state.damage, "pistonPin", sigmaPinMPa, mats.pistonPin, cyclesThisTick);
    if (mats.cylinderHead) accumulateDamage(state.damage, "cylinderHead", sigmaHeadMPa, mats.cylinderHead, cyclesThisTick);
    if (mats.block) accumulateDamage(state.damage, "block", sigmaBlockMPa, mats.block, cyclesThisTick);

    const viscosity = oilViscosity(state.oilTempC, th.oilViscosityEta0, th.oilViscosityAlpha, th.oilRefTempC);
    state.oilFilmOK = viscosity >= th.oilViscosityMinSafe;

    const qFriction = th.frictionCoeff * rpm * rpm * (viscosity / th.oilViscosityEta0);
    const qCombustion = (th.combustionHeatFraction + extraHeatFraction) * fuelEnergyRateW;
    const coolingEff = (0.3 + 0.7 * Math.min(1, rpm / redline)) * Math.max(0.4, densityRatio);
    const qCooling = th.coolingCoeff * (state.oilTempC - ambientC) * coolingEff;
    const qAmbient = th.ambientLossCoeff * (state.oilTempC - ambientC);
    const dOilTempK = (qFriction + qCombustion - qCooling - qAmbient) / (th.oilMassKG * th.oilSpecificHeatJPerKgK) * dt;
    state.oilTempC = Math.max(ambientC, state.oilTempC + dOilTempK);

    const components = [
      { id: "rod", stress: sigmaRodMPa, yield: yieldRod, sf: sfRod, damage: state.damage.rod },
      { id: "headBolt", stress: sigmaBoltMPa, yield: yieldBolt, sf: sfBolt, damage: state.damage.headBolt },
      { id: "pistonPin", stress: sigmaPinMPa, yield: yieldPin, sf: sfPin, damage: state.damage.pistonPin }
    ];
    if (mats.cylinderHead) components.push({ id: "cylinderHead", stress: sigmaHeadMPa, yield: yieldHead, sf: sfHead, damage: state.damage.cylinderHead });
    if (mats.block) components.push({ id: "block", stress: sigmaBlockMPa, yield: yieldBlock, sf: sfBlock, damage: state.damage.block });
    let weakest = components[0];
    for (const c of components) if (c.sf < weakest.sf) weakest = c;

    state.time += dt;
    state.cycles += cyclesThisTick;

    const dyn = state.engine.dynamics;
    const strokeM = eg.strokeMM / 1000;
    const seized = state.hydrolockFailure;
    const combustionTorqueNm = (inputs.cutIgnition || seized) ? 0 : forceN * (strokeM / 2) * 0.075 * (cyl / 2);
    const frictionTorqueNm = dyn.frictionTorqueBaseNm + dyn.frictionTorquePerRPM * rpm;

    const omega = Math.max(10, rpm * 2 * Math.PI / 60);
    let hybridTorqueNm = 0;
    if (state.hybridProfile) {
      const hp = state.hybridProfile;
      const capacityJ = hp.batteryCapacityKWh * 3.6e6;
      const socJ = state.batterySoC * capacityJ;
      const commandedKw = Math.max(-hp.maxHarvestKw, Math.min(hp.maxDeployKw, inputs.hybridDeployKw || 0));
      if (commandedKw > 0) {
        const wantJ = commandedKw * 1000 * dt;
        const availJ = Math.min(wantJ, socJ);
        hybridTorqueNm = (availJ / dt) / omega;
        state.batterySoC = Math.max(0, (socJ - availJ) / capacityJ);
      } else if (commandedKw < 0) {
        const wantJ = -commandedKw * 1000 * dt;
        const roomJ = capacityJ - socJ;
        const absorbedJ = Math.min(wantJ, roomJ);
        hybridTorqueNm = -(absorbedJ / dt) / omega;
        state.batterySoC = Math.min(1, (socJ + absorbedJ) / capacityJ);
      }
    }

    let loadTorqueNm, effectiveInertia, wheelSlipping = false;
    const dtInput = inputs.drivetrain;
    if (state.drivetrainProfile && dtInput && dtInput.gear > 0) {
      const dtp = state.drivetrainProfile;
      const gearRatio = dtp.gearRatios[dtInput.gear - 1] || dtp.gearRatios[dtp.gearRatios.length - 1];
      const overallRatio = gearRatio * dtp.finalDriveRatio;
      const wheelSpeedMS = Math.max(0, omega / overallRatio * dtp.wheelRadiusM);
      const prevSpeedMS = state.vehicleSpeedMS;

      const aeroDragN = 0.5 * rho * dtp.dragCoefficient * dtp.frontalAreaM2 * prevSpeedMS * prevSpeedMS;
      const rollingResN = dtp.rollingResistanceCoeff * dtp.vehicleMassKG * G;
      const gradeN = dtp.vehicleMassKG * G * Math.sin(Math.atan((dtInput.gradePercent || 0) / 100));
      const brakeN = (dtInput.brake01 || 0) * dtp.maxBrakeForceN;
      const resistiveForceN = aeroDragN + rollingResN + gradeN + brakeN;

      // Tire traction limit: the drive force the tires can put down without spinning.
      // Beyond this limit, the engine partially decouples from the full vehicle mass
      // (wheelspin) instead of feeling the load 1:1.
      const driveWheelTorqueWantedNm = combustionTorqueNm * overallRatio * dtp.drivetrainEfficiency;
      const maxTractionForceN = dtp.vehicleMassKG * G * (dtp.tireGripCoeff || 1.1) * (dtp.driveWeightFraction || 0.5);
      const maxTractionTorqueNm = maxTractionForceN * dtp.wheelRadiusM;
      const torqueExceedsGrip = driveWheelTorqueWantedNm > maxTractionTorqueNm;
      const wheelAheadOfCar = wheelSpeedMS > prevSpeedMS * 1.03 + 0.5;
      wheelSlipping = (torqueExceedsGrip || wheelAheadOfCar) && prevSpeedMS < (dtp.wheelspinMaxSpeedMS || 60);

      if (wheelSlipping) {
        loadTorqueNm = maxTractionTorqueNm / overallRatio / dtp.drivetrainEfficiency;
        effectiveInertia = dyn.rotatingInertiaKgM2 + (dtp.drivetrainInertiaKgM2 || 0.05);
        const netForceN = maxTractionForceN - resistiveForceN;
        state.vehicleSpeedMS = Math.max(0, prevSpeedMS + (netForceN / dtp.vehicleMassKG) * dt);
      } else {
        loadTorqueNm = (resistiveForceN * dtp.wheelRadiusM / overallRatio) / Math.max(0.85, dtp.drivetrainEfficiency);
        effectiveInertia = dyn.rotatingInertiaKgM2 + dtp.vehicleMassKG * Math.pow(dtp.wheelRadiusM / overallRatio, 2);
        state.vehicleSpeedMS = wheelSpeedMS;
      }
    } else if (state.drivetrainProfile && dtInput) {
      loadTorqueNm = 0; // Leerlauf/Neutral: Motor dreht frei gegen Eigenreibung
      effectiveInertia = dyn.rotatingInertiaKgM2;
      state.vehicleSpeedMS = 0;
    } else {
      loadTorqueNm = dyn.dynoLoadCoeffNmPerRPM2 * rpm * rpm;
      effectiveInertia = dyn.rotatingInertiaKgM2;
    }

    const netTorqueNm = combustionTorqueNm - frictionTorqueNm - loadTorqueNm + hybridTorqueNm;
    const angularAccelRadS2 = netTorqueNm / effectiveInertia;
    const newRpm = rpm + angularAccelRadS2 * (60 / (2 * Math.PI)) * dt;
    state.rpm = Math.max(seized ? 0 : 300, Math.min(state.engine.revLimiterRPM * 1.05, newRpm));

    const brakeTorqueNm = Math.max(0, combustionTorqueNm - frictionTorqueNm);
    const powerHp = (brakeTorqueNm * rpm) / 7127;
    const powerKw = (brakeTorqueNm * rpm * 2 * Math.PI) / 60000;

    const result = {
      time: state.time,
      cycles: state.cycles,
      rpm, boostBar: state.boostBar,
      cylinderPressureBar, afr,
      brakeTorqueNm, powerHp, powerKw,
      oilTempC: state.oilTempC, chamberTempC: state.chamberTempC,
      oilFilmOK: state.oilFilmOK, oilViscosity: viscosity,
      knockDetected: state.knockDetected, knockLimitBar: knockLimit,
      components, weakestLink: weakest,
      airDensity: rho, iatK,
      vehicleSpeedMS: state.vehicleSpeedMS, wheelSlipping,
      nitrousActive, nitrousRemainingKg: state.nitrousRemainingKg,
      batterySoC: state.batterySoC,
      hydrolockFailure: state.hydrolockFailure
    };
    state.lastResult = result;
    return result;
  }

  function accumulateDamage(damageObj, key, sigmaMPa, matDef, cycles) {
    const sigmaRef = matDef.yieldStrengthMPa * 0.5;
    if (sigmaMPa < 1e-3) return;
    const nf = matDef.snCurveRefCyclesN0 * Math.pow(sigmaRef / sigmaMPa, matDef.snCurveExponentB);
    damageObj[key] += cycles / Math.max(1, nf);
  }

  root.OEL = root.OEL || {};
  root.OEL.Engine = {
    createState, resetFailure, step,
    pistonAreaMM2, airDensityKgM3, baroAtAltitude, volumetricEfficiency,
    oilViscosity, thermalDerationFactor, knockLimitBar
  };
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : global));
