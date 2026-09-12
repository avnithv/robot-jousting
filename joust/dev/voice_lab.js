// Voice lab: exercise say() / blip() / vocalize() and the bark tables without running the game.
import { initAudio, getCtx, getBus, audioReady } from '../src/audio/audio.js';
import { VOICES, MOODS, say, blip, vocalize, voiceFor } from '../src/audio/voice.js';
import { bark, barkMood, BARK_EVENTS, HERALD_EVENTS } from '../src/game/barks.js';

const $ = id => document.getElementById(id);
const ta = $('text'), out = $('out'), logEl = $('log'), voiceSel = $('voice'), moodSel = $('mood'), whoSel = $('who'), eventSel = $('event');
const fill = (sel, items, labels = null) => { sel.innerHTML = ''; for (const v of items) { const o = document.createElement('option'); o.value = v; o.textContent = labels ? labels(v) : v; sel.appendChild(o); } };
fill(voiceSel, Object.keys(VOICES), k => `${k} (${VOICES[k].name})`); fill(moodSel, Object.keys(MOODS));
fill(whoSel, ['squire', 'percival', 'champion', 'herald']); const fillEvents = () => fill(eventSel, whoSel.value === 'herald' ? HERALD_EVENTS : BARK_EVENTS); fillEvents(); whoSel.onchange = fillEvents;
const log = s => { logEl.textContent = `${new Date().toLocaleTimeString()}  ${s}\n` + logEl.textContent; console.log('[voice_lab]', s); };

// ---------- level meter on the voice bus ----------
let an = null, peakHold = 0, linePeak = 0;
function ensureAudio() {
  initAudio(); const c = getCtx(); if (!c) return false;
  if (!an) { an = c.createAnalyser(); an.fftSize = 2048; getBus('voice').connect(an); log(`audio ready: ${c.sampleRate} Hz, state ${c.state}`); }
  return c.state === 'running';
}
const buf = new Float32Array(2048);
function meter() {
  requestAnimationFrame(meter); if (!an) return;
  an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  peakHold = Math.max(p, peakHold * 0.93); linePeak = Math.max(linePeak, p);
  $('meterbar').style.width = Math.min(100, peakHold * 100) + '%';
  $('meterdb').textContent = peakHold < 0.001 ? 'silent' : `${(20 * Math.log10(peakHold)).toFixed(1)} dBFS (hold)`;
}
meter();
const dbOf = p => (p > 0 ? (20 * Math.log10(p)).toFixed(1) + ' dBFS' : 'silent');

// ---------- say / blip / stop ----------
let current = null, blipTimer = 0;
function stopAll() { if (current) { current.stop(); current = null; } clearTimeout(blipTimer); out.classList.remove('talk'); }
function speak(text, voiceKey = voiceSel.value, mood = moodSel.value) {
  stopAll(); const running = ensureAudio(); out.textContent = ''; out.classList.add('talk'); linePeak = 0;
  const t0 = performance.now();
  current = say(text, { voice: VOICES[voiceKey], mood, charMs: +$('charMs').value, onChar: i => { out.textContent += text[i]; } });
  const h = current;
  h.done.then(ok => { if (current === h) { current = null; out.classList.remove('talk'); } log(`say [${voiceKey}/${mood}] ${ok ? 'done' : 'stopped'} in ${Math.round(performance.now() - t0)} ms, peak ${dbOf(linePeak)}${running ? '' : ' (audio not running: text only)'}`); });
  return h;
}
$('say').onclick = () => speak(ta.value);
$('stop').onclick = stopAll;
$('blipmode').onclick = () => {   // exactly what dialogue.js does: every other letter, fixed pauses
  stopAll(); ensureAudio(); const text = ta.value, end = /[?!.]$/.exec(text.trim())?.[0] || '.'; const voice = VOICES[voiceSel.value], mood = moodSel.value;
  let i = 0; out.textContent = ''; out.classList.add('talk'); linePeak = 0;
  const step = () => {
    if (i >= text.length) { out.classList.remove('talk'); log(`blip [${voiceSel.value}/${mood}] done, peak ${dbOf(linePeak)}`); return; }
    const ch = text[i]; out.textContent += ch; if (i % 2 === 0) blip(ch, i / text.length, end, voice, mood); i++;
    blipTimer = setTimeout(step, /[,;:]/.test(ch) ? 140 : /[.!?]/.test(ch) ? 260 : ch === ' ' ? 24 : 34);
  };
  step();
};
const TOUR = [
  ['marla', 'neutral', "Oi! Over here, love. Three fights, then your name goes over the bar."],
  ['squire', 'excited', "Hi! I'm Bluebell! Ready? GO!"],
  ['percival', 'sly', "Sir Percival of the Lily. Do try to make it interesting."],
  ['champion', 'neutral', "CHALLENGER DETECTED. THREE TILTS. ZERO DEFEATS."],
  ['herald', 'excited', "Hear ye! Round one of the Tilt! Arms to the line!"],
];
$('tour').onclick = async () => { for (const [v, m, text] of TOUR) { voiceSel.value = v; moodSel.value = m; ta.value = text; const ok = await speak(text, v, m).done; if (!ok) break; await new Promise(r => setTimeout(r, 350)); } };

// ---------- vocalize ----------
for (const kind of ['laugh', 'gasp', 'hmm', 'cheer', 'grunt', 'ouch', 'yield']) {
  const b = document.createElement('button'); b.textContent = kind; $('vocal').appendChild(b);
  b.onclick = () => { ensureAudio(); linePeak = 0; const ms = vocalize(kind, VOICES[voiceSel.value], moodSel.value); setTimeout(() => log(`vocalize ${kind} [${voiceSel.value}/${moodSel.value}] ${ms} ms, peak ${dbOf(linePeak)}`), ms + 150); };
}

// ---------- barks ----------
function sayBark(who, event) {
  const line = bark(who, event, { n: 2, opp: 'Sir Percival', beat: 1 }); const mood = barkMood(who, event), v = voiceFor(who);
  voiceSel.value = v.id; moodSel.value = mood; ta.value = line; log(`bark ${who}/${event} (${mood}): "${line}"`);
  return speak(line, v.id, mood);
}
$('bark').onclick = () => sayBark(whoSel.value, eventSel.value);
$('barkall').onclick = async () => { const who = whoSel.value; for (const ev of who === 'herald' ? HERALD_EVENTS : BARK_EVENTS) { eventSel.value = ev; const ok = await sayBark(who, ev).done; if (!ok) break; await new Promise(r => setTimeout(r, 300)); } };

document.addEventListener('pointerdown', ensureAudio, { once: true });
window.voiceLab = { say, blip, vocalize, VOICES, MOODS, bark, barkMood, voiceFor, getCtx, audioReady, peak: () => linePeak, speak };
log('ready');
