// A resumable host. The big screen owns every rule and every card, so a reload of the big screen used to
// kill a phone duel outright: the phones kept polling a room whose host had forgotten the fight. This module
// is the cure, and it is deliberately small.
//
//   * the room code lives in the page URL (?room=CODE), so the address bar alone says which duel this is;
//   * a snapshot of the whole host state goes into sessionStorage after every phase change;
//   * on load, main.js reads both, POSTs /api/mp/rooms/<code>/adopt to take the room back (the server keeps
//     rooms for three hours and hands the tokens back), and rebuilds MpHost + Match from the snapshot.
//
// sessionStorage, not localStorage: a snapshot belongs to THIS tab. Two big screens on one machine are two
// different duels, and a snapshot must not outlive the tab that made it.
//
// What resuming promises: the fight continues from the START of the phase that was interrupted. A planning
// phase comes back with the same hands (nobody is re-dealt, nobody loses a card to a reload); an exchange
// comes back at its first beat with both locked chains intact, which is why the snapshot's `core` is frozen
// at the phase boundary and only `revealed` moves during the exchange -- replaying beat 1 after beat 2 had
// already landed would apply its damage twice.

const KEY = 'tilt.host.snapshot';
export const SNAP_VERSION = 3;

// ---- the room code in the URL ---------------------------------------------------------------------------
export function urlRoom() {
  try { return (new URLSearchParams(location.search).get('room') || '').toUpperCase() || null; }
  catch (e) { return null; }
}
export function setUrlRoom(code) {
  try {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch (e) {}
}

// ---- the snapshot ---------------------------------------------------------------------------------------
export function save(snap) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...snap, v: SNAP_VERSION, at: Date.now() })); }
  catch (e) { console.warn('snapshot save failed', e); }
}
export function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!s || s.v !== SNAP_VERSION || !s.code) return null;
    return s;
  } catch (e) { return null; }
}
export function clear() { try { sessionStorage.removeItem(KEY); } catch (e) {} }

/** The snapshot this page should offer to resume: one that exists, matches the room in the URL, and is not
 *  a finished duel. Null otherwise. */
export function resumable() {
  const code = urlRoom(); if (!code) return null;
  const s = load(); if (!s || s.code !== code) return null;
  if (s.phase === 'over') return null;
  return s;
}

// ---- taking the room back from the server ---------------------------------------------------------------
/** POST /api/mp/rooms/<code>/adopt -> { code, tokens, urls, rev, seq, seen }. The server keeps a room for
 *  three hours after the last publish or action, so a reload (or a whole new browser) can pick it up again.
 *  Throws if the room has expired, which is the signal to offer a plain title screen instead. */
export async function adopt(code, base = '') {
  const r = await fetch(`${base}/api/mp/rooms/${code}/adopt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!r.ok) { const e = new Error('adopt ' + code + ' -> ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
