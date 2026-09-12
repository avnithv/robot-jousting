// Full-stage overlays: title, versus splash, reward pick, round result, ladder, the phone-duel lobby and
// the deck manager.
import { card, CARDS, STARTER_DECK } from '../game/cards.js';
import { LADDER, OPPONENTS } from '../game/script.js';
import { cardEl } from './battle.js';
import { sfx } from '../audio/audio.js';
import { createRoom, qrSrc, validateDeck, deckPool, DeckEdit, MAX_SWAPS, SIDES, SIDE_NAME } from '../net/room.js';
import { MpHost } from '../net/mphost.js';
import { session } from '../game/hostctl.js';
import * as settings from '../game/settings.js';
import * as snapshot from '../net/snapshot.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

/** The pose catalogue (same source as main.js): the openers / finales a player may pick. Empty when the
 *  emotes manifest has not been synced. */
export async function loadPoseOptions() {
  const fam = (scenes, names) => scenes.filter(x => names.includes(String(x.family || '').toLowerCase())).map(x => ({ name: x.name, title: x.title || x.name }));
  try {
    const r = await fetch('dashboard/data/emotes.json', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
    const sc = (await r.json()).scenes || [];
    return { openers: fam(sc, ['openers', 'opener']), finales: fam(sc, ['finale', 'finales']) };
  } catch (e) { return { openers: [], finales: [] }; }
}

// The lobby and the deck manager bring their own CSS: styles.css belongs to the card table, and these two
// screens are the only things that use these rules. Injected once, on first use.
const EXTRA_CSS = `
.mplobby .panel { padding: 26px 48px 30px; }
.mplobby h2 { font-size: 60px; }
.mplobby p { margin: 6px auto 10px; }
.mproom { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; margin: 14px 0 6px; }
.mpside { border: 3px solid var(--gilt); border-radius: 8px; padding: 14px 16px 16px; background: linear-gradient(180deg, rgba(27,18,12,.6), rgba(10,6,3,.6)); }
.mpside.a { border-color: #c93a3a; } .mpside.b { border-color: #3d6fc0; }
.mpside .mph { font-family: var(--display); font-size: 34px; line-height: 1; margin-bottom: 8px; }
.mpside.a .mph { color: #ff9e9a; } .mpside.b .mph { color: #a8c6ff; }
.mpside img.mpqr { width: 260px; height: 260px; background: #fff; border-radius: 6px; display: block; margin: 0 auto; image-rendering: pixelated; }
.mpside .mplink { font-size: 15px; color: var(--canvas-dark); word-break: break-all; margin-top: 8px; font-family: ui-monospace, Menlo, monospace; }
.mpside .mpwho { font-family: var(--display); font-size: 30px; margin-top: 6px; color: var(--canvas-dark); min-height: 36px; }
.mpside .mpwho.in { color: var(--gilt-light); }
.mpside .mpwho small { display: block; font-family: var(--body); font-size: 15px; color: #8a6a48; letter-spacing: .04em; }
.mplobby .mphint { font-size: 17px; color: var(--canvas-dark); margin-top: 10px; }
.mplobby .mphint b { color: var(--gilt-light); letter-spacing: .14em; }
.mpfail { color: #ffb3b0; font-size: 20px; }
.deckman .panel { padding: 24px 44px 26px; max-width: 1420px; }
.deckman h2 { font-size: 56px; margin-bottom: 2px; }
.deckman .dkrow { font-family: var(--display); font-size: 26px; color: var(--gilt); letter-spacing: .06em; text-transform: uppercase; margin: 12px 0 6px; text-align: left; }
.deckman .dkgrid { display: flex; flex-wrap: wrap; gap: 12px 10px; justify-content: center; max-height: 250px; overflow-y: auto; padding: 4px; }
.dkbox { position: relative; width: calc(150px * var(--k)); height: calc(214px * var(--k)); flex: none; cursor: pointer; }
.dkbox > .card { position: absolute; left: 0; top: 0; margin: 0; transform: scale(var(--k)); transform-origin: top left; }
.dkbox.pick > .card { box-shadow: inset 0 0 0 3px #fff6dd, inset 0 0 0 5px var(--gilt-light), 0 0 0 4px var(--gilt-light), 0 10px 18px rgba(0,0,0,.6); }
.dkbox.dim > .card { filter: saturate(.25) brightness(.55); }
.dkbox.dim { cursor: default; }
.dkbox .dkn { position: absolute; right: -6px; top: -8px; z-index: 3; min-width: 30px; height: 30px; border-radius: 15px; background: var(--gilt); color: var(--ink); font-family: var(--display); font-weight: 800; font-size: 20px; line-height: 30px; text-align: center; box-shadow: 0 2px 4px #000; }
.deckman .dkswaps { font-size: 22px; color: var(--canvas-dark); margin-top: 10px; }
.deckman .dkswaps b { color: var(--gilt-light); font-family: var(--display); font-size: 30px; }
.deckman .dkhint { font-size: 19px; color: var(--gilt); min-height: 26px; }
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style'); s.id = 'mp-screens-css'; s.textContent = EXTRA_CSS; document.head.appendChild(s);
}

export class Screens {
  constructor(layer) { this.layer = layer; }
  clear() { this.layer.innerHTML = ''; }
  ladder(fightIndex, wonAll = false) {
    return `<div class="ladder">${LADDER.map((id, i) => `<span class="${wonAll || i < fightIndex ? 'won' : i === fightIndex ? 'now' : ''}">${OPPONENTS[id].name}</span>`).join('')}</div>`;
  }
  /** The title screen and everything reachable from it before a fight starts.
   *  Resolves with { tutorial, mode: 'campaign' | 'mp', deck, mp }:
   *    mode 'campaign' -> run the ladder as before; `deck` is the player's edited deck, or null for the starter.
   *    mode 'mp'       -> `mp` is { room, players, decks, poses }: a live HostRoom with both phones joined. */
  async title({ hwMode, resume = null }) {
    ensureCss();
    let deck = null;
    while (true) {
      const c = await this.titleScreen({ hwMode, deckSet: !!deck, resume });
      if (c.action === 'deck') { deck = await this.deck(deck || [...STARTER_DECK]); continue; }
      if (c.action === 'forget') { snapshot.clear(); snapshot.setUrlRoom(null); resume = null; continue; }
      if (c.action === 'resume') return { tutorial: false, mode: 'resume', deck: null };
      if (c.action === 'mp') { const mp = await this.multiplayer(); if (mp) return { tutorial: false, mode: 'mp', mp, deck: null }; continue; }
      return { tutorial: c.tutorial, mode: 'campaign', deck };
    }
  }
  /** The title. With a snapshot in hand (the big screen was reloaded mid-duel: see src/net/snapshot.js) it
   *  leads with the offer to pick that duel back up; without one it is the plain title it always was. */
  titleScreen({ hwMode, deckSet = false, resume = null }) {
    return new Promise(resolve => {
      this.clear();
      const s = el('div', 'screen title', this.layer);
      const r = resume && resume.kind === 'campaign' ? `<div class="resumebar">
          <b>A fight is still running: ${resume.player?.name || 'Lionheart'} vs ${resume.oppName || 'the opponent'}.</b>
          <span>Turn ${resume.match?.turn ?? '?'}, ${resume.match?.hp?.a ?? '?'} vs ${resume.match?.hp?.b ?? '?'} HP. The page was reloaded; the fight picks up at that turn's planning phase.</span>
          <button class="btn" id="resume">Resume the fight</button>
          <button class="btn quiet" id="drop">Forget it</button></div>` : resume ? `<div class="resumebar">
          <b>A duel is still running in room ${resume.code}.</b>
          <span>${resume.players?.a?.name || 'Red knight'} vs ${resume.players?.b?.name || 'Blue knight'}${resume.match ? ` — turn ${resume.match.turn}, ${resume.match.hp?.a ?? '?'} vs ${resume.match.hp?.b ?? '?'}` : ''}. The phones are still waiting.</span>
          <button class="btn" id="resume">Resume the phone duel in room ${resume.code}</button>
          <button class="btn quiet" id="drop">Forget it</button></div>` : '';
      s.innerHTML = `<div class="panel logo"><h1><small>The Tilted Crown presents</small>The Tilt of Tiltford</h1>
        ${r}
        <p>Two mechanical knights, three fights, one tavern. You steer the red arm. Pick three moves a turn, then watch them play out in the lists.</p>
        <p class="small">Cards: click or press <kbd>1</kbd>–<kbd>5</kbd>. Lock in with <kbd>Enter</kbd>. Advance Marla with <kbd>Space</kbd>. <kbd>⚙ host</kbd>, top right, is the host panel.</p>
        <button class="btn" id="start">Enter the tavern</button> <button class="btn quiet" id="skip">Skip the chatter</button>
        <button class="btn quiet" id="mp">Play 1v1 from phones</button>
        <button class="btn quiet" id="deck">${deckSet ? 'Deck adjusted — change it' : 'Adjust your deck'}</button></div>
        <div class="hwnote">${hwMode === 'live' ? '<b>Live arms:</b> every card is sent to the real SO-101 / SO-100 through server.py.' : 'Arms are simulated. Add <b>?hw=live</b> to the address to drive the real arms.'}</div>`;
      const go = (id, out) => { const b = s.querySelector('#' + id); if (b) b.onclick = () => { sfx.lock(); this.clear(); resolve(out); }; };
      go('start', { action: 'play', tutorial: true }); go('skip', { action: 'play', tutorial: false });
      go('mp', { action: 'mp' }); go('deck', { action: 'deck' });
      go('resume', { action: 'resume' });
      const drop = s.querySelector('#drop');
      if (drop) drop.onclick = () => { sfx.lock(); resolve({ action: 'forget' }); };
    });
  }

  // ---- phone duel: the lobby -----------------------------------------------------------------------------
  /** Create a room and run the lobby. Resolves with { room, players, decks, poses } once both phones have
   *  joined and the host presses Begin, or null if the host backed out (the room is closed in that case). */
  async multiplayer() {
    ensureCss();
    let room = null;
    try { room = await createRoom(); }
    catch (e) {
      await new Promise(resolve => {
        this.clear(); const s = el('div', 'screen', this.layer);
        s.innerHTML = `<div class="panel"><h2>No room</h2><p class="mpfail">The server would not open a room (${e.message}). Phone duels need <b>server.py</b>, not a file:// page.</p><button class="btn quiet" id="back">Back</button></div>`;
        s.querySelector('#back').onclick = () => { this.clear(); resolve(); };
      });
      return null;
    }
    room.listen();
    // The room code goes in the address bar the moment the room exists, so a reload of the big screen -- even
    // one in the lobby -- can find its way back to this duel (src/net/snapshot.js).
    snapshot.setUrlRoom(room.code);
    // The MpHost is built here, not when the fight starts, so the Host Controls drawer can already see the
    // two seats in the lobby: connection state, kick and reissue, and swap seats all work before beat one.
    const host = new MpHost(room, {});
    session.set({ mode: 'mp', room, host, where: 'lobby' });
    const out = await this.lobby(room, host);
    if (!out) {
      session.set({ mode: 'title', room: null, host: null, where: 'title' });
      host.close(); room.close(); snapshot.clear(); snapshot.setUrlRoom(null); return null;
    }
    return { room, host, ...out };
  }

  /** Two QR codes, the names as they arrive, the pose pickers and a Start that lights up once both are in.
   *  The seats belong to the MpHost, so a kick-and-reissue or a seat swap from the Host Controls drawer
   *  repaints this screen (new ticket -> new QR and new link) without anyone leaving the lobby. */
  async lobby(room, host) {
    ensureCss();
    const options = await loadPoseOptions();
    host.note = 'Waiting in the tavern';
    host.phase = 'lobby';
    host.publish();

    return new Promise(resolve => {
      this.clear();
      const s = el('div', 'screen mplobby', this.layer);
      const opts = (list, cur) => `<option value="">none</option>` + list.map(o => `<option value="${o.name}"${o.name === cur ? ' selected' : ''}>${o.title || o.name}</option>`).join('');
      s.innerHTML = `<div class="panel"><h2>Phone duel</h2>
        <p>Two knights, two phones, one arena. Scan a code, pick a name, fight.</p>
        <div class="mproom">${SIDES.map(k => `<div class="mpside ${k}">
          <div class="mph">${SIDE_NAME[k]}</div>
          <img class="mpqr" alt="QR code for the ${SIDE_NAME[k]}" data-qr="${k}" src="${qrSrc(room.urls[k])}">
          <div class="mplink" data-link="${k}">${room.urls[k]}</div>
          <div class="mpwho" data-who="${k}">waiting for a phone…</div></div>`).join('')}</div>
        <div class="poses"><label>Opening pose <select id="opener">${opts(options.openers, settings.get('opener'))}</select></label>
          <label>Finishing pose <select id="finale">${opts(options.finales, settings.get('finale'))}</select></label>
          <div class="hint">What the arms do before the first beat and after the knockout. Optional — the host panel sets the same two.</div></div>
        <div style="margin-top:10px"><button class="btn" id="mpgo" disabled>Begin the Tilt</button> <button class="btn quiet" id="mpback">Back</button></div>
        <div class="mphint">Room <b>${room.code}</b> · both phones must reach this screen's address. Press <kbd>Esc</kbd> to cancel, <kbd>⚙ host</kbd> for the host panel.</div></div>`;
      const qrFail = img => { img.onerror = () => { img.replaceWith(el('div', 'mpfail', null, 'QR unavailable — type the link below')); }; };
      for (const img of s.querySelectorAll('img.mpqr')) qrFail(img);
      const go = s.querySelector('#mpgo');
      const was = { a: false, b: false };
      const draw = () => {
        for (const k of SIDES) {
          const box = s.querySelector(`[data-who="${k}"]`); const p = host.players[k] || {};
          if (p.joined && !was[k]) { was[k] = true; try { sfx.coin(); } catch (e) {} }
          if (!p.joined) was[k] = false;
          box.classList.toggle('in', !!p.joined);
          box.innerHTML = p.joined ? `${p.name}<small>in the lists</small>`
            : p.reissued ? 'seat reissued — scan the new code' : 'waiting for a phone…';
          // A reissue or a seat swap mints new tickets: the QR and the link under it must follow.
          const img = s.querySelector(`[data-qr="${k}"]`), link = s.querySelector(`[data-link="${k}"]`);
          const url = room.urls?.[k] || '';
          if (link && link.textContent !== url) link.textContent = url;
          if (img && img.dataset.url !== url) { img.dataset.url = url; img.src = qrSrc(url); qrFail(img); }
        }
        go.disabled = !(host.players.a.joined && host.players.b.joined);
      };
      host.onChange = draw;
      const done = out => {
        host.onChange = null;
        window.removeEventListener('keydown', key); this.clear(); resolve(out);
      };
      const key = e => { if (e.key === 'Escape' && !document.querySelector('.hostdrawer.in')) { sfx.lock(); done(null); } };
      window.addEventListener('keydown', key);
      const poses = () => {
        const v = id => s.querySelector('#' + id).value || '';
        settings.set('opener', v('opener')); settings.set('finale', v('finale'));
        return { opener: v('opener') || null, finale: v('finale') || null };
      };
      go.onclick = () => { sfx.drumroll(0.8); done({ poses: poses() }); };
      s.querySelector('#mpback').onclick = () => { sfx.lock(); done(null); };
      draw();
    });
  }

  // ---- the deck manager ----------------------------------------------------------------------------------
  /** Swap up to two cards. Each swap takes one card out of the deck and puts one from the rack in, so the
   *  deck never changes size. Resolves with the new deck (the same one if nothing was swapped). */
  deck(deckIds, pool = deckPool(CARDS)) {
    return new Promise(resolve => {
      ensureCss(); this.clear();
      const edit = new DeckEdit(deckIds, pool);
      let picked = null;
      const s = el('div', 'screen deckman', this.layer);
      s.innerHTML = `<div class="panel"><h2>Your deck</h2>
        <div class="dkhint"></div>
        <div class="dkrow">In the deck — tap one to take it out</div><div class="dkgrid mine"></div>
        <div class="dkrow">The rack behind the bar — tap its replacement</div><div class="dkgrid rack"></div>
        <div class="dkswaps"></div>
        <div style="margin-top:8px"><button class="btn" id="dkdone">Done</button> <button class="btn quiet" id="dkundo">Undo</button></div></div>`;
      const mineBox = s.querySelector('.dkgrid.mine'), rackBox = s.querySelector('.dkgrid.rack');
      const hint = s.querySelector('.dkhint'), swaps = s.querySelector('.dkswaps'), undo = s.querySelector('#dkundo');
      const box = (c, { k = 0.72, count = 0, cls = '', onTap = null } = {}) => {
        const d = el('div', 'dkbox ' + cls); d.style.setProperty('--k', k); d.appendChild(cardEl(c, { color: 'red' }));
        if (count > 1) el('div', 'dkn', d, '×' + count);
        if (onTap) { d.onclick = onTap; d.onmouseenter = () => { try { sfx.hover(); } catch (e) {} }; }
        return d;
      };
      const draw = () => {
        hint.textContent = picked ? `Taking out ${card(picked).name}. Now pick its replacement from the rack.` : 'Pick a card to take out, then pick its replacement.';
        swaps.innerHTML = `<b>${edit.swapsLeft}</b> of ${MAX_SWAPS} swaps left`;
        undo.disabled = !edit.dirty;
        mineBox.innerHTML = '';
        for (const [id, n] of edit.counts()) mineBox.appendChild(box(card(id), { count: n, cls: picked === id ? 'pick' : '', onTap: () => { sfx.card(); picked = picked === id ? null : id; draw(); } }));
        rackBox.innerHTML = '';
        const dead = !picked || edit.swapsLeft <= 0;
        for (const id of edit.pool) rackBox.appendChild(box(card(id), { cls: dead ? 'dim' : '', onTap: dead ? null : () => { if (edit.swap(picked, id)) { sfx.coin(); picked = null; draw(); } else sfx.deny(); } }));
      };
      undo.onclick = () => { sfx.unslot(); edit.undo(); picked = null; draw(); };
      s.querySelector('#dkdone').onclick = () => { sfx.lock(); this.clear(); resolve(edit.deck); };
      draw();
    });
  }
  /** The between-fights offer: manage the deck, or walk straight out to the lists. Resolves with the deck
   *  to fight with (edited or not). Two more swaps are allowed each time it is offered. */
  async offerDeck(deckIds) {
    const want = await new Promise(resolve => {
      ensureCss(); this.clear();
      const s = el('div', 'screen', this.layer);
      s.innerHTML = `<div class="panel"><h2>Before the next bout</h2>
        <p>Marla nods at the rack behind the bar. You may swap up to two cards, or leave the deck as it stands.</p>
        <div style="margin-top:14px"><button class="btn" id="dkyes">Manage deck</button> <button class="btn quiet" id="dkno">To the lists</button></div></div>`;
      s.querySelector('#dkyes').onclick = () => { sfx.lock(); this.clear(); resolve(true); };
      s.querySelector('#dkno').onclick = () => { sfx.lock(); this.clear(); resolve(false); };
    });
    return want ? this.deck(deckIds) : deckIds;
  }
  /** The end of a phone duel. Lights up as each phone presses Ready; resolves true for a rematch, false to
   *  go back to the title. `ready()` reads the live flags, `bind(fn)` lets the host push updates in. */
  /** The end of a phone duel. `winner` is 'a', 'b' or 'draw'; `forfeit` names a side that walked away.
   *  `expose(fn)` hands the Host Controls drawer a "Rematch now" button, so a player who never presses Ready
   *  cannot hold the evening hostage. */
  mpResult({ winner, names, ready = null, bind = null, forfeit = null, expose = null }) {
    return new Promise(resolve => {
      ensureCss(); this.clear();
      const s = el('div', 'screen', this.layer);
      let done = null;
      const finish = out => { if (bind) bind(() => {}); expose?.(null); this.clear(); resolve(out); };
      done = finish;
      const draw = () => {
        const r = ready ? ready() : { a: false, b: false };
        const both = r.a && r.b;
        const head = winner === 'draw' ? 'A draw' : `${names[winner]} wins`;
        const why = forfeit ? `<p class="mphint">${names[forfeit]} forfeited — nobody at the phone.</p>` : '';
        s.innerHTML = `<div class="panel"><h2>${head}</h2>
          ${why}
          <p>${names.a} in red, ${names.b} in blue. Both phones press <b>Ready for a rematch</b>, or take it back to the tavern.</p>
          <div class="mphint">${names.a}: <b>${r.a ? 'ready' : 'waiting'}</b> · ${names.b}: <b>${r.b ? 'ready' : 'waiting'}</b></div>
          <div style="margin-top:14px"><button class="btn" id="again">${both ? 'Fight again' : 'Fight again anyway'}</button> <button class="btn quiet" id="title">Back to the title</button></div></div>`;
        s.querySelector('#again').onclick = () => { sfx.drumroll(0.8); done(true); };
        s.querySelector('#title').onclick = () => { sfx.lock(); done(false); };
      };
      if (bind) bind(draw);
      expose?.(() => { try { sfx.drumroll(0.8); } catch (e) {} done(true); });
      draw();
    });
  }
  /** The versus splash. `poses` = { openers: [{name, title}], finales: [...], opener, finale } lists the robot scenes the
   *  player may pick as an opening and a finishing pose (both optional); resolves with { opener, finale } (null = none). */
  versus(player, opp, fightIndex, portraits, poses = { openers: [], finales: [] }) {
    return new Promise(resolve => {
      this.clear(); sfx.horn();
      const s = el('div', 'screen', this.layer);
      const opts = (list, cur) => `<option value="">none</option>` + list.map(o => `<option value="${o.name}"${o.name === cur ? ' selected' : ''}>${o.title || o.name}</option>`).join('');
      s.innerHTML = `<div><div class="vs">
        <div class="side a"><div class="n">${player.name}</div><div class="t">${player.title}</div><img src="${portraits.a}" alt=""></div>
        <div class="mid">vs</div>
        <div class="side b"><div class="n">${opp.name}</div><div class="t">${opp.title}</div><img src="${portraits.b}" alt=""></div>
      </div>${this.ladder(fightIndex)}
      <div class="poses"><label>Opening pose <select id="opener">${opts(poses.openers, poses.opener)}</select></label>
        <label>Finishing pose <select id="finale">${opts(poses.finales, poses.finale)}</select></label>
        <div class="hint">What the arms do before the first beat and after the knockout. Optional.</div></div>
      <div style="text-align:center;margin-top:18px"><button class="btn" id="go">To the lists</button></div></div>`;
      for (const sel of s.querySelectorAll('select')) sel.onchange = () => sfx.hover();
      s.querySelector('#go').onclick = () => { sfx.drumroll(0.8); const pick = id => s.querySelector('#' + id).value || null; const out = { opener: pick('opener'), finale: pick('finale') }; this.clear(); resolve(out); };
    });
  }
  reward(pool) {
    return new Promise(resolve => {
      this.clear();
      const s = el('div', 'screen', this.layer);
      s.innerHTML = `<div class="panel"><h2>Take a card for your deck</h2><p>Marla pulls three from the rack behind the bar.</p><div class="rewards"></div><button class="btn quiet" id="none">Keep the deck as it is</button></div>`;
      const box = s.querySelector('.rewards');
      for (const id of pool) { const d = cardEl(card(id)); d.onclick = () => { sfx.coin(); this.clear(); resolve(id); }; d.onmouseenter = () => sfx.hover(); box.appendChild(d); }
      s.querySelector('#none').onclick = () => { this.clear(); resolve(null); };
    });
  }
  result({ won, opp, fightIndex, last, draw = false }) {
    return new Promise(resolve => {
      this.clear();
      const s = el('div', 'screen', this.layer);
      const title = draw ? 'The herald calls it level' : won ? (last ? 'Champion of the Tilt' : `${opp.name} yields`) : 'Down in the dust';
      const sub = draw ? `Neither of you put the other down. ${opp.name} will want it settled.`
        : won ? (last ? 'Lionheart takes the crown. Your name goes over the bar.' : 'The crowd wants more. So does Marla.') : `${opp.name} stands over you. The crowd is kind, mostly.`;
      const buttons = draw ? `<button class="btn" id="retry">Fight it again</button> <button class="btn quiet" id="tavern">Back to the tavern</button>`
        : won ? (last ? `<button class="btn" id="again">Run it again</button>` : `<button class="btn" id="next">Next fight</button>`)
        : `<button class="btn" id="retry">Fight again</button> <button class="btn quiet" id="tavern">Back to the tavern</button>`;
      s.innerHTML = `<div class="panel"><h2>${title}</h2><p>${sub}</p>${this.ladder(fightIndex + (won ? 1 : 0), won && last)}<div style="margin-top:20px">${buttons}</div></div>`;
      for (const [id, v] of [['next', 'next'], ['retry', 'retry'], ['tavern', 'tavern'], ['again', 'tavern']]) { const b = s.querySelector('#' + id); if (b) b.onclick = () => { sfx.lock(); this.clear(); resolve(v); }; }
    });
  }
  /** Live arms were asked for and the hardware is not all there. The fight does NOT start: half a duel on
   *  real metal is one arm swinging at nothing, and an arm that is not answering is usually an arm that is
   *  unplugged, unpowered or mid-calibration. The host decides what to do about it.
   *  Resolves 'sim' (play this run in the sand pit) or 'retry' (back to the title and try again). */
  hardware(pre) {
    return new Promise(resolve => {
      this.clear();
      const s = el('div', 'screen', this.layer);
      const g = pre.gantry || {};
      const gline = g.offline ? 'the daemon reports no gantry'
        : !g.connected ? 'the gantry has not been opened yet'
          : g.homed ? `gantry referenced, at X=${Math.round(g.x || 0)} Y=${Math.round(g.y || 0)}` : 'gantry connected but NOT referenced';
      s.innerHTML = `<div class="panel"><h2>The lists are not ready</h2>
        <p>${pre.message}</p>
        <p class="small">${gline}. Check the two arm cables and the gantry cable, that the daemon is running
        (<b>robot-jousting/arm/run_daemon.sh</b>), then press <b>Try the arms again</b>. Nothing has been moved.</p>
        <div style="margin-top:20px">
          <button class="btn" id="retry">Try the arms again</button>
          <button class="btn quiet" id="sim">Play it in the sand pit</button>
        </div></div>`;
      s.querySelector('#retry').onclick = () => { sfx.lock(); this.clear(); resolve('retry'); };
      s.querySelector('#sim').onclick = () => { sfx.lock(); this.clear(); resolve('sim'); };
    });
  }
  rules() {
    return new Promise(resolve => {
      const s = el('div', 'screen rules', this.layer);
      s.innerHTML = `<div class="panel"><h2>How a beat resolves</h2>
        <div class="cols"><table>
        <tr><th>Your card</th><th>Meets</th><th>Result</th></tr>
        <tr><td><b>Attack</b></td><td>guard, same line</td><td>Blocked. Guard gains <b>Riposte +2</b> (Parry: next attack <b>double</b>).</td></tr>
        <tr><td><b>Attack</b></td><td>guard, wrong line</td><td>Hits for damage <b>+1</b>.</td></tr>
        <tr><td><b>Attack</b></td><td>attack, same line</td><td><b>Clash.</b> Nobody is hurt.</td></tr>
        <tr><td><b>Attack</b></td><td>attack, other line</td><td>Both hit.</td></tr>
        <tr><td><b>Attack</b></td><td>feint</td><td>Punished: damage <b>+2</b>.</td></tr>
        <tr><td><b>Attack</b></td><td>rest or trick</td><td><b>Clean hit</b> (+1) and the victim is <b>Staggered</b>: it loses the next beat.</td></tr>
        </table><table>
        <tr><th>Your card</th><th>Meets</th><th>Result</th></tr>
        <tr><td><b>Feint</b></td><td>guard</td><td>Guard is <b>Exposed</b>: its next guard fizzles.</td></tr>
        <tr><td><b>Feint</b></td><td>feint</td><td>Everyone looks silly.</td></tr>
        <tr><td><b>Thrust</b></td><td>anything</td><td>3 damage, cannot be blocked.</td></tr>
        <tr><td><b>Brace</b></td><td>anything</td><td>Blocks both lines. Cannot be staggered or exposed.</td></tr>
        <tr><td><b>Wind Up</b></td><td>skips the beat</td><td>Next attack <b>+3</b>. The tell is honest.</td></tr>
        <tr><td><b>Flourish</b></td><td>skips the beat</td><td>Draw 2 extra cards next turn.</td></tr>
        </table></div>
        <p class="small">3 energy a turn. Empty beats are free hits for them. Watch the twitch before you lock in: Marla reads it.</p>
        <div style="text-align:center"><button class="btn quiet" id="close">Back to the lists</button></div></div>`;
      s.querySelector('#close').onclick = () => { s.remove(); resolve(); };
    });
  }
  banner(text, ms = 1600) {
    const s = el('div', 'screen', this.layer); s.style.background = 'transparent'; s.style.pointerEvents = 'none';
    s.innerHTML = `<div class="stamp small" style="position:relative;left:auto;top:auto;transform:none;animation-duration:${ms}ms">${text}</div>`;
    setTimeout(() => s.remove(), ms);
  }
}
