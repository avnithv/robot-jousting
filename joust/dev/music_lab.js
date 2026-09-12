// Audition page for the score: a button per mood and sting, an intensity slider that sweeps the stems, the music
// bus level, a bar / beat counter read from the sequencer, the stem targets, and a peak meter on the module's output.
import { initAudio, getCtx, getBus } from '../src/audio/audio.js';
import { music } from '../src/audio/music.js';

window.lab = { music, initAudio, getCtx, getBus };   // for poking from the console
const $ = s => document.querySelector(s);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; parent.appendChild(e); return e; };
const log = (...a) => { $('#log').textContent += a.join(' ') + '\n'; };
window.addEventListener('error', e => log('error:', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => log('rejection:', e.reason?.message || e.reason));

let analyser = null, peakHold = 0, holdUntil = 0;
const buf = new Float32Array(2048);
// The module builds its graph on first use, so the meter attaches after the first start / sting.
const audio = () => { initAudio(); if (!analyser && music.out) { analyser = getCtx().createAnalyser(); analyser.fftSize = 2048; music.out.connect(analyser); } };

// ---- buttons ----
const moodBtns = {};
for (const m of music.moods) moodBtns[m] = el('button', null, $('#moods'), m);
for (const m of music.moods) moodBtns[m].onclick = () => { audio(); music.start(m); audio(); };
const stopBtn = el('button', null, $('#moods'), 'stop'); stopBtn.onclick = () => { audio(); music.stop(); };
for (const s of music.stings) el('button', null, $('#stings'), s).onclick = () => { audio(); music.sting(s); audio(); };
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const m = music.moods[+e.key - 1], s = { q: 0, w: 1, e: 2, r: 3, t: 4 }[e.key];
  if (m) moodBtns[m].click(); else if (s != null) music.sting(music.stings[s]); else if (e.key === ' ') { stopBtn.click(); e.preventDefault(); }
});

// ---- sliders ----
$('#x').oninput = e => { const v = +e.target.value; $('#xv').textContent = v.toFixed(2); music.setIntensity(v); };
$('#vol').oninput = e => { audio(); const v = +e.target.value; $('#volv').textContent = v.toFixed(2); getBus('music').gain.value = v; };

// ---- readouts ----
// The grid is per bar and the score sets it (12 steps: 6/8, two dotted-quarter beats of three eighths).
const beatCells = []; let cellsPer = 0;
function grid(per) {
  if (per === cellsPer) return; cellsPer = per; $('#beats').textContent = ''; beatCells.length = 0;
  const b = per === 12 ? 6 : 4;                                  // steps in a beat
  for (let i = 0; i < per; i++) beatCells.push(el('i', i % b === 0 ? 'q' : i % 2 === 0 ? 'e' : null, $('#beats')));
}
const stemBars = {};
function frame() {
  const s = music.state(), per = s.per || 16, inBeat = per === 12 ? 6 : 4;
  grid(per);
  $('#c-mood').textContent = s.running ? s.mood + (s.pending ? ' > ' + s.pending : '') : 'stopped';
  $('#c-sec').textContent = s.sec + ' / ' + s.chord;
  $('#c-bar').textContent = s.running ? s.bar + 1 : '-';
  $('#c-beat').textContent = s.running ? `${Math.floor(s.step / inBeat) + 1}.${Math.floor((s.step % inBeat) / 2) + 1}` : '-';
  $('#c-bpm').textContent = `${s.bpm} / +${s.lift}`;
  $('#c-x').textContent = `${s.x.toFixed(2)} (target ${s.intensity.toFixed(2)})`;
  beatCells.forEach((c, i) => c.classList.toggle('on', s.running && i === s.step));
  for (const m of music.moods) { moodBtns[m].classList.toggle('on', s.running && s.mood === m); moodBtns[m].classList.toggle('next', s.pending === m); }
  for (const [name, v] of Object.entries(s.stems)) {
    if (!stemBars[name]) { const d = el('div', null, $('#stems')); el('span', null, d, name); stemBars[name] = el('b', null, el('i', null, d)); }
    stemBars[name].style.width = Math.min(100, v * 100) + '%';
  }
  if (analyser) {
    analyser.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
    const t = performance.now(); if (p >= peakHold || t > holdUntil) { peakHold = p; holdUntil = t + 1500; }
    const db = 20 * Math.log10(p || 1e-5), hold = 20 * Math.log10(peakHold || 1e-5);
    const bar = $('#meter i'); bar.style.width = Math.max(0, 100 + db * (100 / 60)) + '%'; bar.classList.toggle('hot', db > -6);
    $('#peak').textContent = `${db.toFixed(1)} dBFS (hold ${hold.toFixed(1)})`;
  }
  requestAnimationFrame(frame);
}
frame();
