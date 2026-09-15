# OpenEngineLab

**A browser-based, open-source engine physics simulator and tuning workbench for motorsport applications.**

OpenEngineLab is a client-side engine simulation tool designed for engineers, enthusiasts, and motorsport professionals across Formula 1, WEC endurance racing, WRC/Dakar rallying, Top Fuel drag racing, and hillclimb/slalom disciplines. The simulator performs real-time thermodynamic, mechanical, and structural analysis to identify failure points (the "weakest link") and predict component breakdown under extreme operating conditions.

All calculations execute locally in the browser with zero server dependencies, enabling instant feedback and offline-first usability.

---

## Table of Contents

1. [Key Features](#key-features)
2. [Architecture Overview](#architecture-overview)
3. [User Interface](#user-interface)
4. [Physics Model & Calculations](#physics-model--calculations)
5. [Discipline-Specific Modules](#discipline-specific-modules)
---

## Key Features

### Core Physics & Mechanics
- **Combustion Force & Stress Analysis:** Real-time derivation of mechanical stresses from combustion pressure ($F = p \cdot A$), normal stress calculation ($\sigma = \frac{F}{S}$), and material yield-strength comparison.
- **Weakest-Link Detection:** Automatic structural failure prediction by identifying components approaching or exceeding material yield limits.
- **Thermal Management:** Lumped-capacitance energy balance tracking oil, coolant, and combustion chamber temperatures with real-time degradation modeling.
- **Thermal-Structural Coupling:** Dynamic material property changes (yield strength reduction, thermal stress introduction) as engine temperatures rise.

### Engine Control & Calibration
- **Virtual ECU (vECU):** 2D/3D lookup tables for ignition timing and fuel delivery with bilinear interpolation across engine speed/load operating points.
- **Closed-Loop Boost Regulation:** Dynamic wastegate control to track target boost pressures under transient load conditions.
- **Safety & Protection Logic:** Automatic rev limiters, knock-induced ignition retard, and thermal/pressure-based load reduction.
- **Transient Fuel Compensation:** Acceleration enrichment and wall-wetting dynamics during rapid throttle transitions.

### Environmental & Operating Conditions
- **Density Altitude & Air Properties:** Dynamic air density calculation accounting for ambient temperature, barometric pressure, and humidity.
- **Turbocharger & Intercooler Efficiency:** Pressure ratio and intake air temperature (IAT) scaling based on ambient and coolant conditions.
- **Track Duty Cycles:** Modular transient simulation with real-world sector data (gradient, throttle %, gear, resistance factors).
- **Fuel Systems & Chemistry:** Support for 15+ fuel grades (Super E10, 98 RON, 116-octane race gas, E85, methanol, nitromethane) with stoichiometric ratios, octane ratings, and energy density profiles.

### Ignition & Detonation
- **Knock Limit Boundary:** Real-time detonation risk tracking based on fuel octane, compression ratio, chamber temperature, and IAT.
- **Ignition Advance Simulation:** Peak cylinder pressure and efficiency sensitivity to ignition timing relative to Top Dead Center (TDC).
- **Pre-Ignition & Failure Integration:** Knock events and glow-ignition sequences directly incorporated into weakest-link structural analysis.

### Oil & Lubrication
- **Viscosity Degradation:** Real-time oil film stability and dynamic viscosity tracking as temperatures exceed operating limits.
- **Bearing Integrity:** Oil pressure and flow monitoring with failure prediction on starvation or thermal breakdown.
- **Failure Cascade:** Oil system breakdown directly linked to connecting-rod seizure and journal scoring alerts.

### Data Architecture
- **Modular JSON Schema:** Engine profiles, turbochargers, exhausts, fuel databases, gearboxes, and track configurations stored as independent, version-controllable files.
- **Client-Side Execution:** Pure JavaScript/HTML5 with zero external database or server dependencies.
- **GitHub-Native Workflow:** Direct contributions via pull requests; community-maintained part libraries.

---

## Architecture Overview

### Hosting & Deployment
- **GitHub Pages Static Hosting:** No server infrastructure, database, or authentication required.
- **Single-Page Application (SPA):** Complete browser execution with progressive enhancement for older browsers.
- **Offline-First:** Full functionality available without internet connectivity; JSON data files cached locally.

### Repository Structure

```
openenginelab/
├── README.md                          # This file
├── LICENSE                            # MIT or equivalent
├── index.html                         # Main entry point & UI container
├── js/
│   ├── engine.js                      # Core physics calculations (1500+ lines)
│   ├── ui.js                          # UI state management & event handling
│   ├── renderer.js                    # SVG schematic & visualization
│   ├── ecm.js                         # Virtual ECU map interpolation
│   └── worker.js                      # Web Worker for background simulation
├── data/
│   ├── engines/                       # Engine profile database
│   │   ├── 1.8t-fsi.json
│   │   ├── ls9-v8.json
│   │   ├── 2jz-gte.json
│   │   └── ...
│   ├── parts/
│   │   ├── turbos/
│   │   │   ├── ko3.json
│   │   │   ├── garrett-gt28rs.json
│   │   │   └── ...
│   │   ├── exhausts/
│   │   │   ├── stock.json
│   │   │   ├── sports-cat.json
│   │   │   └── ...
│   │   └── compressors/               # Supercharger profiles (Top Fuel)
│   │       ├── whipple-v6.json
│   │       └── ...
│   ├── fuels/
│   │   ├── pump-fuels.json            # E10, 98 RON, 102 RON
│   │   ├── racing-fuels.json          # 116 Oct, E85, methanol, nitromethane
│   │   └── fuel-profiles.json
│   ├── tracks/
│   │   ├── monza.json                 # F1 circuits
│   │   ├── le-mans.json               # WEC endurance
│   │   ├── wales-rally.json           # WRC stages
│   │   ├── bonneville-salt-flats.json # Drag strips
│   │   └── ... 
│   └── presets/
│       ├── discipline-f1.json         # F1-specific constraints
│       ├── discipline-wec.json        # WEC hybrid & fuel-flow limits
│       ├── discipline-wrc.json        # Rally autonomy & vibration
│       ├── discipline-drag.json       # Top Fuel/Top Methanol setups
│       └── discipline-hill.json       # Hillclimb thermal constraints
├── css/
│   └── style.css                      # Responsive UI styling
├── docs/
│   ├── physics-model.md               # Detailed calculation formulas
│   ├── quickstart.md                  # User walkthrough
│   ├── ecm-tuning-guide.md            # ECU mapping tutorial
│   ├── contributing.md                # Development guidelines
│   └── formula-reference.md           # Mathematical notation & SI units
└── tests/
    ├── physics-tests.js               # Unit tests for engine.js
    └── validation-cases.json          # Known-good simulation results
```

### Technology Stack
- **Frontend:** HTML5, CSS3, vanilla JavaScript (no framework dependencies for core functionality)
- **Visualization:** uPlot (time-series plotting), native SVG (engine schematic), HTML5 Canvas (optional 3D kennfield)
- **Data Format:** JSON (all configuration data), CSV (export logs)
- **Web APIs:** Web Workers (background calculation), LocalStorage (preset caching), Fetch API (JSON loading)
- **Performance:** Hardware-accelerated rendering, adaptive timestep simulation, memoization of thermodynamic lookups

---

## User Interface

### Layout & Workflow
The UI is organized into five interactive regions:

#### Left Sidebar — Input & Control Panel
- Engine selection dropdown with quick presets (fuel, turbo, exhaust, discipline).
- Precision numerical input fields: bore, stroke, rod length, boost pressure, compression ratio, track altitude.
- Interactive sliders for real-time parameter sweeps: throttle %, gear, ambient temperature, barometric pressure.
- JSON file import (drag-and-drop or file browser).

#### Center Viewport — Dynamic Engine Schematic
- **Procedural SVG Rendering:** Engine topology (I4, V6, V8, Boxer, etc.) generated mathematically from `engine_profile.json`.
- **Real-Time Stress Heatmap:**
  - **Green:** Safe operating margin ($\sigma < 0.7 \times \sigma_{\text{yield}}$).
  - **Yellow/Orange:** Approaching limits (0.7–1.0× yield).
  - **Pulsing Red:** Material yield exceeded or imminent failure. Pulse frequency = margin-to-fracture rate.
- **Interactive Tooltips:** Hover over components to view real-time stress, temperature, pressure, and failure predictions.
- **Zoom & Pan:** Full navigation of complex engine layouts.

#### Right Sidebar — Live Data & Metrics
- **Time-Series Plots (uPlot):** Simultaneous display of up to 8 quantities (RPM, boost, oil temp, peak cylinder pressure, fuel AFR, etc.) with auto-scaling.
- **Real-Time Statistics:** Min/max/mean values over current simulation window.
- **Historical Traces:** Optional overlay of last 5–10 simulation cycles to visualize stress variability.
- **Export Button:** Download logged data as CSV for external analysis.

#### Bottom Status Bar
- Simulation state indicator (running, paused, error).
- Current cycle count and simulation time.
- **Weakest-Link Alert:** "Connecting Rod @ 1.15× yield — Failure in 3 cycles."
- Emergency stop button (hard reset to safe default).

#### Top Navigation & Mode Toggles
- **Schematic View:** Engine diagram with stress heatmap (default).
- **Thermal View:** Temperature distribution across oil galleries and combustion chamber.
- **Pressure Map:** Spatial pressure spikes by cylinder and boost circuit.
- **Fatigue Accumulation:** S-N curve progress and Miner-sum damage (WEC/Rally only).
- **Kennfield View:** 2D/3D ignition timing and fuel delivery maps with operating-point marker.
- **Report Preview:** Pre-formatted PDF/HTML export with charts and analysis.

### Accessibility
- Full keyboard navigation (Tab, arrow keys, Enter).
- ARIA labels and semantic HTML for screen reader support.
- High-contrast mode for visually impaired users.
- Adjustable font sizing without layout breakage.

---

## Physics Model & Calculations

### 1. Combustion & Structural Analysis
**Force Derivation:**
$$F = p \cdot A$$
where $p$ is instantaneous combustion pressure (bar) and $A$ is effective piston area (mm²).

**Stress Calculation:**
$$\sigma = \frac{F}{S}$$
where $S$ is component cross-sectional area (mm²).

**Yield Comparison:**
$$SF = \frac{\sigma_{\text{yield}}}{\sigma_{\text{computed}}}$$
Components with $SF < 1.0$ are flagged for imminent failure.

### 2. Thermal Management
**Oil Temperature Evolution (Lumped Capacitance):**
$$\frac{dT_{\text{oil}}}{dt} = \frac{Q_{\text{friction}} + Q_{\text{combustion}} - Q_{\text{cooling}} - Q_{\text{ambient}}}{m_{\text{oil}} \cdot c_p}$$
- $Q_{\text{friction}}$ = viscous drag losses in bearing films.
- $Q_{\text{cooling}}$ = convective heat rejection via radiator (dependent on vehicle speed $v_{\text{veh}}$).
- $Q_{\text{ambient}}$ = conductive losses through engine block and air.

**Viscosity Degradation:**
$$\eta(T) = \eta_0 \cdot e^{\alpha(T - T_0)}$$
where viscosity decays exponentially above operating temperature. Below critical viscosity $\eta_{\text{min}}$, bearing film rupture is predicted.

### 3. Air Density & Altitude
**Density Altitude Calculation:**
$$\rho = \frac{p}{R_{\text{air}} \cdot T}$$
accounting for barometric pressure $p$ (bar), ambient temperature $T$ (K), and gas constant $R_{\text{air}}$.

**Volumetric Efficiency:**
$$\eta_v = \eta_v^{\text{base}} \cdot \frac{\rho}{\rho_{\text{ref}}}$$
Power output scales linearly with air density, reducing significantly at high altitude or hot conditions.

### 4. Ignition Timing & Knock Limit
**Detonation Boundary (Octane-Dependent):**
$$p_{\text{knock}} = f(\text{RON/AKI}, T_{\text{chamber}}, \text{IAT}, CR)$$
Real-time knock margin calculated. If combustion pressure exceeds $p_{\text{knock}}$, a detonation event is logged and immediate ignition retard is applied to prevent engine damage.

### 5. Fuel & Energy Balance
**Air-Fuel Ratio (AFR):**
$$\text{AFR} = \frac{\dot{m}_{\text{air}}}{\dot{m}_{\text{fuel}}}$$
Stoichiometric ratio $\text{AFR}_{\text{stoich}}$ retrieved from fuel profile (e.g., gasoline ≈ 14.7:1, methanol ≈ 6.4:1).

**Combustion Energy:**
$$E = \dot{m}_{\text{fuel}} \cdot \text{LHV}_{\text{fuel}}$$
where $\text{LHV}$ (lower heating value) is fuel-specific from database. Higher $E$ increases peak cylinder pressure and heat release rate.

### 6. Mechanical Stress Stacking (Supercharger/Top Fuel)
**Peak Pressure with Hydrolock Detection:**
$$p_{\text{peak}} = p_{\text{boost}} \cdot \epsilon^\kappa + p_{\text{fluid}}$$
where $\epsilon$ is compression ratio, $\kappa$ is heat capacity ratio (1.4 for air), and $p_{\text{fluid}}$ is residual incompressible fluid pressure at TDC. If $p_{\text{peak}}$ exceeds cylinder wall burst strength, hydrolock is flagged.

### 7. Fatigue & Accumulated Damage (Miner's Rule)
**S-N Curve Tracking:**
$$D = \sum \frac{n_i}{N_i}$$
where $n_i$ is cycle count at stress level $\sigma_i$ and $N_i$ is material S-N curve limit at that stress. Failure predicted when $D \geq 1.0$.

---

## Discipline-Specific Modules

### Formula 1 / WEC — Hybrid Energy & Fuel Flow Regulation
- **Fuel Flow Limiter:** Hard regulatory ceiling on fuel mass flow ($\dot{m}_{\text{fuel,max}} = 100$ kg/h in F1).
- **MGU-K Integration:** Additive electric motor torque deployment with state-of-charge (SOC) tracking (0–100%).
- **Energy Recuperation:** Regenerative braking during deceleration phases; energy balance per lap.
- **Pit-Lane Constraints:** MGU-K assist locked below pit-lane speed threshold ($v_{\text{trigger}} \approx 80$ km/h).
- **Miner Fatigue Accumulation:** Long-distance reliability prediction over 24-hour endurance races.

### Top Fuel Drag Racing — Extreme Transient & Supercharging
- **Roots Supercharger Model:** Direct crankshaft-driven compressor with parasitic drag ($P_{\text{mech}}$) subtracted from peak power.
- **Hydrolock Chain:** Incompressible fluid detection at TDC; glow-ignition pre-ignition risk assessment.
- **Cylinder Pressure Stacking:** Supercharger boost + residual combustion residuals stack into extreme peak pressures (>250 bar).
- **Multi-Disc Slipper Clutch:** Progressive engagement and thermal capacity modeling for launch control.

### WRC / Dakar Rally — Environmental Extremes & Endurance
- **Anti-Lag System (ALS):** Exhaust-tract energy management with secondary air injection; thermal shock simulation during water crossings.
- **Progressive Filter Clogging:** Air filter flow resistance increases over rally stage distance; volumetric efficiency degrades.
- **Extrinsic Shock Loads:** Chassis-induced vibration acceleration ($g_{\text{ext}}$) superimposed onto combustion forces in fatigue calculation.
- **Stage Fuel Autonomy:** Time-integrated fuel consumption tracking; remaining range alerts between service points.

### Hillclimb / Slalom — Thermal Limits & Transient Response
- **Vehicle-Speed-Coupled Cooling:** Radiator airflow efficiency drops to near-zero during stationary corners; severe heat soak during low-speed, high-load hairpins.
- **Angular Acceleration Gradients ($\frac{d\omega}{dt}$):** Transient inertia coupling to throttle rate; extreme RPM swings in low gears over short distances.
- **Density Altitude:** High-altitude Alpenrosengarten events; dynamic power loss calculation.

---

**OpenEngineLab — Engineer Your Limits.**
