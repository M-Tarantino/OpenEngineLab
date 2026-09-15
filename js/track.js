/* OpenEngineLab :: js/track.js — Streckenprofil-Wiedergabe */
(function (root) {
  "use strict";

  function createPlayer(trackProfile) {
    return {
      profile: trackProfile,
      playing: false,
      elapsedS: 0,
      totalS: trackProfile.segments.reduce((a, s) => a + s.durationS, 0),
      segmentIndex: 0
    };
  }

  function play(player) { player.playing = true; }
  function pause(player) { player.playing = false; }
  function stop(player) { player.playing = false; player.elapsedS = 0; player.segmentIndex = 0; }

  /** Rückt die Wiedergabe um dt Sekunden vor; gibt den aktuell aktiven Segment-Zustand zurück. */
  function advance(player, dt) {
    if (!player.playing) return currentState(player);
    player.elapsedS += dt;
    if (player.elapsedS >= player.totalS) {
      player.elapsedS = player.totalS;
      player.playing = false;
    }
    return currentState(player);
  }

  function currentState(player) {
    let t = player.elapsedS;
    const segs = player.profile.segments;
    for (let i = 0; i < segs.length; i++) {
      if (t <= segs[i].durationS || i === segs.length - 1) {
        player.segmentIndex = i;
        const s = segs[i];
        return {
          throttle01: s.throttle01 != null ? s.throttle01 : 0,
          gear: s.gear != null ? s.gear : 1,
          gradePercent: s.gradePercent || 0,
          brake01: s.brake01 || 0,
          note: s.note || "",
          progress01: player.totalS > 0 ? player.elapsedS / player.totalS : 0,
          finished: !player.playing && player.elapsedS >= player.totalS
        };
      }
      t -= segs[i].durationS;
    }
    return { throttle01: 0, gear: 1, gradePercent: 0, brake01: 0, note: "", progress01: 1, finished: true };
  }

  root.OEL = root.OEL || {};
  root.OEL.Track = { createPlayer, play, pause, stop, advance, currentState };
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : global));
