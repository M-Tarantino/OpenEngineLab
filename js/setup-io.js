/* OpenEngineLab :: js/setup-io.js — .oel setup file save/load with version history (v2 extension) */
(function () {
  "use strict";
  const OEL = window.OEL || (window.OEL = {});
  const FORMAT_VERSION = "0.2.0";

  /**
   * Builds a serializable .oel setup object from the current app state,
   * appending a new entry to the version history.
   */
  function buildSetupObject(app, changeDescription) {
    const existing = app.setupMeta || null;
    const iterations = existing && existing.iterations ? existing.iterations.slice() : [];
    const nextV = iterations.length + 1;
    iterations.push({ v: nextV, date: new Date().toISOString(), change: changeDescription || "Saved" });

    const setup = {
      version: FORMAT_VERSION,
      metadata: {
        name: (existing && existing.name) || app.profiles.engine.name,
        created: (existing && existing.created) || new Date().toISOString(),
        iterations,
        currentVersion: nextV
      },
      config: {
        engineBase: app.profiles.engineBase,
        turbo: app.profiles.turbo,
        mods: app.mods,
        activeFuelId: app.controls.activeFuelId,
        boostTargetBar: app.controls.boostTargetBar,
        discipline: app.discipline
      }
    };
    return setup;
  }

  /** Serializes and triggers a browser download of the current setup as a .oel file. */
  function downloadSetup(app, changeDescription) {
    const setup = buildSetupObject(app, changeDescription);
    app.setupMeta = setup.metadata;

    const blob = new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (setup.metadata.name || "setup").replace(/[^a-z0-9\-_]+/gi, "_");
    a.href = url;
    a.download = `${safeName}_v${setup.metadata.currentVersion}.oel`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return setup;
  }

  /** Parses raw .oel JSON text, throwing if it doesn't look like a valid setup file. */
  function parseSetup(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data.config || !data.config.engineBase || !data.config.turbo) {
      throw new Error("Not a valid .oel setup file");
    }
    return data;
  }

  OEL.SetupIO = { buildSetupObject, downloadSetup, parseSetup, FORMAT_VERSION };
})();
