// Offline-ish render rig for the video: drives the real score and the real voices on the game's own audio
// context, taps music.out + the voice bus into a MediaStreamAudioDestinationNode, records each cue with
// MediaRecorder (webm/opus) and POSTs the blob to /api/upload?name=... which writes it under video/audio/.
// ffmpeg converts webm -> 48k stereo WAV with loudness normalisation afterwards (see video/audio/README.md).
//
// Nothing here edits music.js or voice.js: every cue is the public API on the audio clock.
//   music.start(mood) / music.setIntensity(x) / music.sting(kind) / music.stop()
//   say(text, { voice, mood }) / vocalize(kind, voice, mood)
import { initAudio, getCtx, getBus, setPref } from '../src/audio/audio.js';
import { music } from '../src/audio/music.js';
import { say, vocalize, VOICES } from '../src/audio/voice.js';

const $ = s => document.querySelector(s);
const OUT_GAIN = 0.45;          // music.js OUT: what music.start() puts on G.out. A sting over silence needs it back.
const MIME = 'audio/webm;codecs=opus';

const RS = { phase: 'idle', current: '', done: 0, total: 0, cues: [], log: [], error: null };
window.RS = RS;                 // the render is read back from the page by the driver
const log = (...a) => { const s = a.join(' '); RS.log.push(s); $('#log').textContent = RS.log.slice(-60).join('\n'); $('#log').scrollTop = 1e6; console.log('[render]', s); };
window.addEventListener('error', e => { RS.error = e.message; log('ERROR', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', e => { RS.error = String(e.reason?.message || e.reason); log('REJECT', RS.error); });

const wait = ms => new Promise(r => setTimeout(r, ms));
let ctx = null, tap = null, recDest = null, analyser = null, abuf = null, peak = 0, meterTimer = 0;

// Wait on the AUDIO clock, not the wall clock: a background tab throttles timers, the audio clock never lies.
async function until(t) { while (ctx.currentTime < t) await wait(Math.max(8, Math.min(150, (t - ctx.currentTime) * 1000))); }

function setup() {
  if (ctx) return;
  ctx = initAudio();
  setPref('music', true); setPref('voice', true); setPref('sfx', true);
  // music.js builds its graph lazily, so poke it once with the music bus down: the tap hangs off music.out,
  // which is pre-bus, so this start/stop is silent on the speakers and leaves mood at the default 'town'.
  const mb = getBus('music'), keep = mb.gain.value;
  mb.gain.value = 0; music.start('town'); music.stop(); mb.gain.value = keep;

  tap = ctx.createGain(); tap.gain.value = 1;
  recDest = ctx.createMediaStreamDestination();
  tap.connect(recDest);
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048; abuf = new Float32Array(2048); tap.connect(analyser);
  music.out.connect(tap);            // the score, post its own compressor/trim, pre the music bus
  getBus('voice').connect(tap);      // the cast

  // audio.js suspends the context when the tab is hidden; this render must survive that.
  setInterval(() => { if (ctx.state !== 'running') ctx.resume(); }, 250);
  // A hidden tab throttles setInterval to 1 Hz, which would starve music.js's 100 ms scheduler (LOOKAHEAD is
  // only 0.3 s). Chrome exempts tabs that are playing audio, so hold a tone below the speakers at the output
  // for the whole render. It goes straight to ctx.destination and never into the tap, so it is not recorded.
  const keepOsc = ctx.createOscillator(), keepG = ctx.createGain();
  keepOsc.frequency.value = 30; keepG.gain.value = 0.004;   // ~-48 dBFS at 30 Hz: inaudible, but not silence
  keepOsc.connect(keepG); keepG.connect(ctx.destination); keepOsc.start();
  meterTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(abuf);
    let p = 0; for (let i = 0; i < abuf.length; i++) p = Math.max(p, Math.abs(abuf[i]));
    if (p > peak) peak = p;
    const db = 20 * Math.log10(p || 1e-6), bar = $('#meter i');
    bar.style.width = Math.max(0, 100 + db * (100 / 60)) + '%'; bar.classList.toggle('hot', db > -3);
    $('#peak').textContent = db > -60 ? db.toFixed(1) + ' dBFS' : '-inf';
  }, 40);
  log('ctx', ctx.sampleRate + 'Hz', 'state=' + ctx.state, 'hidden=' + document.hidden, 'mime ok=' + MediaRecorder.isTypeSupported(MIME));
}

// A sting fires over silence, so nothing has restored G.out after a previous music.stop().
function armMusicOut() { const g = music.out.gain, t = ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(OUT_GAIN, t); }

async function upload(name, blob) {
  const r = await fetch('/api/upload?name=' + encodeURIComponent(name), { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
  const j = await r.json().catch(() => ({ error: 'bad json ' + r.status }));
  if (!r.ok || j.error) throw new Error(j.error || ('upload ' + r.status));
  return j;
}

async function record(cue) {
  const row = cue.row;
  RS.current = cue.name; RS.phase = 'recording ' + cue.name;
  row.tr.className = 'go'; row.s.textContent = 'recording';
  peak = 0;
  const rec = new MediaRecorder(recDest.stream, { mimeType: MIME, audioBitsPerSecond: 256000 });
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(500);
  const t0 = ctx.currentTime;
  await until(t0 + 0.3);                       // a little pre-roll so the encoder is up before the cue
  await cue.run(t0 + 0.3);
  await until(ctx.currentTime + (cue.tail ?? 0.5));
  const secs = ctx.currentTime - t0;
  rec.stop(); await stopped;
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const db = 20 * Math.log10(peak || 1e-6);
  row.secs.textContent = secs.toFixed(2); row.peak.textContent = db.toFixed(1); row.kb.textContent = Math.round(blob.size / 1024);
  const webm = cue.name.replace(/\.wav$/, '.webm');
  const j = await upload(webm, blob);
  row.tr.className = 'ok'; row.s.textContent = 'uploaded';
  cue.secs = secs; cue.peak = db; cue.bytes = j.bytes; cue.state = 'ok';
  RS.done++;
  log('ok', webm, secs.toFixed(2) + 's', 'peak ' + db.toFixed(1) + ' dBFS', Math.round(blob.size / 1024) + 'KB');
}

// ---------- the cues ----------
// A music cue: start the mood, optionally ride setIntensity on a 100 ms timer, stop on the audio clock and
// keep recording through the fade and the hall tail.
const musicCue = (name, what, mood, seconds, { x0 = null, ramp = null, tail = 1.8 } = {}) => ({
  name, what, tail,
  async run(t0) {
    if (x0 != null) music.setIntensity(x0);
    music.start(mood);
    let iv = 0;
    if (ramp) iv = setInterval(() => { if (ctx.currentTime >= t0) music.setIntensity(ramp(ctx.currentTime - t0)); }, 100);
    await until(t0 + seconds);
    if (iv) clearInterval(iv);
    music.stop();
  },
});
const stingCue = kind => ({
  name: 'stings/' + kind + '.wav', what: 'sting ' + kind + ' (mood: town)', tail: 5.2,
  async run() { armMusicOut(); music.sting(kind); },
});
const voiceCue = (name, what, run) => ({ name, what, tail: 0.6, run });

// Bar = 2 dotted-quarter beats: 120/bpm seconds. title 96bpm -> 1.25s, town 92 -> 1.304, duel 126 -> 0.952,
// victory 104 -> 1.154, defeat 46 -> 2.609. The stops below land just past a bar line.
const CUES = [
  // stings first: music.sting() uses the module's *current* mood for key and mode, and that is 'town' until a
  // mood cue moves it. Fired over silence, each one recorded with its hall tail.
  ...['lock_in', 'charge', 'round_start', 'ko', 'reward'].map(stingCue),

  musicCue('title_fanfare.wav', 'title: 4-bar processional + one 8-bar loop', 'title', 15.3, { tail: 2.0 }),
  musicCue('town_60s.wav', 'town, 60s, intensity 0 -> 0.6 over the last 20s', 'town', 60.0,
    { x0: 0, ramp: p => (p <= 40 ? 0 : 0.6 * Math.min(1, (p - 40) / 20)), tail: 1.8 }),
  musicCue('duel_build_45s.wav', 'duel, 45s, intensity 0.3 -> 1.0', 'duel', 45.0,
    { x0: 0.3, ramp: p => 0.3 + 0.7 * Math.min(1, p / 45), tail: 1.8 }),
  musicCue('victory.wav', 'victory: 4-bar fanfare + one 8-bar loop', 'victory', 13.9, { tail: 1.8 }),
  musicCue('defeat.wav', 'defeat, x = 0 (the module pins it)', 'defeat', 15.0, { tail: 2.8 }),

  voiceCue('herald_hearye.wav', 'Herald, excited: "Hear ye! Round one of the Tilt!"', async () => {
    await say('Hear ye! Round one of the Tilt!', { voice: VOICES.herald, mood: 'excited' }).done;
  }),
  voiceCue('marla_line.wav', 'Marla: welcome + the Tilt Day line (script.js MARLA.intro)', async () => {
    await say('Oi! Over here, love. Welcome to The Tilted Crown.', { voice: VOICES.marla }).done;
    await wait(420);
    await say("It's Tilt Day in Tiltford. Once a year the whole town shuts its shutters and comes to watch the arms fight.", { voice: VOICES.marla }).done;
  }),
  voiceCue('lionheart_taunt.wav', 'Lionheart, angry: two taunts (barks.js taunt_behind)', async () => {
    await say('Come on then! COME ON!', { voice: VOICES.lionheart, mood: 'angry' }).done;
    await wait(360);
    await say("Right. NOW I'm cross.", { voice: VOICES.lionheart, mood: 'angry' }).done;
  }),
  voiceCue('squire_giggle.wav', "Bluebell: giggle + \"I'm not nervous. You're nervous!\"", async () => {
    const ms = vocalize('giggle', VOICES.squire, 'excited');
    await wait(ms + 260);
    await say("I'm not nervous. You're nervous!", { voice: VOICES.squire, mood: 'excited' }).done;
  }),
];
RS.cues = CUES.map(c => ({ name: c.name, what: c.what, state: 'waiting' }));
RS.total = CUES.length;

// ---------- table ----------
const tb = $('#rows');
CUES.forEach((c, i) => {
  const tr = document.createElement('tr'); tr.className = 'wait';
  const cell = (cls, text) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text || ''; tr.appendChild(td); return td; };
  cell('n', c.name); cell('', c.what);
  c.row = { tr, secs: cell('num'), peak: cell('num'), kb: cell('num'), s: cell('s', 'waiting') };
  tb.appendChild(tr);
  const o = document.createElement('option'); o.value = String(i); o.textContent = c.name; $('#pick').appendChild(o);
});

// ---------- run ----------
async function runAll(list) {
  RS.phase = 'running'; RS.error = null; RS.done = 0; RS.total = list.length;
  $('#go').disabled = $('#one').disabled = true;
  setup();
  await ctx.resume();
  log('start:', list.length, 'cues');
  for (const c of list) {
    try { await record(c); }
    catch (e) {
      c.row.tr.className = 'err'; c.row.s.textContent = 'FAILED'; c.state = 'error: ' + e.message;
      RS.error = c.name + ': ' + e.message; log('FAIL', c.name, e.message);
    }
    RS.cues = CUES.map(c2 => ({ name: c2.name, what: c2.what, state: c2.state || 'waiting', secs: c2.secs, peak: c2.peak, bytes: c2.bytes }));
    $('#status').textContent = `${RS.done}/${RS.total} done`;
    await wait(400);
  }
  music.stop();
  RS.phase = 'finished'; RS.current = '';
  $('#status').textContent = `FINISHED ${RS.done}/${RS.total} uploaded` + (RS.error ? ' (with errors)' : '');
  $('#go').disabled = $('#one').disabled = false;
  log('FINISHED', RS.done + '/' + RS.total);
}
$('#go').onclick = () => runAll(CUES);
$('#one').onclick = () => runAll([CUES[+$('#pick').value]]);
setInterval(() => { if (RS.phase === 'running') $('#status').textContent = `${RS.done}/${RS.total} done - now: ${RS.current} (${ctx ? ctx.state : '-'}, hidden=${document.hidden})`; }, 500);
