/* OpenEngineLab :: js/realism-check.js — post-simulation configuration plausibility checks (v2 extension) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  /**
   * Runs a set of plausibility checks against a benchmark's peak results and
   * the underlying engine/turbo configuration.
   *
   * Returns: { findings: [{ level: "ok"|"warn"|"critical", key, value }], overallLevel }
   */
  function checkRealism(engineProfile, turboProfile, benchmarkPeak) {
    const findings = [];
    const cr = engineProfile.geometry.compressionRatio;
    const boostBar = turboProfile.limits.maxBoostBar;

    // Compression ratio + boost combo: a crude "dynamic compression" proxy.
    // Real engines get into detonation trouble once static CR and boost both
    // climb together without matching octane/intercooling/timing changes.
    const effectiveCr = cr + boostBar * 2.2;
    if (effectiveCr > 16) {
      findings.push({ level: "critical", key: "realismCrBoostCritical", value: effectiveCr.toFixed(1) });
    } else if (effectiveCr > 13) {
      findings.push({ level: "warn", key: "realismCrBoostWarn", value: effectiveCr.toFixed(1) });
    } else {
      findings.push({ level: "ok", key: "realismCrBoostOk", value: effectiveCr.toFixed(1) });
    }

    // Weakest-link structural safety factor.
    if (benchmarkPeak.weakestSfMin < 1.0) {
      findings.push({ level: "critical", key: "realismStressCritical", value: benchmarkPeak.weakestSfMin.toFixed(2) });
    } else if (benchmarkPeak.weakestSfMin < 1.2) {
      findings.push({ level: "warn", key: "realismStressWarn", value: benchmarkPeak.weakestSfMin.toFixed(2) });
    } else {
      findings.push({ level: "ok", key: "realismStressOk", value: benchmarkPeak.weakestSfMin.toFixed(2) });
    }

    // Oil temperature versus this engine's own thermal derating threshold.
    const derationLimit = engineProfile.thermal.thermalDerationBaselineC;
    if (benchmarkPeak.oilTempC > derationLimit) {
      findings.push({ level: "critical", key: "realismOilCritical", value: benchmarkPeak.oilTempC.toFixed(0) });
    } else if (benchmarkPeak.oilTempC > derationLimit - 20) {
      findings.push({ level: "warn", key: "realismOilWarn", value: benchmarkPeak.oilTempC.toFixed(0) });
    } else {
      findings.push({ level: "ok", key: "realismOilOk", value: benchmarkPeak.oilTempC.toFixed(0) });
    }

    // Knock margin: negative means cylinder pressure exceeded the knock limit
    // at some point during the run.
    if (benchmarkPeak.knockMarginPercentMin < -15) {
      findings.push({ level: "critical", key: "realismKnockCritical", value: benchmarkPeak.knockMarginPercentMin.toFixed(0) });
    } else if (benchmarkPeak.knockMarginPercentMin < 0) {
      findings.push({ level: "warn", key: "realismKnockWarn", value: benchmarkPeak.knockMarginPercentMin.toFixed(0) });
    } else {
      findings.push({ level: "ok", key: "realismKnockOk", value: benchmarkPeak.knockMarginPercentMin.toFixed(0) });
    }

    const overallLevel = findings.some(f => f.level === "critical") ? "critical"
      : findings.some(f => f.level === "warn") ? "warn" : "ok";

    return { findings, overallLevel };
  }

  OEL.RealismCheck = { checkRealism };
})();
