// The game's soundtrack as a recorded track (assets/audio/tavern_music.m4a) instead of the procedural score.
// Same public API as music.js (start / setMood / setIntensity / stop / sting / state / out) so nothing else changes:
// the track loops through the music bus (so the "music" toggle still mutes it), moods and intensity only shape its
// level and tone, and the stings (lock_in, charge, round_start, ko, reward) still come from the procedural module.
// If the file is missing (it is large and kept out of git), everything falls back to the procedural score.
import { getCtx, getBus } from './audio.js';
import { music as procedural } from './music.js';

const FILE = 'assets/audio/tavern_music.m4a';
const START_AT = 411;                       // 6:51, the same entry point the trailer uses
const LEVEL = { title: 1.0, town: 1.0, duel: 1.08, victory: 1.0, defeat: 0.55 };
const TONE = { title: 12000, town: 12000, duel: 14000, victory: 12000, defeat: 2200 };   // lowpass cutoff per mood
let el = null, src = null, gain = null, tone = null, mood = 'town', intensity = 0, fallback = false, running = false;

function graph() {
  const ctx = getCtx(); if (!ctx) return false;
  if (el) return true;
  el = document.createElement('audio'); el.id = 'tavern-track'; el.src = FILE; el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
  el.addEventListener('error', () => { fallback = true; if (running) { try { procedural.start(mood); } catch (e) {} } });
  el.addEventListener('loadedmetadata', () => { try { if (el.currentTime < 1) el.currentTime = START_AT; } catch (e) {} }, { once: true });   // the seek only sticks once the metadata is in
  el.style.display = 'none'; document.body.appendChild(el);
  src = ctx.createMediaElementSource(el); tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 12000; gain = ctx.createGain(); gain.gain.value = 1;
  src.connect(tone); tone.connect(gain); gain.connect(getBus('music'));
  return true;
}
function apply() {
  const ctx = getCtx(); if (!ctx || !gain) return;
  const t = ctx.currentTime, lv = (LEVEL[mood] ?? 1) * (0.92 + 0.16 * intensity);
  gain.gain.setTargetAtTime(lv, t, 0.6); tone.frequency.setTargetAtTime(TONE[mood] ?? 12000, t, 0.8);
}

export const music = {
  moods: Object.keys(LEVEL), stings: procedural.stings, track: true,
  start(m = 'town') {
    if (LEVEL[m]) mood = m;
    if (fallback || !graph()) { fallback = true; return procedural.start(m); }
    running = true; apply();
    if (el.paused) { try { if (el.readyState >= 1 && el.currentTime < 1) el.currentTime = START_AT; } catch (e) {} el.play().catch(() => {}); }
  },
  setMood(m) { if (!LEVEL[m]) return; mood = m; if (fallback) return procedural.setMood(m); if (running) apply(); },
  setIntensity(v) { intensity = Math.min(1, Math.max(0, +v || 0)); if (fallback) return procedural.setIntensity(v); if (running) apply(); },
  stop() { running = false; if (fallback) return procedural.stop(); if (el) el.pause(); },
  sting(kind) { try { procedural.sting(kind); } catch (e) {} },
  state() { return fallback ? procedural.state() : { running, mood, intensity, track: FILE, position: el ? el.currentTime : 0, duration: el ? el.duration : 0 }; },
  get out() { return fallback ? procedural.out : gain; },
};
