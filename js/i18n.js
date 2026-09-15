/* OpenEngineLab :: js/i18n.js — Mehrsprachigkeit (DE/EN/FR/ES) */
(function (root) {
  "use strict";

  const DE = {
    inputs: "Eingaben", bore: "Bohrung", stroke: "Hub", rodLength: "Pleuellänge",
    compressionRatio: "Verdichtung", boostTarget: "Ladedruck-Ziel", fuel: "Kraftstoff",
    transientParams: "Transiente Parameter", throttle: "Drosselklappe",
    ambientTemp: "Umgebungstemperatur", airPressure: "Luftdruck", altitude: "Höhe",
    importSection: "Import", importHint: "Motor- oder Turbo-JSON-Profil laden (Auto-Erkennung).",
    telemetry: "Telemetrie", stats: "Statistik (min / ø / max)",
    running: "LÄUFT", stopped: "GESTOPPT", weakestLink: "Weakest Link",
    knockWarning: "⚠ Klopfen erkannt — Zündung wird zurückgenommen",
    oilFilmWarning: "⚠ Ölfilm-Stabilität kritisch — Lagerschaden droht",
    overrunActive: "Schubabschaltung aktiv", alsFiring: "ALS aktiv",
    estop: "NOT-STOPP", tabSchematic: "Schema", tabKennfield: "Kennfeld",
    kennfieldIgnition: "Zündwinkel (° v. OT)", kennfieldFuel: "Kraftstoffmenge (mg/Zyklus)",
    compRod: "Pleuel", compHeadBolt: "Zylinderkopfschraube", compPistonPin: "Kolbenbolzen",
    tooltipFormat: "{label}: σ={stress} MPa | SF={sf} | Schaden D={damage}%",
    engineLoaded: "Motorprofil geladen: {name}", turboLoaded: "Turboprofil geladen: {name}",
    fuelDbLoaded: "Kraftstoffdatenbank geladen", unknownFormat: "Unbekanntes JSON-Format",
    importFailed: "Import fehlgeschlagen: {msg}",
    discipline: "Disziplin", discStandard: "Straße / Standard", discF1: "F1 / WEC Hybrid",
    discTopFuel: "Top-Fuel-Dragster", discWrc: "WRC-Rallye", discHillclimb: "Bergrennen",
    drivetrain: "Antriebsstrang", gear: "Gang", neutral: "Neutral", grade: "Gefälle/Steigung", wheelspin: "Durchdrehen",
    brake: "Bremse", speed: "Geschwindigkeit",
    track: "Streckenprofil", trackPlay: "Abspielen", trackPause: "Pause", trackStop: "Stopp",
    trackProgress: "Fortschritt",
    hybridPanel: "Hybrid-System (ERS)", batterySoC: "Batteriestand", ersDeploy: "Energie-Deploy",
    mguhActive: "MGU-H aktiv (verzögerungsfrei)",
    nitrousPanel: "Lachgas-System (N₂O)", nitrousArm: "Scharf schalten", nitrousBottle: "Flaschenfüllstand",
    nitrousActive: "N₂O AKTIV",
    alsPanel: "Anti-Lag-System (ALS)", alsEnable: "aktivieren",
    undo: "Rückgängig", redo: "Wiederholen",
    report: "Bericht erstellen", reportTitle: "OpenEngineLab — Sitzungsbericht",
    reportCreated: "Erstellt am", reportEngineConfig: "Motorkonfiguration", reportStats: "Betriebsstatistik",
    reportWeakest: "Schwachstellenanalyse", reportSavePdf: "Als PDF speichern",
    hydrolockBanner: "☠ HYDROLOCK — KATASTROPHALER MOTORSCHADEN", rebuildEngine: "Motor neu aufbauen",
    language: "Sprache", rpmUnit: "1/min"
  };

  const EN = {
    inputs: "Inputs", bore: "Bore", stroke: "Stroke", rodLength: "Rod Length",
    compressionRatio: "Compression", boostTarget: "Boost Target", fuel: "Fuel",
    transientParams: "Transient Parameters", throttle: "Throttle",
    ambientTemp: "Ambient Temperature", airPressure: "Air Pressure", altitude: "Altitude",
    importSection: "Import", importHint: "Load an engine or turbo JSON profile (auto-detected).",
    telemetry: "Telemetry", stats: "Statistics (min / avg / max)",
    running: "RUNNING", stopped: "STOPPED", weakestLink: "Weakest Link",
    knockWarning: "⚠ Knock detected — retarding ignition",
    oilFilmWarning: "⚠ Oil film stability critical — bearing damage imminent",
    overrunActive: "Overrun fuel cut active", alsFiring: "ALS active",
    estop: "E-STOP", tabSchematic: "Schematic", tabKennfield: "Map",
    kennfieldIgnition: "Ignition Timing (° BTDC)", kennfieldFuel: "Fuel Quantity (mg/cycle)",
    compRod: "Connecting Rod", compHeadBolt: "Head Bolt", compPistonPin: "Piston Pin",
    tooltipFormat: "{label}: σ={stress} MPa | SF={sf} | Damage D={damage}%",
    engineLoaded: "Engine profile loaded: {name}", turboLoaded: "Turbo profile loaded: {name}",
    fuelDbLoaded: "Fuel database loaded", unknownFormat: "Unknown JSON format",
    importFailed: "Import failed: {msg}",
    discipline: "Discipline", discStandard: "Road / Standard", discF1: "F1 / WEC Hybrid",
    discTopFuel: "Top Fuel Dragster", discWrc: "WRC Rally", discHillclimb: "Hillclimb",
    drivetrain: "Drivetrain", gear: "Gear", neutral: "Neutral", grade: "Grade", wheelspin: "Wheelspin",
    brake: "Brake", speed: "Speed",
    track: "Track Profile", trackPlay: "Play", trackPause: "Pause", trackStop: "Stop",
    trackProgress: "Progress",
    hybridPanel: "Hybrid System (ERS)", batterySoC: "Battery Charge", ersDeploy: "Energy Deploy",
    mguhActive: "MGU-H active (lag-free)",
    nitrousPanel: "Nitrous System (N₂O)", nitrousArm: "Arm system", nitrousBottle: "Bottle Level",
    nitrousActive: "N₂O ACTIVE",
    alsPanel: "Anti-Lag System (ALS)", alsEnable: "enable",
    undo: "Undo", redo: "Redo",
    report: "Generate Report", reportTitle: "OpenEngineLab — Session Report",
    reportCreated: "Created on", reportEngineConfig: "Engine Configuration", reportStats: "Operating Statistics",
    reportWeakest: "Weak-Point Analysis", reportSavePdf: "Save as PDF",
    hydrolockBanner: "☠ HYDROLOCK — CATASTROPHIC ENGINE FAILURE", rebuildEngine: "Rebuild Engine",
    language: "Language", rpmUnit: "rpm"
  };

  const FR = {
    inputs: "Entrées", bore: "Alésage", stroke: "Course", rodLength: "Longueur de bielle",
    compressionRatio: "Compression", boostTarget: "Pression cible", fuel: "Carburant",
    transientParams: "Paramètres transitoires", throttle: "Papillon des gaz",
    ambientTemp: "Température ambiante", airPressure: "Pression atmosphérique", altitude: "Altitude",
    importSection: "Import", importHint: "Charger un profil JSON moteur ou turbo (détection automatique).",
    telemetry: "Télémétrie", stats: "Statistiques (min / moy / max)",
    running: "EN MARCHE", stopped: "ARRÊTÉ", weakestLink: "Maillon Faible",
    knockWarning: "⚠ Cliquetis détecté — retard à l'allumage",
    oilFilmWarning: "⚠ Film d'huile critique — risque de grippage",
    overrunActive: "Coupure en décélération active", alsFiring: "ALS actif",
    estop: "ARRÊT D'URGENCE", tabSchematic: "Schéma", tabKennfield: "Cartographie",
    kennfieldIgnition: "Avance à l'allumage (° av. PMH)", kennfieldFuel: "Quantité de carburant (mg/cycle)",
    compRod: "Bielle", compHeadBolt: "Vis de culasse", compPistonPin: "Axe de piston",
    tooltipFormat: "{label} : σ={stress} MPa | SF={sf} | Dommage D={damage}%",
    engineLoaded: "Profil moteur chargé : {name}", turboLoaded: "Profil turbo chargé : {name}",
    fuelDbLoaded: "Base de carburants chargée", unknownFormat: "Format JSON inconnu",
    importFailed: "Échec de l'import : {msg}",
    discipline: "Discipline", discStandard: "Route / Standard", discF1: "F1 / WEC Hybride",
    discTopFuel: "Dragster Top Fuel", discWrc: "Rallye WRC", discHillclimb: "Course de côte",
    drivetrain: "Transmission", gear: "Vitesse", neutral: "Point mort", grade: "Pente", wheelspin: "Patinage",
    brake: "Frein", speed: "Vitesse",
    track: "Profil de circuit", trackPlay: "Lecture", trackPause: "Pause", trackStop: "Arrêt",
    trackProgress: "Progression",
    hybridPanel: "Système hybride (ERS)", batterySoC: "Charge batterie", ersDeploy: "Déploiement d'énergie",
    mguhActive: "MGU-H actif (sans temps de réponse)",
    nitrousPanel: "Système protoxyde (N₂O)", nitrousArm: "Armer le système", nitrousBottle: "Niveau bouteille",
    nitrousActive: "N₂O ACTIF",
    alsPanel: "Système anti-lag (ALS)", alsEnable: "activer",
    undo: "Annuler", redo: "Rétablir",
    report: "Générer un rapport", reportTitle: "OpenEngineLab — Rapport de session",
    reportCreated: "Créé le", reportEngineConfig: "Configuration moteur", reportStats: "Statistiques de fonctionnement",
    reportWeakest: "Analyse des points faibles", reportSavePdf: "Enregistrer en PDF",
    hydrolockBanner: "☠ COUP HYDRAULIQUE — DÉFAILLANCE MOTEUR CATASTROPHIQUE", rebuildEngine: "Reconstruire le moteur",
    language: "Langue", rpmUnit: "tr/min"
  };

  const ES = {
    inputs: "Entradas", bore: "Diámetro", stroke: "Carrera", rodLength: "Longitud de biela",
    compressionRatio: "Compresión", boostTarget: "Presión objetivo", fuel: "Combustible",
    transientParams: "Parámetros transitorios", throttle: "Acelerador",
    ambientTemp: "Temperatura ambiente", airPressure: "Presión atmosférica", altitude: "Altitud",
    importSection: "Importar", importHint: "Cargar un perfil JSON de motor o turbo (detección automática).",
    telemetry: "Telemetría", stats: "Estadísticas (mín / prom / máx)",
    running: "EN MARCHA", stopped: "DETENIDO", weakestLink: "Punto Débil",
    knockWarning: "⚠ Detonación detectada — retrasando encendido",
    oilFilmWarning: "⚠ Película de aceite crítica — riesgo de gripaje",
    overrunActive: "Corte por retención activo", alsFiring: "ALS activo",
    estop: "PARO DE EMERGENCIA", tabSchematic: "Esquema", tabKennfield: "Mapa",
    kennfieldIgnition: "Avance de encendido (° antes PMS)", kennfieldFuel: "Cantidad de combustible (mg/ciclo)",
    compRod: "Biela", compHeadBolt: "Tornillo de culata", compPistonPin: "Bulón de pistón",
    tooltipFormat: "{label}: σ={stress} MPa | SF={sf} | Daño D={damage}%",
    engineLoaded: "Perfil de motor cargado: {name}", turboLoaded: "Perfil de turbo cargado: {name}",
    fuelDbLoaded: "Base de combustibles cargada", unknownFormat: "Formato JSON desconocido",
    importFailed: "Error al importar: {msg}",
    discipline: "Disciplina", discStandard: "Carretera / Estándar", discF1: "F1 / WEC Híbrido",
    discTopFuel: "Dragster Top Fuel", discWrc: "Rally WRC", discHillclimb: "Subida de montaña",
    drivetrain: "Transmisión", gear: "Marcha", neutral: "Punto muerto", grade: "Pendiente", wheelspin: "Patinaje",
    brake: "Freno", speed: "Velocidad",
    track: "Perfil de pista", trackPlay: "Reproducir", trackPause: "Pausa", trackStop: "Detener",
    trackProgress: "Progreso",
    hybridPanel: "Sistema híbrido (ERS)", batterySoC: "Carga de batería", ersDeploy: "Despliegue de energía",
    mguhActive: "MGU-H activo (sin retardo)",
    nitrousPanel: "Sistema de óxido nitroso (N₂O)", nitrousArm: "Armar sistema", nitrousBottle: "Nivel de botella",
    nitrousActive: "N₂O ACTIVO",
    alsPanel: "Sistema anti-lag (ALS)", alsEnable: "activar",
    undo: "Deshacer", redo: "Rehacer",
    report: "Generar informe", reportTitle: "OpenEngineLab — Informe de sesión",
    reportCreated: "Creado el", reportEngineConfig: "Configuración del motor", reportStats: "Estadísticas de funcionamiento",
    reportWeakest: "Análisis de puntos débiles", reportSavePdf: "Guardar como PDF",
    hydrolockBanner: "☠ GOLPE DE ARIETE — FALLO CATASTRÓFICO DEL MOTOR", rebuildEngine: "Reconstruir motor",
    language: "Idioma", rpmUnit: "rpm"
  };

  const DICT = { de: DE, en: EN, fr: FR, es: ES };

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem("oel_lang");
      if (saved && DICT[saved]) return saved;
    } catch (e) { /* Speicherzugriff evtl. gesperrt — ignorieren */ }
    return "de";
  }

  const I18N = {
    current: detectInitialLang(),
    langs: ["de", "en", "fr", "es"],
    t(key, vars) {
      let s = (DICT[this.current] && DICT[this.current][key]) || DICT.de[key] || key;
      if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
      return s;
    },
    setLang(lang) {
      if (!DICT[lang]) return;
      this.current = lang;
      try { localStorage.setItem("oel_lang", lang); } catch (e) { /* ignorieren */ }
    }
  };

  root.OEL = root.OEL || {};
  root.OEL.I18N = I18N;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : global));
