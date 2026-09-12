// The Playhouse: every two-arm emote scene, its clip, its filmstrip and its beat-by-beat script.
// Data comes from dashboard/data/emotes.json (written by joust/tools/sync_emotes.py out of
// robot-jousting/sim/out/emotes/manifest.json). Clips and strips live in dashboard/videos/emotes/.
// No build step: plain ES module, same idioms as dashboard.js.

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VID = '../videos/emotes/';

async function loadJSON(p) { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }

// Family order, display names and the one line that explains what the family is for.
const FAMILIES = [
  ['openers',   'Openers',        'Played before the first card. The opener sets the relationship: mirrored timing reads as respect, mismatched height and tempo read as status.'],
  ['hits',      'Hits',           'The physical answer to a landed blow. Every reaction is time-locked to the attacker’s impact frame — a flinch half a second late reads as random twitching.'],
  ['after_hit', 'After the Hit',  'The emotional aftermath. One arm gloats, the other sulks; the contrast in tempo is what reads as status.'],
  ['finale',    'Finales',        'The match is over. The longest scenes in the library: the dance has to read from across the room and the mope has to be unmistakable.'],
  ['idle',      'Idle',           'Dead time between turns, so these are the scenes the audience sees most. Small amplitudes, long periods, and never in unison.'],
];
const FAM_NAME = Object.fromEntries(FAMILIES.map(([k, n]) => [k, n]));

const S = { scenes: [], cur: null, playAll: false, filter: null, query: '' };

// ---------------------------------------------------------------- company (the card grid)

