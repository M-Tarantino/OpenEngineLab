/* OpenEngineLab :: js/report.js — session report (HTML, printable as PDF) */
(function (root) {
  "use strict";

  function statsOf(arr) {
    if (!arr.length) return { min: 0, max: 0, mean: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of arr) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, mean: sum / arr.length };
  }

  function chartImg(chart) {
    try {
      if (chart && chart.ctx && chart.ctx.canvas) return chart.ctx.canvas.toDataURL("image/png");
    } catch (e) { /* canvas may be empty — just skip the image */ }
    return null;
  }

  function componentLabel(id) {
    const keys = { rod: "compRod", headBolt: "compHeadBolt", pistonPin: "compPistonPin" };
    return OEL.I18N.t(keys[id] || id);
  }

  function generate(app) {
    const t = (k, v) => OEL.I18N.t(k, v);
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;
    const now = new Date();
    const h = app.history;
    const rpmS = statsOf(h.rpm), oilS = statsOf(h.oilTemp), pS = statsOf(h.cylPressure);
    const eg = app.profiles.engine.geometry;
    const last = app.lastResult || {};
    const comps = (last.components || []).map(c =>
      `<tr><td>${componentLabel(c.id)}</td><td>${c.stress.toFixed(1)}</td><td>${c.sf.toFixed(2)}</td><td>${(c.damage * 100).toFixed(5)}</td></tr>`
    ).join("");
    const imgA = chartImg(app.chartA), imgB = chartImg(app.chartB);

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t("reportTitle")}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:760px;margin:40px auto;padding:0 20px;}
  h1{font-size:1.5rem;border-bottom:2px solid #1a1a1a;padding-bottom:8px;}
  h2{font-size:1.1rem;margin-top:28px;border-bottom:1px solid #999;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:0.9rem;}
  td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;}
  th{background:#f0f0f0;}
  img{max-width:100%;margin-top:10px;border:1px solid #ccc;}
  .meta{color:#555;font-size:0.85rem;}
  .print-btn{position:fixed;top:16px;right:16px;padding:8px 16px;font-size:0.9rem;cursor:pointer;}
  @media print { .print-btn{display:none;} body{margin:0;} }
</style></head><body>
<button class="print-btn" onclick="window.print()">${t("reportSavePdf")}</button>
<h1>${t("reportTitle")}</h1>
<p class="meta">${t("reportCreated")}: ${now.toLocaleString()}</p>

<h2>${t("reportEngineConfig")}</h2>
<table>
  <tr><th>${t("bore")}</th><td>${eg.boreMM} mm</td></tr>
  <tr><th>${t("stroke")}</th><td>${eg.strokeMM} mm</td></tr>
  <tr><th>${t("rodLength")}</th><td>${eg.rodLengthMM} mm</td></tr>
  <tr><th>${t("compressionRatio")}</th><td>${eg.compressionRatio}:1</td></tr>
  <tr><th>${t("fuel")}</th><td>${(app.profiles.fuels.find(f => f.id === app.controls.activeFuelId) || {}).name || "—"}</td></tr>
</table>

<h2>${t("reportStats")}</h2>
<table>
  <tr><th></th><th>Min</th><th>Ø</th><th>Max</th></tr>
  <tr><td>${t("rpmUnit")}</td><td>${rpmS.min.toFixed(0)}</td><td>${rpmS.mean.toFixed(0)}</td><td>${rpmS.max.toFixed(0)}</td></tr>
  <tr><td>${t("oilTempLabel")} °C</td><td>${oilS.min.toFixed(0)}</td><td>${oilS.mean.toFixed(0)}</td><td>${oilS.max.toFixed(0)}</td></tr>
  <tr><td>${t("cylPressureLabel")} bar</td><td>${pS.min.toFixed(0)}</td><td>${pS.mean.toFixed(0)}</td><td>${pS.max.toFixed(0)}</td></tr>
</table>

<h2>${t("reportWeakest")}</h2>
<table>
  <tr><th></th><th>σ (MPa)</th><th>SF</th><th>D (%)</th></tr>
  ${comps}
</table>

${imgA ? `<h2>${t("telemetry")} A</h2><img src="${imgA}">` : ""}
${imgB ? `<h2>${t("telemetry")} B</h2><img src="${imgB}">` : ""}
</body></html>`);
    win.document.close();
  }

  root.OEL = root.OEL || {};
  root.OEL.Report = { generate };
})(typeof window !== "undefined" ? window : global);
