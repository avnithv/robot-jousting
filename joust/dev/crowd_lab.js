// Test bench for crowd.js: start/stop, the energy slider, one button per reaction, a scripted "turn", and
// a peak/rms meter on the module's own output (before the amb bus gain) for level calibration.
import { initAudio, getCtx } from '../src/audio/audio.js';
import { crowd, REACTIONS } from '../src/audio/crowd.js';

const $ = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));
const intensity = () => parseFloat($('#intensity').value);
let analyser = null, buf = null, peakHold = 0, peakAt = 0, tapped = null;

function status() { const c = getCtx(); $('#status').textContent = `${crowd.running ? 'running' : 'stopped'} · ctx ${c ? c.state : 'none'} · energy ${crowd.energy.toFixed(2)}`; $('#start').classList.toggle('on', crowd.running); }
function start() {
  crowd.start(); status();
  if (!analyser) { const ctx = getCtx(); analyser = ctx.createAnalyser(); analyser.fftSize = 2048; buf = new Float32Array(analyser.fftSize); meter(); }
}
function meter() {
  if (crowd.output && crowd.output !== tapped) { crowd.output.connect(analyser); tapped = crowd.output; }   // follow the node across stop/start
  analyser.getFloatTimeDomainData(buf); let sum = 0, pk = 0;
  for (const x of buf) { sum += x * x; const a = Math.abs(x); if (a > pk) pk = a; }
  const rms = Math.sqrt(sum / buf.length), db = v => (v > 1e-5 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  const t = performance.now(); if (pk >= peakHold || t - peakAt > 1500) { peakHold = pk; peakAt = t; }
  const w = v => `${Math.max(0, Math.min(100, 100 + (20 * Math.log10(Math.max(v, 1e-5))) * 100 / 60))}%`;   // -60..0 dB across the bar
  $('#meter i').style.width = w(rms); $('#meter b').style.left = w(peakHold);
  $('#meterv').textContent = `rms ${db(rms)} dB · peak ${db(peakHold)} dB`;
  requestAnimationFrame(meter);
}
async function demo() {   // one turn as match.js would drive it: plan -> charge -> exchange (four beats) -> return
  crowd.setEnergy(0.25); sync(); await wait(1500);
  crowd.react('murmur_up'); await wait(1000);
  crowd.react('drumroll_clap'); crowd.setEnergy(0.85); sync(); await wait(1300);
  for (const k of ['ooh', 'cheer', 'gasp', 'laugh']) { crowd.duck(90); crowd.react(k); await wait(1500); }
  crowd.setEnergy(0.3); sync();
}
function sync() { $('#energy').value = crowd.energy; $('#energyv').textContent = crowd.energy.toFixed(2); status(); }

$('#start').onclick = start;
$('#stop').onclick = () => { crowd.stop(); status(); };
$('#duck').onclick = () => crowd.duck(90);
$('#demo').onclick = () => { if (!crowd.running) start(); demo(); };
$('#energy').oninput = e => { crowd.setEnergy(parseFloat(e.target.value)); sync(); };
$('#intensity').oninput = e => { $('#intensityv').textContent = parseFloat(e.target.value).toFixed(2); };
for (const k of REACTIONS) { const b = document.createElement('button'); b.textContent = k; b.onclick = () => { if (!crowd.running) start(); crowd.react(k, intensity()); }; $('#reactions').appendChild(b); }
window.crowd = crowd; window.initAudio = initAudio;   // poke at it from the console
status();
