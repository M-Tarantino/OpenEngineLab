/* OpenEngineLab :: js/benchmark.js — standardized WOT benchmark runner (v2 extension) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  /**
   * Runs a standardized wide-open-throttle benchmark: a short warm-up at idle
   * throttle, then full throttle with the given boost target until the run
   * stabilizes. Used by Comparison Mode, the Realism Check, and anywhere else
   * that needs a single, repeatable run to extract peak figures from a setup
   * without touching the live Web Worker simulation.
   *
   * setup: {
   *   engine, turbo, fuel, extras,       // profile objects (engine already mod-resolved)
   *   boostTargetBar, durationS, ambientC, baroBar   // all optional
   * }
   *
   * Returns: {
   *   series: [{ t, rpm, boostBar, powerHp, brakeTorqueNm, oilTempC, cylinderPressureBar, knockMarginPercent }],
   *   peak: {
   *     powerHp, powerHpRpm, brakeTorqueNm, torqueRpm,
   *     oilTempC, cylinderPressureBar,
   *     knockMarginPercentMin, weakestSfMin, weakestId
   *   }
   * }
   */
  function runWotBenchmark(setup) {
    const dt = 0.02;
    const warmupS = 1.0;
    const durationS = setup.durationS || 12;
    const boostTargetBar = Math.min(
      setup.boostTargetBar != null ? setup.boostTargetBar : setup.turbo.limits.maxBoostBar,
      setup.turbo.limits.maxBoostBar
    );

    const state = OEL.Engine.createState(setup.engine, setup.turbo, setup.fuel, setup.extras || {});
    const ecmState = OEL.ECM.createState();

    const series = [];
    const peak = {
      powerHp: 0, powerHpRpm: 0, brakeTorqueNm: 0, torqueRpm: 0,
      oilTempC: -Infinity, cylinderPressureBar: 0,
      knockMarginPercentMin: Infinity, weakestSfMin: Infinity, weakestId: null
    };

    const totalTicks = Math.round((warmupS + durationS) / dt);
    for (let i = 0; i < totalTicks; i++) {
      const t = i * dt;
      const throttle01 = t < warmupS ? 0.15 : 1.0;
      const target = t < warmupS ? 0 : boostTargetBar;

      const ecmOut = OEL.ECM.computeCycle(ecmState, setup.engine, setup.turbo, {
        rpm: state.rpm, throttle01, boostBar: state.boostBar, boostTargetBar: target,
        knockDetected: state.knockDetected, dt, alsActive: false,
        nitrousArmed: false, nitrousBottleKg: state.nitrousRemainingKg
      });
      const result = OEL.Engine.step(state, dt, {
        throttle01,
        ambientC: setup.ambientC != null ? setup.ambientC : 20,
        baroBar: setup.baroBar != null ? setup.baroBar : 1.0,
        boostCommandBar: ecmOut.boostCommandBar, ignitionAdvanceDeg: ecmOut.ignitionAdvanceDeg,
        cutIgnition: ecmOut.cutIgnition, nitrousActive: false, hybridDeployKw: 0, drivetrain: null
      });

      if (Number.isNaN(state.rpm)) break;

      const knockMarginPercent = result.knockLimitBar > 0
        ? ((result.knockLimitBar - result.cylinderPressureBar) / result.knockLimitBar) * 100
        : 100;

      if (t >= warmupS) {
        series.push({
          t: +(t - warmupS).toFixed(2), rpm: result.rpm, boostBar: result.boostBar,
          powerHp: result.powerHp, brakeTorqueNm: result.brakeTorqueNm,
          oilTempC: result.oilTempC, cylinderPressureBar: result.cylinderPressureBar,
          knockMarginPercent
        });

        if (result.powerHp > peak.powerHp) { peak.powerHp = result.powerHp; peak.powerHpRpm = result.rpm; }
        if (result.brakeTorqueNm > peak.brakeTorqueNm) { peak.brakeTorqueNm = result.brakeTorqueNm; peak.torqueRpm = result.rpm; }
        if (result.oilTempC > peak.oilTempC) peak.oilTempC = result.oilTempC;
        if (result.cylinderPressureBar > peak.cylinderPressureBar) peak.cylinderPressureBar = result.cylinderPressureBar;
        if (knockMarginPercent < peak.knockMarginPercentMin) peak.knockMarginPercentMin = knockMarginPercent;
        if (result.weakestLink.sf < peak.weakestSfMin) { peak.weakestSfMin = result.weakestLink.sf; peak.weakestId = result.weakestLink.id; }
      }
    }

    return { series, peak };
  }

  OEL.Benchmark = { runWotBenchmark };
})();
