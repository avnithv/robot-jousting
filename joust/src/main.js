// Boot: load atlases, build the stage, scale it to the window, run the tournament loop.
import { STARTER_DECK, REWARD_POOL, card } from './game/cards.js';
import { MARLA, OPPONENTS, LADDER, PLAYER_NAME } from './game/script.js';
import { Match } from './game/match.js';
import { Stage } from './ui/stage.js';
import { Battle } from './ui/battle.js';
import { Dialogue } from './ui/dialogue.js';
import { Screens } from './ui/screens.js';
import { createBridge, SimBridge } from './hw/bridge.js';
import { runMultiplayer } from './net/mphost.js';
import { HostPanel } from './ui/hostpanel.js';
import { control, session } from './game/hostctl.js';
import * as settings from './game/settings.js';
import * as snapshot from './net/snapshot.js';
import { adoptRoom } from './net/room.js';
import { initAudio, audioReady, music as coreMusic, ambience as coreAmbience, setPref, getPref, sfx } from './audio/audio.js';

// Optional modules built alongside the core (music.js, voice.js, crowd.js, servo.js, barks.js). Each is
// loaded if present; the game runs on the core's built-ins otherwise.
async function optional(path) { try { return await import(path); } catch (e) { console.info('optional module not loaded:', path, e.message); return null; } }
const safe = fn => { try { return fn(); } catch (e) { console.warn(e); } };

const stageEl = document.getElementById('stage');
function fit() { const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight; const s = Math.min(w / 1600, h / 900); stageEl.style.setProperty('--s', s); }
window.addEventListener('resize', fit); new ResizeObserver(fit).observe(document.documentElement); fit(); setTimeout(fit, 300); setTimeout(fit, 1500);

/** The robot scene catalogue (dashboard/data/emotes.json, synced from robot-jousting/sim/out/emotes by tools/sync_emotes.py):
 *  the openers and finales a player may pick as an opening / finishing pose. Empty lists when the manifest is missing. */
async function loadPoseOptions() {
  const fam = (scenes, names) => scenes.filter(x => names.includes(String(x.family || '').toLowerCase())).map(x => ({ name: x.name, title: x.title || x.name }));
  try { const r = await fetch('dashboard/data/emotes.json', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); const man = await r.json(); const sc = man.scenes || [];
    return { openers: fam(sc, ['openers', 'opener']), finales: fam(sc, ['finale', 'finales']) }; }
  catch (e) { return { openers: [], finales: [] }; }
}
async function loadAtlas(dir) { const r = await fetch(`assets/${dir}/atlas.json`); return r.json(); }
function preload(dir, atlas) { return Promise.all(Object.values(atlas).map(a => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = `assets/${dir}/${a.file}`; }))); }