function card(sc) {
  const c = el('div', 'scene'); c.dataset.name = sc.name;
  const tags = ['A', 'B'].map(a => `<span class="tag ${a.toLowerCase()}"><i>${a}</i>${esc(sc.moods?.[a] || '')}</span>`).join('');
  const state = sc.problems?.length ? '<span class="badge bad">problems</span>'
    : sc.warnings?.length ? '<span class="badge warn">warnings</span>' : '<span class="badge ok">clean</span>';
  c.innerHTML = `<div class="thumb">
      <video src="${VID}${esc(sc.video)}" muted playsinline preload="metadata" loop></video>
      <span class="dur">${(sc.duration || 0).toFixed(1)}s</span><span class="state">${state}</span>
    </div>
    <div class="body">
      <div class="name">${esc(sc.title)}</div>
      <div class="tags">${tags}</div>
      <p class="blurb">${esc(sc.blurb)}</p>
      <span class="code">${esc(sc.name)}</span>
    </div>`;
  const v = c.querySelector('video');
  c.addEventListener('mouseenter', () => { v.currentTime = 0; v.play().catch(() => {}); });
  c.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
  c.addEventListener('click', () => { select(sc.name); $('#stage').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  return c;
}

function buildCompany() {
  const root = $('#families'); root.innerHTML = '';
  for (const [key, name, lead] of FAMILIES) {
    const list = S.scenes.filter(s => s.family === key);
    if (!list.length) continue;
    const sec = el('section', `family ${key}`); sec.id = `fam-${key}`;
    sec.appendChild(el('h3', null, `${esc(name)} <span class="count">${list.length} scene${list.length === 1 ? '' : 's'}</span>`));
    sec.appendChild(el('p', 'lead', esc(lead)));
    const grid = el('div', 'scenes');
    list.forEach(sc => grid.appendChild(card(sc)));
    sec.appendChild(grid); root.appendChild(sec);
  }
  // any family the manifest has that we did not name above (e.g. a scratch family) still gets a section
  const known = new Set(FAMILIES.map(f => f[0]));
  for (const key of [...new Set(S.scenes.map(s => s.family))].filter(k => !known.has(k))) {
    const list = S.scenes.filter(s => s.family === key);
    const sec = el('section', `family ${key}`); sec.id = `fam-${key}`;
    sec.appendChild(el('h3', null, `${esc(key)} <span class="count">${list.length} scenes</span>`));
    const grid = el('div', 'scenes'); list.forEach(sc => grid.appendChild(card(sc)));
    sec.appendChild(grid); root.appendChild(sec);
  }
}

function buildFilters() {
  const bar = $('#filters'); bar.innerHTML = '';
  const mk = (label, key) => {
    const b = el('button', key === S.filter ? 'on' : null, esc(label));
    b.addEventListener('click', () => { S.filter = key; buildFilters(); applyFilter(); });
    return b;
  };
  bar.appendChild(mk('All', null));
  for (const [key, name] of FAMILIES) if (S.scenes.some(s => s.family === key)) bar.appendChild(mk(name, key));
}

function applyFilter() {
  const q = S.query.trim().toLowerCase();
  for (const sec of document.querySelectorAll('.family')) {
    let shown = 0;
    for (const c of sec.querySelectorAll('.scene')) {
      const sc = S.scenes.find(s => s.name === c.dataset.name);
      const hay = [sc.name, sc.title, sc.blurb, sc.moods?.A, sc.moods?.B, ...(sc.tags || []),
                   ...(sc.notes || []).map(n => n.text)].join(' ').toLowerCase();
      const ok = (!S.filter || sc.family === S.filter) && (!q || hay.includes(q));
      c.classList.toggle('hidden', !ok); if (ok) shown++;
    }
    sec.classList.toggle('hidden', shown === 0);
  }
}

// ---------------------------------------------------------------- stage

function checksHTML(sc) {
  const CAP = 300, REACH = 0.30;
  const row = (label, a, b, fmt = v => v) =>
    `<div class="row"><b>${esc(label)}</b><span>A ${esc(fmt(a))} &nbsp; B ${esc(fmt(b))}</span></div>`;
  const A = sc.arms?.A?.checks || {}, B = sc.arms?.B?.checks || {};
  const joints = Object.keys(A.peak_dps || {}).filter(j => j !== 'gripper');
  const bars = joints.map(j => {
    const bar = (side, v) => {
      const pct = Math.min(100, (v / CAP) * 100);
      return `<div class="bar ${side}${v > CAP ? ' over' : ''}" title="${v} deg/s of ${CAP}"><i style="width:${pct}%"></i></div>`;
    };
    return `<span class="lbl">${esc(j.replace('shoulder_', '').replace('_flex', '').replace('wrist_', ''))}</span>
            ${bar('a', A.peak_dps[j] || 0)}${bar('b', (B.peak_dps || {})[j] || 0)}`;
  }).join('');
  const p = sc.pair || {};
  const state = sc.problems?.length ? `<span class="badge bad">${sc.problems.length} problem(s)</span>`
    : `<span class="badge ok">no problems</span>`;
  const warn = (sc.warnings || []).length ? `<span class="badge warn">${sc.warnings.length} warning(s)</span>` : '';
  const lists = [
    ...(sc.problems || []).map(x => `<li><b>problem:</b> ${esc(x)}</li>`),
    ...(sc.warnings || []).map(x => `<li>${esc(x)}</li>`),
  ].join('');
  return `<div class="row"><b>state</b><span>${state} ${warn}</span></div>
    ${row('hand reach', A.reach_max, B.reach_max, v => `${(+v).toFixed(2)} m`)}
    ${row('hand z min', A.hand_z_min, B.hand_z_min, v => `${(+v).toFixed(2)} m`)}
    ${row('tip z min', A.tip_z_min, B.tip_z_min, v => `${(+v).toFixed(2)} m`)}
    ${row('lift min', A.lift_min, B.lift_min, v => `${Math.round(v)}°`)}
    <div class="row"><b>blades</b><span>closest ${esc(p.min_blade_cm)} cm at ${esc(p.min_blade_at)}s${p.blade_contacts ? `, ${p.blade_contacts} contact samples` : ''}</span></div>
    <div class="row"><b>limits</b><span>reach &le; ${REACH} m &middot; tip z &ge; 0.02${sc.allow_table ? ' (table taps allowed)' : ''}${sc.allow_touch ? ' &middot; blade contact intended' : ''}</span></div>
    <div class="bars"><span class="lbl">peak deg/s</span><span class="lbl">A</span><span class="lbl">B</span>${bars}</div>
    ${lists ? `<ul>${lists}</ul>` : ''}`;
}

function buildScript(sc) {
  const ol = $('#st-script'); ol.innerHTML = '';
  for (const n of sc.notes || []) {
    const li = el('li', n.arm, `<span class="t">${(+n.t).toFixed(2)}s</span><span class="who">${esc(n.arm)}</span><span>${esc(n.text)}</span>`);
    li.dataset.t = n.t;
    li.addEventListener('click', () => { const v = $('#st-video'); v.currentTime = Math.max(0, +n.t - 0.15); v.play().catch(() => {}); });
    ol.appendChild(li);
  }
  const tl = $('#st-timeline');
  tl.querySelectorAll('.mark').forEach(m => m.remove());
  const dur = sc.duration || 1;
  for (const n of sc.notes || []) {
    const m = el('span', `mark ${n.arm.toLowerCase()}`);
    m.style.left = `${Math.min(100, (n.t / dur) * 100)}%`; tl.appendChild(m);
  }
}

function select(name) {
  const sc = S.scenes.find(s => s.name === name); if (!sc) return;
  S.cur = sc;
  document.querySelectorAll('.scene').forEach(c => c.classList.toggle('on', c.dataset.name === name));
  $('#st-family').textContent = FAM_NAME[sc.family] || sc.family;
  $('#st-title').textContent = sc.title;
  $('#st-moodA').textContent = sc.moods?.A || '';
  $('#st-moodB').textContent = sc.moods?.B || '';
  $('#st-blurb').textContent = sc.blurb || '';
  $('#st-checks').innerHTML = checksHTML(sc);
  $('#st-strip').src = VID + sc.strip;
  buildScript(sc);
  const v = $('#st-video');
  v.src = VID + sc.video; v.loop = $('#st-loop').checked; v.playbackRate = $('#st-slow').checked ? 0.5 : 1;
  v.play().catch(() => {});
  $('#st-arms-msg').textContent = '';
  location.hash = `s=${sc.name}`;
}

function step(d) {
  const i = S.scenes.findIndex(s => s.name === S.cur?.name);
  select(S.scenes[(i + d + S.scenes.length) % S.scenes.length].name);
}

function tick() {
  const v = $('#st-video'), sc = S.cur;
  if (sc && v.duration) {
    $('#st-fill').style.width = `${(v.currentTime / v.duration) * 100}%`;
    const t = v.currentTime;
    let last = null;
    for (const li of $('#st-script').children) {
      const ok = +li.dataset.t <= t + 0.02;
      li.classList.toggle('past', ok); li.classList.remove('now');
      if (ok) last = li;
    }
    if (last) { last.classList.add('now'); last.classList.remove('past'); }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- arms

async function performOnArms() {
  const sc = S.cur; if (!sc) return;
  const btn = $('#st-arms'), msg = $('#st-arms-msg');
  btn.disabled = true; msg.textContent = 'sending…';
  const swap = $('#st-swap')?.checked || false;
  try {
    const r = await fetch('../../api/emote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: sc.name, swap }),
    });
    const j = await r.json();
    msg.textContent = j.error ? `error: ${j.error}`
      : `queued job ${j.job} — ${sc.name} on arm ${swap ? 'B' : 'A'}, ${sc.name}@B on arm ${swap ? 'A' : 'B'}`;
  } catch (e) {
    msg.textContent = `no server: ${e}`;
  } finally {
    btn.disabled = false;
  }
}

async function poll() {
  try {
    const s = await loadJSON('../../api/status');
    for (const [key, arm] of [['armA', 'a'], ['armB', 'b']]) {
      const pill = document.querySelector(`.pill[data-arm="${key}"]`); if (!pill) continue;
      const d = s[key] || {};
      const state = d.offline ? 'off' : (d.busy || d.playing ? 'busy' : 'on');
      pill.classList.remove('on', 'off', 'busy', 'unknown'); pill.classList.add(state);
      pill.querySelector('b').textContent = d.offline ? 'offline' : (d.moving || d.busy ? 'busy' : (d.move || 'ready'));
    }
  } catch (e) {
    for (const pill of document.querySelectorAll('.pill[data-arm]')) {
      pill.classList.remove('on', 'busy'); pill.classList.add('unknown');
      pill.querySelector('b').textContent = 'no server';
    }
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  let man;
  try {
    man = await loadJSON('../data/emotes.json');
  } catch (e) {
    $('#st-title').textContent = 'No scenes yet';
    $('#st-blurb').textContent = 'dashboard/data/emotes.json is missing. Generate the scenes with `cd sim && ../.venv/bin/python emote.py ALL`, then run `python3 tools/sync_emotes.py`.';
    $('#foot').textContent = String(e);
    return;
  }
  const order = Object.fromEntries(FAMILIES.map(([k], i) => [k, i]));
  S.scenes = (man.scenes || []).slice().sort((a, b) =>
    (order[a.family] ?? 9) - (order[b.family] ?? 9) || a.name.localeCompare(b.name));

  buildFilters(); buildCompany(); applyFilter();

  const nav = $('#famnav');
  for (const [key, name] of FAMILIES) {
    if (!S.scenes.some(s => s.family === key)) continue;
    const a = el('a', null, esc(name)); a.href = `#fam-${key}`; nav.appendChild(a);
  }

  const v = $('#st-video');
  $('#st-play').addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
  v.addEventListener('play', () => { $('#st-play').textContent = 'Pause'; });
  v.addEventListener('pause', () => { $('#st-play').textContent = 'Play'; });
  $('#st-prev').addEventListener('click', () => step(-1));
  $('#st-next').addEventListener('click', () => step(1));
  $('#st-all').addEventListener('click', e => {
    S.playAll = !S.playAll; e.currentTarget.classList.toggle('on', S.playAll);
    if (S.playAll) { $('#st-loop').checked = false; v.loop = false; v.play().catch(() => {}); }
  });
  v.addEventListener('ended', () => { if (S.playAll) step(1); });
  $('#st-loop').addEventListener('change', e => { v.loop = e.target.checked; if (e.target.checked) { S.playAll = false; $('#st-all').classList.remove('on'); } });
  $('#st-slow').addEventListener('change', e => { v.playbackRate = e.target.checked ? 0.5 : 1; });
  $('#st-showstrip').addEventListener('change', e => {
    $('#st-strip').classList.toggle('hidden', !e.target.checked);
    $('#st-video').classList.toggle('hidden', e.target.checked);
  });
  $('#st-timeline').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    if (v.duration) v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  });
  $('#st-arms').addEventListener('click', performOnArms);
  $('#search').addEventListener('input', e => { S.query = e.target.value; applyFilter(); });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === ' ') { if (v.paused) v.play().catch(() => {}); else v.pause(); e.preventDefault(); }
  });

  const want = new URLSearchParams(location.hash.slice(1)).get('s');
  select(S.scenes.some(s => s.name === want) ? want : S.scenes[0].name);

  const clean = S.scenes.filter(s => !s.problems?.length).length;
  $('#foot').textContent = `${S.scenes.length} scenes, ${clean} with no problems · generated ${man.generated || '?'}`
    + (man.synced ? ` · synced ${man.synced}` : '')
    + (man.reel ? ' · ' : '');
  if (man.reel) {
    const a = el('a', null, 'watch the whole reel'); a.href = VID + man.reel; a.target = '_blank';
    $('#foot').appendChild(a);
  }

  tick(); poll(); setInterval(poll, 4000);
}

boot();
