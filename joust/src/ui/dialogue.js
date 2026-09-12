// Marla's dialogue: a portrait from the barkeep sheet plus a parchment speech box. Text types out with a
// garbled voice blip per letter. Modal sequences wait for a click; quips are fire-and-forget.
import { blip, VOICES, sfx } from '../audio/audio.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const PORTRAIT_SCALE = 1.0;

export class Dialogue {
  constructor(layer, atlas, voiceMod = null) {
    this.voiceMod = voiceMod;   // optional richer engine (src/audio/voice.js): blip(ch, progress, end, voice, mood), vocalize(kind, voice)
    this.layer = layer; this.atlas = atlas;
    this.dim = document.createElement('div'); this.dim.className = 'dim';
    this.marla = document.createElement('div'); this.marla.className = 'marla';
    this.img = document.createElement('img'); this.marla.appendChild(this.img);
    this.box = document.createElement('div'); this.box.className = 'speech';
    this.box.innerHTML = '<div class="who">Marla</div><div class="txt"></div><div class="more">click to continue</div>';
    this.txt = this.box.querySelector('.txt'); this.more = this.box.querySelector('.more');
    layer.appendChild(this.dim); layer.appendChild(this.marla); layer.appendChild(this.box);
    layer.classList.add('hidden');
    this.typing = null; this.quipTimer = null; this.voice = (voiceMod?.VOICES?.marla) || VOICES.marla; this.mood = 'neutral';
    this.onClick = null;
    const click = () => this.onClick && this.onClick();
    this.box.addEventListener('click', click); this.dim.addEventListener('click', click); this.marla.addEventListener('click', click);
    window.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !this.layer.classList.contains('hidden') && this.layer.classList.contains('modal')) { e.preventDefault(); click(); } });
  }
  pose(name, big = false) {
    this.mood = { belly_laugh: 'excited', cheer_mug: 'excited', two_mugs: 'excited', worried: 'worried', hand_heart: 'worried', hands_hips: 'angry', arms_crossed: 'sly', lean_in: 'sly', thinking: 'sly' }[name] || 'neutral';
    const v = { belly_laugh: 'laugh', worried: 'gasp', thinking: 'hmm', cheer_mug: 'cheer', two_mugs: 'cheer', hand_heart: 'hmm' }[name];
    if (v && this.voiceMod?.vocalize) { try { this.voiceMod.vocalize(v, this.voice); } catch (e) {} }
    const a = this.atlas[name] || this.atlas.hip_smile; const s = big ? 1.55 : PORTRAIT_SCALE;
    this.img.src = `assets/sprites/${a.file}`; this.img.style.width = a.w * s + 'px'; this.img.style.height = a.h * s + 'px';
    const x = big ? 250 : 150, y = big ? 890 : 898;
    this.img.style.left = x - a.anchor[0] * s + 'px'; this.img.style.top = y - a.h * s + 'px';
  }
  show(modal) { this.layer.classList.remove('hidden'); this.layer.classList.toggle('modal', modal); this.dim.style.display = modal ? '' : 'none'; this.box.classList.toggle('quip', !modal); }
  hide() { this.stopTyping(); this.layer.classList.add('hidden'); this.marla.classList.remove('talk'); }
  stopTyping() { if (this.typing) { this.typing.cancel(); this.typing = null; } }

  type(text) {
    this.stopTyping(); this.txt.textContent = ''; this.marla.classList.add('talk');
    const end = /[?!.]$/.exec(text.trim())?.[0] || '.';
    // Preferred path: the voice engine schedules the whole line on the audio clock and types for us.
    if (this.voiceMod?.say) {
      let h = null;
      try { h = this.voiceMod.say(text, { voice: this.voice, mood: this.mood, charMs: 34, onChar: i => { this.txt.textContent = text.slice(0, i + 1); } }); } catch (e) { h = null; }
      if (h && h.done) {
        const typing = { h, cancel: () => { try { h.stop(); } catch (e) {} this.txt.textContent = text; this.marla.classList.remove('talk'); } };
        this.typing = typing;
        return h.done.then(ok => { if (ok) this.txt.textContent = text; this.marla.classList.remove('talk'); if (this.typing === typing) this.typing = null; return !!ok; });
      }
    }
    let i = 0, cancelled = false, done;
    const p = new Promise(r => { done = r; });
    const step = () => {
      if (cancelled) return;
      if (i >= text.length) { this.marla.classList.remove('talk'); this.typing = null; done(true); return; }
      const ch = text[i]; this.txt.textContent += ch;
      if (i % 2 === 0) { try { (this.voiceMod?.blip || blip)(ch, i / text.length, end, this.voice, this.mood); } catch (e) { /* voice engine hiccup: text still types */ } }
      i++;
      const d = /[,;:]/.test(ch) ? 140 : /[.!?]/.test(ch) ? 260 : ch === ' ' ? 24 : 34;
      this.typing.t = setTimeout(step, d);
    };
    this.typing = { cancel: () => { cancelled = true; clearTimeout(this.typing?.t); this.txt.textContent = text; this.marla.classList.remove('talk'); done(false); }, t: 0 };
    step();
    return p;
  }

  /** Scripted sequence: [{pose, text}], click to advance. Resolves when the last line is dismissed. */
  async say(lines, { modal = true } = {}) {
    this.show(modal); this.more.style.display = '';
    for (const line of lines) {
      this.pose(line.pose, modal); this.more.textContent = 'click to continue';
      const typed = this.type(line.text);
      await new Promise(resolve => {
        let finished = false; typed.then(ok => { finished = true; if (ok) sfx.hover(); });
        this.onClick = () => { if (!finished) { this.stopTyping(); finished = true; return; } this.onClick = null; resolve(); };
      });
    }
    this.hide();
  }
  /** A non-blocking remark during play. Stays for `ms` (or until replaced). */
  quip(line, ms = 2600) {
    clearTimeout(this.quipTimer); this.onClick = () => this.hide();
    this.show(false); this.more.style.display = 'none'; this.pose(line.pose, false); this.type(line.text);
    this.quipTimer = setTimeout(() => this.hide(), ms);
  }
}