async function main() {
  // music: the recorded tavern track (src/audio/track.js) when its file is present, else the procedural score
  const mods = { music: (await optional('./audio/track.js')) || (await optional('./audio/music.js')), voice: await optional('./audio/voice.js'), crowd: await optional('./audio/crowd.js'), servo: (await optional('./audio/foley.js')) || (await optional('./audio/servo.js')), barks: await optional('./game/barks.js') };
  const music = mods.music?.music || coreMusic; const crowd = mods.crowd?.crowd || null; const ambience = coreAmbience;
  const ext = { music, crowd, crowdOn: () => getPref('crowd'), voice: mods.voice, servo: mods.servo, barks: mods.barks, safe };
  const [arms, arms2, town, arena, sprites, crowdAtlas] = await Promise.all([loadAtlas('arms'), loadAtlas('arms2'), loadAtlas('town'), loadAtlas('arena'), loadAtlas('sprites'), loadAtlas('crowd').catch(() => ({}))]);
  const atlases = { arms, arms2, town, arena, sprites, crowd: crowdAtlas };
  await Promise.all([preload('arms', arms), preload('arms2', arms2), preload('town', town), preload('arena', arena), preload('sprites', sprites), preload('crowd', crowdAtlas)]);
  stageEl.addEventListener('scroll', () => { stageEl.scrollLeft = 0; stageEl.scrollTop = 0; });

  const stage = new Stage(stageEl, atlases); stage.build();
  const battle = new Battle(document.getElementById('hud'), document.getElementById('table'));
  const dialogue = new Dialogue(document.getElementById('dialogue'), sprites, mods.voice);
  const screens = new Screens(document.getElementById('overlay'));
  window.tilt = { stage, battle, dialogue, screens, mods, atlases };   // handy in the console

  // ---- the settings strip, and the Host Controls drawer behind its gear ---------------------------------
  // The strip keeps its buttons as shortcuts; the drawer holds everything, including these four. Both call
  // the same applyPref, so a toggle in one place lights up in the other.
  const params = new URLSearchParams(location.search); let hwMode = params.get('hw') === 'live' ? 'live' : 'sim';
  if (params.get('mode') === 'simple') settings.set('simple', true);       // ?mode=simple: the simple duel (persists like any host setting)
  else if (params.get('mode') === 'full') settings.set('simple', false);
  const prefBtn = name => document.querySelector(`#settings [data-pref="${name}"]`);
  const applyPref = (name, on) => {
    initAudio(); setPref(name, on);
    prefBtn(name)?.classList.toggle('on', on);
    if (name === 'crowd' && crowd) safe(() => (on ? crowd.start() : crowd.stop()));
  };
  for (const b of document.querySelectorAll('#settings [data-pref]')) {
    b.classList.toggle('on', !!getPref(b.dataset.pref));            // the saved prefs decide how the strip looks
    b.onclick = () => { applyPref(b.dataset.pref, !getPref(b.dataset.pref)); panel.paint(); };
  }
  document.getElementById('rulesbtn').onclick = () => { if (!document.querySelector('.rules')) screens.rules(); };
  document.getElementById('fsbtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  const hwBtn = document.getElementById('hwbtn');
  const goHw = m => { const u = new URL(location.href); if (m === 'live') u.searchParams.set('hw', 'live'); else u.searchParams.delete('hw'); location.href = u; };
  const setHw = mode => { hwMode = mode; hwBtn.textContent = 'arms: ' + mode; hwBtn.classList.toggle('live', mode === 'live'); };
  setHw(hwMode); hwBtn.onclick = () => goHw(hwMode === 'live' ? 'sim' : 'live');

  const panel = new HostPanel({
    poseOptions: await loadPoseOptions(), hwMode,
    onHw: m => goHw(m),
    onPref: (name, on) => applyPref(name, on),
  });
  document.getElementById('hostbtn').onclick = () => panel.toggle();
  // STOP GAME: the same immediate abort as the host drawer's, plus the fight is ended and the screen returns to the
  // title. One press, no confirm -- it is the button for metal about to meet metal. The gantry loses its reference on
  // the abort, so Prepare has to run before the next fight.
  document.getElementById('stopbtn').onclick = async () => {
    const b = document.getElementById('stopbtn'); b.textContent = '■ STOPPING'; b.disabled = true;
    const bridge = session.bridge;
    try { await (bridge?.abort ? bridge.abort() : fetch('/api/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }
    catch (e) { console.warn('stop game: abort', e); }
    try { if (session.match && !session.match.over) session.match.finishNow('quit'); else session.onTitle?.(); }
    catch (e) { console.warn('stop game: end fight', e); }
    setTimeout(() => { b.textContent = '■ STOP GAME'; b.disabled = false; }, 1500);
  };
  control.on(c => { safe(() => battle.setPaused(c.paused)); });
  // Back to title with no fight on the stage (the versus splash, a result screen, the lobby): there is no
  // loop to interrupt, so close the room, drop the snapshot and reload into a clean title.
  session.onTitle = () => {
    try { session.host?.close(); session.room?.close(); } catch (e) {}
    snapshot.clear();
    const u = new URL(location.href); u.searchParams.delete('room');
    location.href = u.pathname + (u.search || '');
  };
  window.tilt.panel = panel; window.tilt.control = control; window.tilt.settings = settings; window.tilt.session = session;

  // ---- run loop -----------------------------------------------------------------------------------------
  // A duel whose big screen was reloaded leaves a snapshot in sessionStorage and its room code in the URL;
  // the title offers to pick it back up before anything else happens.
  let pendingResume = snapshot.resumable();
  let firstVisit = true;
  while (true) {
    battle.show(false); battle.setTimer(null); control.clear();
    if (audioReady()) safe(() => music.setMood('title'));
    session.set({ mode: 'title', where: 'title', match: null, host: null, room: null, rematch: null });
    // screens.title() also runs the phone-duel lobby and the pre-run deck manager itself, and comes back
    // with { tutorial, mode: 'campaign' | 'mp' | 'resume', deck, mp }.
    const start = await screens.title({ hwMode, resume: pendingResume });
    const { tutorial } = start;
    initAudio(); safe(() => music.start('town')); if (crowd && getPref('crowd')) safe(() => crowd.start()); safe(() => mods.servo?.loadMoves?.());
    let bridge = await createBridge(hwMode);
    session.set({ bridge });          // the Host Controls drawer drives the hardware through this
    if (hwMode === 'live') {
      // A live fight needs BOTH arms. The daemon answering with only one is the usual shape of an unplugged
      // cable, and starting anyway would be one arm duelling the air, so the game refuses and asks the host.
      const pre = bridge.preflight();
      if (pre.ok) await dialogue.say(MARLA.hardwareLive);
      else {
        const choice = await screens.hardware(pre);
        if (choice !== 'sim') continue;                 // back to the title: fix the cable and come again
        bridge = new SimBridge(); session.set({ bridge });
        await dialogue.say(MARLA.hardwareOffline);
      }
    }
    if (start.mode === 'resume') {
      const snap = pendingResume; pendingResume = null;
      const ok = await resumeDuel({ snap, screens, stage, battle, dialogue, bridge, ext });
      if (!ok) { snapshot.clear(); snapshot.setUrlRoom(null); }
      continue;                                   // back to the title
    }
    pendingResume = null;                         // the host chose something else: that duel is theirs to forget
    if (start.mode === 'mp') {
      // Two phones, no campaign: both sides are Remote controllers and this screen is only the arena.
      await runMultiplayer({ screens, stage, battle, dialogue, bridge, ext, mp: start.mp, hp: +(params.get('myhp') || settings.get('hpA')) });
      continue;                                   // back to the title
    }
    if (tutorial && firstVisit && settings.get('chatter')) await dialogue.say(MARLA.intro);
    firstVisit = false;
    // Starting HP: the host's setting, unless a ?myhp= is pinned on the address for testing.
    const player = { name: PLAYER_NAME, title: 'House of the Red Lion', hp: +(params.get('myhp') || settings.get('hpA')) };
    let deck = start.deck ? [...start.deck] : [...STARTER_DECK];   // the title's "Adjust your deck" step
    let fight = 0; let showTutorial = tutorial;
    // Counters are a run resource, not a deck card: you start the run holding as many as the host set, a
    // counter that fires is gone, and losing a fight hands you one more for the next attempt.
    let counters = settings.get('simple') ? 0 : settings.get('countersA');   // the simple duel has no counters
    let quit = false;
    // The opening / finishing pose picks: the host panel and the versus screen set the same two settings.
    while (fight < LADDER.length && !quit) {
      const opp = { ...OPPONENTS[LADDER[fight]], round: fight + 1 };
      opp.hp = settings.oppHp(opp.hp);                             // the host may pin the opponent's HP too
      opp.counters = settings.get('countersB');
      if (params.get('opphp')) opp.hp = +params.get('opphp');      // testing: short fights
      const options = await loadPoseOptions();   // re-read each fight so freshly synced scenes show up
      panel.setPoseOptions(options);
      const picked = await screens.versus(player, opp, fight, { a: 'assets/arms2/red_ready.png', b: 'assets/arms2/blue_ready.png' },
        { ...options, opener: settings.get('opener') || null, finale: settings.get('finale') || null });
      settings.set('opener', picked.opener || ''); settings.set('finale', picked.finale || '');
      let again = true;
      let won = false, match = null;
      while (again) {                            // Host Controls -> Restart fight lands back here
        again = false;
        player.hp = +(params.get('myhp') || settings.get('hpA'));
        battle.show(true);
        match = new Match({ stage, battle, dialogue, bridge, player, opponent: opp, playerDeck: deck, counters, tutorial: showTutorial, ext, poses: picked });
        showTutorial = false;
        session.set({ mode: 'campaign', match, where: 'fight' });
        won = await match.run();
        session.set({ match: null, where: 'between' });
        if (match.ended === 'restart') { again = true; stage.reset(); continue; }
      }
      if (match.ended === 'quit') { quit = true; break; }          // Host Controls -> Back to title
      counters = match.countersLeft('a') + (won ? 0 : 1);   // what survived, plus one for losing
      const last = fight === LADDER.length - 1;
      const choice = await screens.result({ won, opp, fightIndex: fight, last, draw: match.ended === 'draw' });
      if (won && !last) {
        if (settings.get('chatter')) await dialogue.say(MARLA.reward, { modal: true });
        safe(() => music.sting('reward'));
        const pool = pickRewards(deck); const rewardCard = await screens.reward(pool); if (rewardCard) deck.push(rewardCard);
        deck = await screens.offerDeck(deck);     // optional: swap up to two more cards before the next bout
        fight++;
      } else if (won && last) { break; }
      else if (choice === 'retry') { /* same fight, same deck */ }
      else break;
    }
    stage.reset();
  }
}

/** Pick a phone duel back up after the big screen was reloaded: take the room back from the server (it keeps
 *  rooms for three hours and hands the tickets back), rebuild the host and the match from the snapshot, and
 *  carry on from the start of the phase that was interrupted. The phones do nothing at all. */
async function resumeDuel({ snap, screens, stage, battle, dialogue, bridge, ext }) {
  let room = null;
  try { room = await adoptRoom(snap.code); }
  catch (e) {
    console.warn('cannot resume', e);
    screens.banner(e.status === 404 ? `Room ${snap.code} has expired` : 'Could not reach the room', 2600);
    return false;
  }
  room.listen();
  if (snap.settings) settings.merge(snap.settings);
  await runMultiplayer({ screens, stage, battle, dialogue, bridge, ext,
    mp: { room, players: snap.players, decks: snap.decks, poses: snap.poses }, resume: snap });
  return true;
}
function pickRewards(deck) {
  const pool = [...REWARD_POOL]; const out = [];
  while (out.length < 3 && pool.length) { const i = Math.floor(Math.random() * pool.length); const id = pool.splice(i, 1)[0]; if (!out.includes(id)) out.push(id); }
  return out;
}
main().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:10px;bottom:10px;color:#f88;background:#000;padding:8px;z-index:999">${e.stack || e}</pre>`); });
