/* OpenEngineLab :: js/chargers.js — combines up to 4 chargers (turbos, one supercharger) into one effective charger system */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});

  const MAX_SLOTS = 4;                 // total chargers in one system
  const REF_BARO_BAR = 1.01325;        // reference pressure for combining pressure ratios of series stages
  const LEGACY_BOOST_RATE = 3.2;       // 1/s, spool rate used when a turbo profile has no time constant
  const PARALLEL_LAG_EXPONENT = 0.5;   // calibration: lag grows with the number of parallel turbos (each gets 1/n of the exhaust)

  // id -> { hpMax, flowKgMin, source, ... } from data/catalog/charger-ratings.json
  let ratings = {};

  /** Installs the rating table (accepts the full file object or just its "ratings" map). */
  function setRatings(obj) {
    ratings = obj && obj.ratings ? obj.ratings : (obj || {});
  }

  /** "turbo" | "blower" | "none" for a profile object or a catalog type string. */
  function kindOf(profileOrType) {
    const raw = typeof profileOrType === "string" ? profileOrType : (profileOrType && profileOrType.type);
    const t = String(raw || "").toLowerCase();
    if (t === "turbocharger") return "turbo";
    if (t === "supercharger") return "blower";
    return "none";
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** Airflow capacity of one turbo in kg/min: catalog rating first, then an explicit profile value, else null. */
  function flowOf(profile) {
    const r = ratings[profile.id];
    if (r && Number.isFinite(r.flowKgMin) && r.flowKgMin > 0) return r.flowKgMin;
    const f = profile.compressor && profile.compressor.maxMassFlowKgMin;
    return Number.isFinite(f) && f > 0 ? f : null;
  }

  /**
   * Rules: 1 to 4 entries; "none" only as the single entry; at most one supercharger.
   * Returns { ok, error }.
   */
  function validate(list) {
    if (!Array.isArray(list) || list.length < 1) return { ok: false, error: "At least one charger entry is required" };
    if (list.length > MAX_SLOTS) return { ok: false, error: "A maximum of " + MAX_SLOTS + " chargers is supported" };
    const kinds = list.map(kindOf);
    if (kinds.indexOf("none") >= 0 && list.length > 1) return { ok: false, error: "'None' cannot be combined with other chargers" };
    if (kinds.filter((k) => k === "blower").length > 1) return { ok: false, error: "At most one supercharger can be fitted" };
    return { ok: true, error: null };
  }

  /** True if another charger slot may be added to this list. */
  function canAdd(list) {
    return Array.isArray(list) && list.length >= 1 && list.length < MAX_SLOTS && kindOf(list[0]) !== "none";
  }

  /**
   * True if a catalog entry (or profile) of the given type may occupy slot `index`:
   * "none" only when the list has a single slot, a supercharger only if no other slot holds one.
   */
  function slotAllows(list, index, profileOrType) {
    const kind = kindOf(profileOrType);
    if (kind === "none") return list.length === 1;
    if (kind === "blower") return !list.some((p, i) => i !== index && kindOf(p) === "blower");
    return true;
  }

  function turboLabel(turbos) {
    const counts = [];
    for (const t of turbos) {
      const hit = counts.find((c) => c.id === t.id);
      if (hit) hit.n++; else counts.push({ id: t.id, name: t.name || t.id, n: 1 });
    }
    return counts.map((c) => (c.n > 1 ? c.n + "× " : "") + c.name).join(" + ");
  }

  /**
   * Combines the charger list into ONE effective profile that engine.js, ecm.js, the benchmark,
   * the worker and the .oel files consume exactly like a single charger profile.
   *
   * - Turbos are parallel (common intake manifold): the lowest boost limit applies, spool time is the mean
   *   time constant scaled by n^0.5, airflow capacity adds up (only if every turbo has a rating).
   * - One supercharger alone is passed through unchanged.
   * - Supercharger + turbos = twincharge: the pressure ratios of the two stages multiply.
   */
  function combine(list) {
    const v = validate(list);
    if (!v.ok) throw new Error(v.error);

    const turbos = list.filter((p) => kindOf(p) === "turbo");
    const blowers = list.filter((p) => kindOf(p) === "blower");
    const members = list.map((p) => ({ id: p.id, name: p.name, kind: kindOf(p) }));

    if (turbos.length === 0) {
      const single = clone(list[0]);   // none or a lone supercharger keep their exact legacy behavior
      single.system = { members };
      return single;
    }

    const n = turbos.length;
    const taus = turbos.map((t) => {
      const x = t.dynamics && t.dynamics.timeConstantS;
      return Number.isFinite(x) && x > 0 ? x : 1 / LEGACY_BOOST_RATE;
    });
    const tauGroup = (taus.reduce((a, b) => a + b, 0) / n) * Math.pow(n, PARALLEL_LAG_EXPONENT);
    const flows = turbos.map(flowOf);
    const rated = flows.every((f) => f !== null);
    const group = {
      count: n,
      timeConstantS: tauGroup,
      boostRate: 1 / tauGroup,
      flowKgMin: rated ? flows.reduce((a, b) => a + b, 0) : null,
      unrated: turbos.filter((t, i) => flows[i] === null).map((t) => t.id)
    };
    const turboMaxBoost = Math.min.apply(null, turbos.map((t) => t.limits.maxBoostBar));

    const eff = clone(turbos[0]);
    eff.limits = Object.assign({}, eff.limits, { maxBoostBar: turboMaxBoost });
    eff.dynamics = Object.assign({}, eff.dynamics || {}, { timeConstantS: tauGroup });
    eff.group = group;
    eff.system = { members };

    if (blowers.length === 0) {
      eff.type = "turbocharger";
      eff.id = n === 1 ? turbos[0].id : "system:" + turbos.map((t) => t.id).join("+");
      eff.name = n === 1 ? turbos[0].name : turboLabel(turbos);
      return eff;
    }

    const blower = clone(blowers[0]);
    const prMax = (1 + turboMaxBoost / REF_BARO_BAR) * (1 + blower.limits.maxBoostBar / REF_BARO_BAR);
    eff.type = "twincharge";
    eff.id = "system:" + blower.id + "+" + turbos.map((t) => t.id).join("+");
    eff.name = "Twincharge: " + (blower.name || blower.id) + " + " + turboLabel(turbos);
    eff.blower = blower;
    eff.cooler = blower.cooler || eff.cooler;
    // Practical ceiling: the multiplied pressure ratio, but never more than the sum of both stage limits
    eff.limits.maxBoostBar = Math.min(REF_BARO_BAR * (prMax - 1), turboMaxBoost + blower.limits.maxBoostBar);
    return eff;
  }

  /** One-line summary of an effective charger system for the UI. */
  function describe(eff) {
    const type = String(eff && eff.type || "").toLowerCase();
    if (type === "none") return "Naturally aspirated";
    const maxBoost = eff.limits.maxBoostBar.toFixed(2);
    if (type === "supercharger") return "Supercharger · max boost " + maxBoost + " bar";
    const g = eff.group;
    const parts = [];
    parts.push(type === "twincharge" ? "Twincharge: supercharger + " + g.count + "× turbo" : g.count + "× turbo (parallel)");
    parts.push("max boost " + maxBoost + " bar");
    parts.push("spool τ " + g.timeConstantS.toFixed(2) + " s");
    parts.push(g.flowKgMin ? "airflow " + g.flowKgMin.toFixed(0) + " kg/min" : "airflow n/a (no rating)");
    return parts.join(" · ");
  }

  OEL.Chargers = {
    MAX_SLOTS, setRatings, kindOf, validate, canAdd, slotAllows, combine, describe, flowOf
  };
})();
