/* OpenEngineLab :: js/comparison.js — Comparison Mode: benchmark two setups and diff the results (v2 extension) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  const ROWS = [
    { key: "powerHp", labelKey: "cmpPeakPower", unit: "hp", betterWhen: "higher", tolerance: 1 },
    { key: "brakeTorqueNm", labelKey: "cmpPeakTorque", unit: "Nm", betterWhen: "higher", tolerance: 1 },
    { key: "oilTempC", labelKey: "cmpOilTempPeak", unit: "°C", betterWhen: "lower", tolerance: 1 },
    { key: "cylinderPressureBar", labelKey: "cmpCylPressurePeak", unit: "bar", betterWhen: "lower", tolerance: 0.5 },
    { key: "weakestSfMin", labelKey: "cmpWeakestSf", unit: "x", betterWhen: "higher", tolerance: 0.02 },
    { key: "knockMarginPercentMin", labelKey: "cmpKnockMargin", unit: "%", betterWhen: "higher", tolerance: 1 }
  ];

  /**
   * Runs the standard WOT benchmark against two loaded .oel setups and returns
   * a row-based diff structure ready for rendering.
   *
   * setupA/setupB: parsed .oel objects (see setup-io.js parseSetup)
   * fuelsById: { [fuelId]: fuelProfile } — the currently loaded fuel database,
   *   used to resolve each setup's activeFuelId back into a full fuel profile
   *
   * Returns: { rows: [...ROWS, {a, b, diff, direction}], resultA, resultB, setupNames: [nameA, nameB] }
   */
  function compareSetups(setupA, setupB, fuelsById) {
    function runOne(setup) {
      const fuel = fuelsById[setup.config.activeFuelId] || Object.values(fuelsById)[0];
      // Comparison Mode benchmarks the bare engine on a standard WOT pull;
      // discipline-specific extras (hybrid/nitrous/drivetrain) don't apply to
      // this dyno-style comparison, so every setup is judged on equal footing.
      return OEL.Benchmark.runWotBenchmark({
        engine: setup.config.engineBase, turbo: setup.config.turbo, fuel,
        extras: {}, boostTargetBar: setup.config.boostTargetBar
      });
    }

    const resultA = runOne(setupA);
    const resultB = runOne(setupB);

    const rows = ROWS.map(spec => {
      const a = resultA.peak[spec.key];
      const b = resultB.peak[spec.key];
      const diff = b - a;
      let direction = "neutral";
      if (Math.abs(diff) >= spec.tolerance) {
        const better = spec.betterWhen === "higher" ? diff > 0 : diff < 0;
        direction = better ? "better" : "worse";
      }
      return Object.assign({}, spec, { a, b, diff, direction });
    });

    return { rows, resultA, resultB, setupNames: [setupA.metadata.name, setupB.metadata.name] };
  }

  OEL.Comparison = { compareSetups, ROWS };
})();
