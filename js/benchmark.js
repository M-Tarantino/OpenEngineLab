/* OpenEngineLab :: js/benchmark.js — standardized WOT sweep runner (single source of truth for all dyno-style tests) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  const DT = 0.01;                 // fixed simulation step in seconds
  const HOLD_S = 1.5;              // full-throttle spool-up at the start rpm before the recorded sweep begins
  const DEFAULT_SWEEP_RATE = 500;  // rpm per second during the recorded sweep
  const MAX_DURATION_S = 60;       // hard safety limit for one run
  const DEFAULT_DRIVELINE_LOSS_PCT = 15; // typical drivetrain loss between crank and wheels
  const PS_PER_HP = 1.01387;       // metric horsepower (PS) per mechanical horsepower (hp, 745.7 W)

  function hpToPs(hp) { return hp * PS_PER_HP; }

  /**
   * Creates a stepwise WOT sweep run. The engine speed is prescribed (inertia-dyno style):
   * a spool-up hold at the start rpm, then a linear rpm ramp up to redline. Torque, power,
   * thermals and stress are measured by the engine model at every point of the ramp.
   *
   * setup: {
   *   engine, turbo, fuel, extras,                     // profile objects (engine already mod-resolved)
   *   boostTargetBar, ambientC, baroBar,               // optional
   *   startRpm, endRpm, sweepRateRpmPerS,              // optional
   *   drivelineLossPct                                 // optional, 0-60, default 15 (crank power -> wheel power)
   * }
   *
   * Returned run object:
   *   run.step()   advances one fixed step and returns the latest sample (also during the spool-up hold)
   *   run.done     true once the sweep reached its end rpm or the run failed
   *   run.series   recorded sweep samples only
   *   run.peak     peak figures over the recorded sweep
   *   run.config   resolved parameters (startRpm, endRpm, rate, dt, boostTargetBar, ...)
   */
  function createSweepRun(setup) {
    const engine = setup.engine;
    const turbo = setup.turbo;
    const maxBoostBar = turbo && turbo.limits && Number.isFinite(turbo.limits.maxBoostBar) ? turbo.limits.maxBoostBar : 0;
    const boostTargetBar = Math.max(0, Math.min(
      Number.isFinite(setup.boostTargetBar) ? setup.boostTargetBar : maxBoostBar,
      maxBoostBar
    ));

    const idleRpm = Number.isFinite(engine.idleRPM) ? engine.idleRPM : 800;
    const startRpm = Number.isFinite(setup.startRpm) ? setup.startRpm : Math.max(1500, Math.ceil((idleRpm * 1.5) / 100) * 100);
    let endRpm = Number.isFinite(setup.endRpm) ? setup.endRpm : (engine.redlineRPM || engine.revLimiterRPM || 7000);
    if (endRpm <= startRpm) endRpm = startRpm + 1000;
    const sweepRate = Number.isFinite(setup.sweepRateRpmPerS) && setup.sweepRateRpmPerS > 0 ? setup.sweepRateRpmPerS : DEFAULT_SWEEP_RATE;
    const ambientC = Number.isFinite(setup.ambientC) ? setup.ambientC : 20;
    const baroBar = Number.isFinite(setup.baroBar) ? setup.baroBar : 1.0;
    const drivelineLossPct = Math.min(60, Math.max(0, Number.isFinite(setup.drivelineLossPct) ? setup.drivelineLossPct : DEFAULT_DRIVELINE_LOSS_PCT));
    const wheelFactor = 1 - drivelineLossPct / 100;

    const state = OEL.Engine.createState(engine, turbo, setup.fuel, setup.extras || {});
    state.rpm = startRpm;
    const ecmState = OEL.ECM.createState();

    const peak = {
      powerHp: 0, powerHpRpm: 0, wheelPowerHp: 0, wheelPowerHpRpm: 0, brakeTorqueNm: 0, torqueRpm: 0,
      oilTempC: -Infinity, cylinderPressureBar: 0,
      knockMarginPercentMin: Infinity, weakestSfMin: Infinity, weakestId: null,
      knockDetected: false, failure: null, endRpm: startRpm
    };

    const run = {
      config: { dt: DT, holdS: HOLD_S, startRpm, endRpm, sweepRateRpmPerS: sweepRate, boostTargetBar, ambientC, baroBar, drivelineLossPct },
      state,
      series: [],
      peak,
      phase: "hold",
      timeS: 0,
      sweepTimeS: 0,
      done: false,
      latest: null,
      step
    };

    function finalizePeak() {
      if (!Number.isFinite(peak.oilTempC)) peak.oilTempC = state.oilTempC || 0;
      if (!Number.isFinite(peak.knockMarginPercentMin)) peak.knockMarginPercentMin = 100;
      if (!Number.isFinite(peak.weakestSfMin)) peak.weakestSfMin = 99;
    }

    function step() {
      if (run.done) return run.latest;

      const sweeping = run.phase === "sweep";
      const targetRpm = sweeping ? Math.min(endRpm, startRpm + sweepRate * run.sweepTimeS) : startRpm;
      state.rpm = targetRpm;

      const ecmOut = OEL.ECM.computeCycle(ecmState, engine, turbo, {
        rpm: state.rpm, throttle01: 1.0, boostBar: state.boostBar, boostTargetBar,
        knockDetected: state.knockDetected, dt: DT, alsActive: false,
        nitrousArmed: false, nitrousBottleKg: state.nitrousRemainingKg
      });
      const result = OEL.Engine.step(state, DT, {
        throttle01: 1.0, ambientC, baroBar,
        boostCommandBar: ecmOut.boostCommandBar, ignitionAdvanceDeg: ecmOut.ignitionAdvanceDeg,
        cutIgnition: ecmOut.cutIgnition, nitrousActive: false, hybridDeployKw: 0, drivetrain: null
      });

      run.timeS += DT;

      if (Number.isNaN(state.rpm) || Number.isNaN(result.powerHp)) {
        peak.failure = "numeric";
        run.done = true;
        finalizePeak();
        return run.latest;
      }

      const knockMarginPercent = result.knockLimitBar > 0
        ? ((result.knockLimitBar - result.cylinderPressureBar) / result.knockLimitBar) * 100
        : 100;
      const sf = result.weakestLink && Number.isFinite(result.weakestLink.sf) ? result.weakestLink.sf : 99;

      const sample = {
        phase: run.phase,
        t: sweeping ? run.sweepTimeS : run.timeS - DT,
        rpm: result.rpm, boostBar: result.boostBar,
        powerHp: result.powerHp, wheelPowerHp: result.powerHp * wheelFactor, brakeTorqueNm: result.brakeTorqueNm,
        oilTempC: result.oilTempC, cylinderPressureBar: result.cylinderPressureBar,
        knockMarginPercent, knockDetected: !!state.knockDetected,
        weakestSf: sf, weakestId: result.weakestLink ? result.weakestLink.id : null
      };
      run.latest = sample;

      if (!sweeping) {
        // Spool-up hold is not recorded; switch to the sweep once the hold time has elapsed
        if (run.timeS >= HOLD_S) run.phase = "sweep";
        return sample;
      }

      run.series.push(sample);
      if (result.powerHp > peak.powerHp) { peak.powerHp = result.powerHp; peak.powerHpRpm = result.rpm; }
      if (sample.wheelPowerHp > peak.wheelPowerHp) { peak.wheelPowerHp = sample.wheelPowerHp; peak.wheelPowerHpRpm = result.rpm; }
      if (result.brakeTorqueNm > peak.brakeTorqueNm) { peak.brakeTorqueNm = result.brakeTorqueNm; peak.torqueRpm = result.rpm; }
      if (result.oilTempC > peak.oilTempC) peak.oilTempC = result.oilTempC;
      if (result.cylinderPressureBar > peak.cylinderPressureBar) peak.cylinderPressureBar = result.cylinderPressureBar;
      if (knockMarginPercent < peak.knockMarginPercentMin) peak.knockMarginPercentMin = knockMarginPercent;
      if (sf < peak.weakestSfMin) { peak.weakestSfMin = sf; peak.weakestId = sample.weakestId; }
      if (state.knockDetected) peak.knockDetected = true;
      peak.endRpm = result.rpm;

      run.sweepTimeS += DT;

      if (state.hydrolockFailure) peak.failure = "hydrolock";
      else if (sf < 1.0) peak.failure = "structural";

      if (peak.failure || targetRpm >= endRpm || run.timeS >= MAX_DURATION_S) {
        run.done = true;
        finalizePeak();
      }
      return sample;
    }

    return run;
  }

  /**
   * Runs a complete standardized WOT sweep and returns the recorded series plus peak figures.
   * Used by the Dyno Test, Comparison Mode and the Realism Check without touching the live
   * Web Worker simulation. The live Dyno v2 view steps the very same core, so all of them
   * report identical numbers for an identical setup.
   *
   * Returns: {
   *   series: [{ t, rpm, boostBar, powerHp (bhp at the crank), wheelPowerHp (whp), brakeTorqueNm, oilTempC, cylinderPressureBar,
   *              knockMarginPercent, knockDetected, weakestSf, weakestId }],
   *   peak: {
   *     powerHp, powerHpRpm, wheelPowerHp, wheelPowerHpRpm, brakeTorqueNm, torqueRpm, oilTempC, cylinderPressureBar,
   *     knockMarginPercentMin, weakestSfMin, weakestId, knockDetected,
   *     failure: null | "structural" | "hydrolock" | "numeric", endRpm
   *   }
   * }
   */
  function runWotBenchmark(setup) {
    const run = createSweepRun(setup);
    while (!run.done) run.step();
    return { series: run.series, peak: run.peak };
  }

  /**
   * Bins a benchmark series by RPM (averaging power/torque within each bin),
   * producing a clean power/torque-vs-RPM curve suitable for a dyno-style chart.
   */
  function binSeriesByRpm(series, binSizeRpm) {
    binSizeRpm = binSizeRpm || 100;
    const bins = {};
    for (const pt of series) {
      const bin = Math.round(pt.rpm / binSizeRpm) * binSizeRpm;
      if (!bins[bin]) bins[bin] = { rpmSum: 0, powerSum: 0, torqueSum: 0, n: 0 };
      const b = bins[bin];
      b.rpmSum += pt.rpm; b.powerSum += pt.powerHp; b.torqueSum += pt.brakeTorqueNm; b.n++;
    }
    const rpms = Object.keys(bins).map(Number).sort((a, b) => a - b);
    const rpmOut = [], powerOut = [], torqueOut = [];
    for (const r of rpms) {
      const b = bins[r];
      if (b.powerSum / b.n < 0.5) continue; // skip fuel-cut dead zones
      rpmOut.push(Math.round(b.rpmSum / b.n));
      powerOut.push(b.powerSum / b.n);
      torqueOut.push(b.torqueSum / b.n);
    }
    return { rpm: rpmOut, powerHp: powerOut, torqueNm: torqueOut };
  }

  OEL.Benchmark = { createSweepRun, runWotBenchmark, binSeriesByRpm, hpToPs, DEFAULT_DRIVELINE_LOSS_PCT };
})();
