/* OpenEngineLab :: js/map-editor.js — Interactive Fuel/Ignition Map Editor */
(function (root) {
  "use strict";

  /**
   * MapEditor: Interactive 2D map editor with Expert/Easy modes
   * - Easy Mode: Edit entire RPM rows or Load columns at once
   * - Expert Mode: Edit individual cells with full precision
   * - Live Preview: Motor behavior updates in real-time
   * - Before/After: Compare original vs edited map
   * - Undo/Redo: 50-step history
   * - Reset: Back to original
   */

  function createEditor(containerId, mapType, originalMap, rpmAxis, loadAxis, onMapChange, labels) {
    labels = labels || {};
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container #${containerId} not found`);
      return null;
    }

    // Deep copy to allow undo/redo
    const editedMap = JSON.parse(JSON.stringify(originalMap));
    const editor = {
      mapType,
      originalMap,
      editedMap,
      rpmAxis,
      loadAxis,
      onMapChange,
      labels,
      mode: "easy", // "easy" | "expert"
      history: [JSON.parse(JSON.stringify(editedMap))],
      historyIndex: 0,
      hoveredCell: null,
      selectedRpmIdx: null,
      selectedLoadIdx: null
    };

    _buildUI(container, editor);
    return editor;
  }

  function _buildUI(container, editor) {
    container.innerHTML = "";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "16px";
    container.style.padding = "16px";
    container.style.backgroundColor = "#1a1a1a";
    container.style.borderRadius = "8px";
    container.style.color = "#fff";
    container.style.fontFamily = "JetBrains Mono, monospace";

    // Header: Title + Mode Toggle
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.borderBottom = "1px solid #444";
    header.style.paddingBottom = "8px";

    const title = document.createElement("h3");
    title.textContent = editor.labels.title || `${editor.mapType} Map Editor`;
    title.style.margin = "0";
    title.style.fontSize = "16px";
    title.style.fontWeight = "bold";
    header.appendChild(title);

    const modeToggle = document.createElement("div");
    modeToggle.style.display = "flex";
    modeToggle.style.gap = "8px";

    ["easy", "expert"].forEach(m => {
      const btn = document.createElement("button");
      btn.textContent = m.toUpperCase();
      btn.style.padding = "4px 12px";
      btn.style.border = "1px solid #666";
      btn.style.borderRadius = "4px";
      btn.style.backgroundColor = editor.mode === m ? "#FF6B35" : "#333";
      btn.style.color = "#fff";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "12px";
      btn.style.fontWeight = "bold";
      btn.onclick = () => {
        editor.mode = m;
        _buildUI(container, editor);
      };
      modeToggle.appendChild(btn);
    });

    header.appendChild(modeToggle);
    container.appendChild(header);

    // Controls: Undo/Redo/Reset
    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.flexWrap = "wrap";

    ["undo", "redo", "reset"].forEach(action => {
      const btn = document.createElement("button");
      btn.textContent = action.toUpperCase();
      btn.style.padding = "6px 12px";
      btn.style.border = "1px solid #555";
      btn.style.borderRadius = "4px";
      btn.style.backgroundColor = "#222";
      btn.style.color = "#aaa";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "12px";

      if (action === "undo") {
        btn.disabled = editor.historyIndex === 0;
        btn.onclick = () => _undo(editor, container);
      } else if (action === "redo") {
        btn.disabled = editor.historyIndex === editor.history.length - 1;
        btn.onclick = () => _redo(editor, container);
      } else if (action === "reset") {
        btn.onclick = () => {
          editor.editedMap = JSON.parse(JSON.stringify(editor.originalMap));
          editor.history = [JSON.parse(JSON.stringify(editor.editedMap))];
          editor.historyIndex = 0;
          _notifyChange(editor);
          _buildUI(container, editor);
        };
      }

      controls.appendChild(btn);
    });

    container.appendChild(controls);

    // Main Editor Area
    if (editor.mode === "easy") {
      _buildEasyMode(container, editor);
    } else {
      _buildExpertMode(container, editor);
    }

    // Comparison: Before/After
    _buildComparison(container, editor);
  }

  function _buildEasyMode(container, editor) {
    const section = document.createElement("div");
    section.style.display = "flex";
    section.style.gap = "24px";

    // Left: Edit by RPM row
    const rpmSection = document.createElement("div");
    rpmSection.style.flex = "1";
    rpmSection.innerHTML = "<h4 style='margin: 0 0 8px 0; color: #FF6B35; font-size: 13px;'>Edit by RPM Row</h4>";

    for (let loadIdx = 0; loadIdx < editor.loadAxis.length; loadIdx++) {
      const load = editor.loadAxis[loadIdx];
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.marginBottom = "8px";
      row.style.alignItems = "center";

      const label = document.createElement("span");
      label.textContent = `${load}%`;
      label.style.width = "40px";
      label.style.fontSize = "12px";
      label.style.color = "#aaa";
      row.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.value = editor.editedMap[loadIdx].map(v => v.toFixed(2)).join(", ");
      input.style.flex = "1";
      input.style.padding = "4px 8px";
      input.style.border = "1px solid #555";
      input.style.borderRadius = "4px";
      input.style.backgroundColor = "#222";
      input.style.color = "#fff";
      input.style.fontSize = "12px";
      input.style.fontFamily = "monospace";

      input.onchange = () => {
        const vals = input.value.split(",").map(v => {
          const n = parseFloat(v.trim());
          return isNaN(n) ? editor.editedMap[loadIdx][0] : n;
        });
        if (vals.length === editor.rpmAxis.length) {
          editor.editedMap[loadIdx] = vals;
          _pushHistory(editor);
          _notifyChange(editor);
          _buildUI(container, editor);
        } else {
          input.style.borderColor = "#ff6b35";
        }
      };
      row.appendChild(input);
      rpmSection.appendChild(row);
    }

    section.appendChild(rpmSection);

    // Right: Edit by Load column
    const loadSection = document.createElement("div");
    loadSection.style.flex = "1";
    loadSection.innerHTML = "<h4 style='margin: 0 0 8px 0; color: #FF6B35; font-size: 13px;'>Edit by Load Column</h4>";

    for (let rpmIdx = 0; rpmIdx < editor.rpmAxis.length; rpmIdx++) {
      const rpm = editor.rpmAxis[rpmIdx];
      const col = document.createElement("div");
      col.style.display = "flex";
      col.style.gap = "8px";
      col.style.marginBottom = "8px";
      col.style.alignItems = "center";

      const label = document.createElement("span");
      label.textContent = `${rpm} RPM`;
      label.style.width = "60px";
      label.style.fontSize = "12px";
      label.style.color = "#aaa";
      col.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      const colVals = editor.editedMap.map(row => row[rpmIdx]);
      input.value = colVals.map(v => v.toFixed(2)).join(", ");
      input.style.flex = "1";
      input.style.padding = "4px 8px";
      input.style.border = "1px solid #555";
      input.style.borderRadius = "4px";
      input.style.backgroundColor = "#222";
      input.style.color = "#fff";
      input.style.fontSize = "12px";
      input.style.fontFamily = "monospace";

      input.onchange = () => {
        const vals = input.value.split(",").map(v => {
          const n = parseFloat(v.trim());
          return isNaN(n) ? colVals[0] : n;
        });
        if (vals.length === editor.loadAxis.length) {
          for (let i = 0; i < editor.loadAxis.length; i++) {
            editor.editedMap[i][rpmIdx] = vals[i];
          }
          _pushHistory(editor);
          _notifyChange(editor);
          _buildUI(container, editor);
        } else {
          input.style.borderColor = "#ff6b35";
        }
      };
      col.appendChild(input);
      loadSection.appendChild(col);
    }

    section.appendChild(loadSection);
    container.appendChild(section);
  }

  function _buildExpertMode(container, editor) {
    const section = document.createElement("div");
    section.style.overflowX = "auto";
    section.style.overflowY = "auto";
    section.style.maxHeight = "400px";
    section.style.border = "1px solid #555";
    section.style.borderRadius = "4px";
    section.style.padding = "8px";
    section.style.backgroundColor = "#0a0a0a";

    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";
    table.style.fontSize = "11px";

    // Header row: RPM axes
    const headerRow = document.createElement("tr");
    const cornerCell = document.createElement("th");
    cornerCell.textContent = "Load\\RPM";
    cornerCell.style.padding = "4px";
    cornerCell.style.border = "1px solid #555";
    cornerCell.style.backgroundColor = "#222";
    cornerCell.style.color = "#aaa";
    cornerCell.style.textAlign = "center";
    headerRow.appendChild(cornerCell);

    for (const rpm of editor.rpmAxis) {
      const th = document.createElement("th");
      th.textContent = rpm;
      th.style.padding = "4px";
      th.style.border = "1px solid #555";
      th.style.backgroundColor = "#222";
      th.style.color = "#aaa";
      th.style.textAlign = "center";
      th.style.minWidth = "50px";
      headerRow.appendChild(th);
    }
    table.appendChild(headerRow);

    // Data rows
    for (let loadIdx = 0; loadIdx < editor.loadAxis.length; loadIdx++) {
      const tr = document.createElement("tr");

      const loadHeader = document.createElement("td");
      loadHeader.textContent = `${editor.loadAxis[loadIdx]}%`;
      loadHeader.style.padding = "4px";
      loadHeader.style.border = "1px solid #555";
      loadHeader.style.backgroundColor = "#222";
      loadHeader.style.color = "#aaa";
      loadHeader.style.fontWeight = "bold";
      loadHeader.style.textAlign = "center";
      tr.appendChild(loadHeader);

      for (let rpmIdx = 0; rpmIdx < editor.rpmAxis.length; rpmIdx++) {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.1";
        input.value = editor.editedMap[loadIdx][rpmIdx].toFixed(2);
        input.style.width = "100%";
        input.style.padding = "3px";
        input.style.border = "1px solid #444";
        input.style.borderRadius = "2px";
        input.style.backgroundColor = "#111";
        input.style.color = "#fff";
        input.style.textAlign = "center";
        input.style.fontSize = "11px";

        const originalVal = editor.originalMap[loadIdx][rpmIdx];
        const isChanged = Math.abs(editor.editedMap[loadIdx][rpmIdx] - originalVal) > 0.01;
        if (isChanged) {
          input.style.backgroundColor = "#1a3a1a";
          input.style.borderColor = "#6b9d6b";
        }

        input.onchange = () => {
          const val = parseFloat(input.value);
          if (!isNaN(val)) {
            editor.editedMap[loadIdx][rpmIdx] = val;
            _pushHistory(editor);
            _notifyChange(editor);
            _buildUI(container, editor);
          }
        };

        td.appendChild(input);
        td.style.padding = "2px";
        td.style.border = "1px solid #555";
        tr.appendChild(td);
      }

      table.appendChild(tr);
    }

    section.appendChild(table);
    container.appendChild(section);
  }

  function _buildComparison(container, editor) {
    const section = document.createElement("div");
    section.style.borderTop = "1px solid #444";
    section.style.paddingTop = "16px";
    section.style.marginTop = "16px";

    const title = document.createElement("h4");
    title.textContent = "Before / After";
    title.style.margin = "0 0 12px 0";
    title.style.fontSize = "13px";
    title.style.color = "#FF6B35";
    section.appendChild(title);

    const comparison = document.createElement("div");
    comparison.style.display = "grid";
    comparison.style.gridTemplateColumns = "1fr 1fr";
    comparison.style.gap = "12px";

    // Before
    const beforeDiv = document.createElement("div");
    beforeDiv.innerHTML = "<div style='font-size: 11px; color: #aaa; margin-bottom: 4px;'>ORIGINAL</div>";
    const beforeCanvas = document.createElement("canvas");
    beforeCanvas.width = 200;
    beforeCanvas.height = 150;
    beforeDiv.appendChild(beforeCanvas);
    comparison.appendChild(beforeDiv);
    _drawMiniMap(beforeCanvas, editor.originalMap, editor.rpmAxis, editor.loadAxis);

    // After
    const afterDiv = document.createElement("div");
    afterDiv.innerHTML = "<div style='font-size: 11px; color: #aaa; margin-bottom: 4px;'>EDITED</div>";
    const afterCanvas = document.createElement("canvas");
    afterCanvas.width = 200;
    afterCanvas.height = 150;
    afterDiv.appendChild(afterCanvas);
    comparison.appendChild(afterDiv);
    _drawMiniMap(afterCanvas, editor.editedMap, editor.rpmAxis, editor.loadAxis);

    section.appendChild(comparison);
    container.appendChild(section);
  }

  function _drawMiniMap(canvas, map, rpmAxis, loadAxis) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let min = Infinity, max = -Infinity;
    for (const row of map) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const cellW = canvas.width / rpmAxis.length;
    const cellH = canvas.height / loadAxis.length;

    for (let ly = 0; ly < loadAxis.length; ly++) {
      for (let lx = 0; lx < rpmAxis.length; lx++) {
        const v = map[ly][lx];
        const t = (v - min) / Math.max(1e-6, max - min);
        const r = Math.round(61 + (255 - 61) * t);
        const g = Math.round(220 + (46 - 220) * t);
        const b = Math.round(151 + (46 - 151) * t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(lx * cellW, ly * cellH, cellW, cellH);
      }
    }

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= rpmAxis.length; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellW, 0);
      ctx.lineTo(i * cellW, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i <= loadAxis.length; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * cellH);
      ctx.lineTo(canvas.width, i * cellH);
      ctx.stroke();
    }
  }

  function _undo(editor, container) {
    if (editor.historyIndex > 0) {
      editor.historyIndex--;
      editor.editedMap = JSON.parse(JSON.stringify(editor.history[editor.historyIndex]));
      _notifyChange(editor);
      _buildUI(container, editor);
    }
  }

  function _redo(editor, container) {
    if (editor.historyIndex < editor.history.length - 1) {
      editor.historyIndex++;
      editor.editedMap = JSON.parse(JSON.stringify(editor.history[editor.historyIndex]));
      _notifyChange(editor);
      _buildUI(container, editor);
    }
  }

  function _pushHistory(editor) {
    editor.history = editor.history.slice(0, editor.historyIndex + 1);
    editor.history.push(JSON.parse(JSON.stringify(editor.editedMap)));
    editor.historyIndex++;
    if (editor.history.length > 50) {
      editor.history.shift();
      editor.historyIndex--;
    }
  }

  function _notifyChange(editor) {
    if (editor.onMapChange) {
      editor.onMapChange(editor.editedMap);
    }
  }

  function getEditedMap(editor) {
    return editor.editedMap;
  }

  root.OEL = root.OEL || {};
  root.OEL.MapEditor = {
    createEditor,
    getEditedMap
  };
})(typeof window !== "undefined" ? window : global);