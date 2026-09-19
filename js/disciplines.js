/* OpenEngineLab :: js/disciplines.js — discipline presets */
(function (root) {
  "use strict";

  const DISCIPLINES = {
    standard: {
      id: "standard", labelKey: "discStandard",
      panels: {}, driveMode: "dyno"
    },
    f1: {
      id: "f1", labelKey: "discF1",
      panels: { hybrid: true },
      driveMode: "vehicle",
      hybridProfilePath: "data/parts/hybrid/f1-ers-2026.json",
      drivetrainProfilePath: "data/drivetrain/6-speed-close-ratio.json",
      trackProfilePath: "data/tracks/circuit-lap-sample.json"
    },
    topfuel: {
      id: "topfuel", labelKey: "discTopFuel",
      panels: { nitrous: true },
      driveMode: "vehicle",
      nitrousProfilePath: "data/parts/nitrous/top-fuel-overfuel.json",
      drivetrainProfilePath: "data/drivetrain/6-speed-close-ratio.json",
      trackProfilePath: "data/tracks/drag-402m.json"
    },
    wrc: {
      id: "wrc", labelKey: "discWrc",
      panels: { als: true },
      driveMode: "vehicle",
      drivetrainProfilePath: "data/drivetrain/6-speed-close-ratio.json",
      trackProfilePath: "data/tracks/circuit-lap-sample.json"
    },
    hillclimb: {
      id: "hillclimb", labelKey: "discHillclimb",
      panels: { altitude: true },
      driveMode: "vehicle",
      drivetrainProfilePath: "data/drivetrain/6-speed-close-ratio.json",
      trackProfilePath: "data/tracks/hillclimb-sample.json"
    }
  };

  root.OEL = root.OEL || {};
  root.OEL.Disciplines = {
    list: ["standard", "f1", "topfuel", "wrc", "hillclimb"],
    get(id) { return DISCIPLINES[id] || DISCIPLINES.standard; }
  };
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : global));
