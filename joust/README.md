# The Tilt of Tiltford

Front end for the robot-jousting game: a Slay-the-Spire-style card battler where every card is a move the
real SO-101 / SO-100 arms can play. Marla, keeper of The Tilted Crown, is the guide; the town's annual Tilt is
the tournament: the Squire, Sir Percival of the Lily, then the Iron Champion.

```bash
python3 server.py                    # http://localhost:8770  (sim only, no hardware needed)
node --test tests/rules.test.mjs     # rules + deck unit tests
python3 tests/test_server_requests.py # what server.py sends the arm daemon (no socket is opened)
```

No build step: vanilla ES modules, procedural audio (no sample files), works offline from a folder.

## How a turn works

1. **Plan.** 3 energy, a hand of 5. Click cards (or press 1-5) into the three beat slots, then Lock in (Enter).
   Marla reads the opponent's pre-lock twitch and tells you the category of their first beat.
2. **Charge.** Both arms drive to the centre.
3. **Exchange.** Beat by beat, your card N meets their card N (`src/game/rules.js`):
   attack vs guard on the same line = blocked (blocker gains Riposte +2); wrong line = hit +1;
   attack vs attack, same line = clash, different lines = both hit; attack vs feint = punished (+2);
   feint vs guard = guard Exposed (its next guard fizzles); attack on an idle arm = clean hit (+1) and Stagger
   (the victim loses the next beat); Thrust ignores guards; Parry doubles the next attack; Wind Up adds +3;
   Brace blocks both lines and cannot be staggered or exposed.
4. **Return.** Arms retreat. Cards you played go to the discard pile; **what you did not play stays in your
   hand**, and a hand over 5 is trimmed back to 5 by discarding at random. Next turn you draw back up to 5
   (plus any Flourish extras, so a hand can be bigger than 5 *during* a turn). First to 0 HP loses.

### The rail: voltage, Rush, Full Tilt, Counter

The arms ride stepper rails toward each other, so getting to the centre first is a weapon.

- **VOLTAGE** (0-2, starts at 0 every fight). Every **feint that actually gets played** loads +1, whatever else
  happens to it that beat: a feint is both a lie and fuel. The HUD shows it next to each arm.
- **Rush** (1 energy, 4 damage, needs 1 voltage). Spends a voltage and races down the rail: it *lands before any
  swing*, so an attack that meets a Rush is knocked back and deals nothing. **Any guard stops a Rush** (line does
  not matter) and earns the usual Riposte / Parry. Rush into a feint punishes it; into an idle arm it is a clean
  hit and a Stagger. Two Rushes meet mid-rail for no damage. With no voltage it **fizzles**: the beat is played
  as Rest and the energy is gone.
- **FULL TILT.** A Rush fired in the beat immediately after your own Rush (`status.fired`) goes full tilt:
  6 damage, **through any guard, brace included**. It beats a plain Rush head-on. Miss a beat and the chain
  resets, so it has to be back to back.
- **Counter** (free, not a deck card). While you hold one, the Counter sits in your hand every turn. Any attack,
  Rush or Full Tilt into it is stopped and thrown straight back: **the attacker takes that card's base damage**
  (no riposte / wind up / parry — those are consumed and wasted), the defender takes nothing, and the Counter is
  **spent**. A feint into a Counter is wasted (and still loads); two Counters are a standoff; Exposed does not
  touch it, but a staggered arm cannot hold it.
- **Where Counters come from.** You start a run holding **1**. One that fires is gone. **Losing a fight hands you
  one more** for the next attempt, and whatever you still hold carries into the next fight (`main.js` keeps the
  count alongside the deck). Opponents bring their own: the Squire 0, Sir Percival 1, the Iron Champion 1.

Winning a fight adds a card (pick 1 of 3) to the deck for the next round.

Each beat resolves **after** its animation: both arms swing, the hardware (or the timer) says the beat is
over, and only then do that beat's two cards turn over together, followed by the outcome word. The impact
effects — damage numbers, shakes, stamps, the crowd — stay at the impact instant inside the swing.

## Host controls

The big screen is run by a person standing next to it. The **`⚙ host`** button in the settings strip (top
right) opens a drawer over the stage; `Esc` or the button closes it, and closed it is `display:none`, so it
never eats a click meant for the arena. Everything in it is oversized on purpose — the host is usually a metre
back. Three sections:

**Fight** — what can be done to the fight that is on the stage right now.

| Control | What it does |
|---|---|
| **Pause / Resume** | Freezes the match *between beats*: no new beat, animation, pose or plan timer advances. A `Paused` banner goes up on the stage and on both phones, and CSS animations inside the stage stop where they are. |
| **Skip animation** | Ends the current beat wait, opening pose or finale early. The beat's **impact still lands** — that is where the damage is — the screen just stops swinging. |
| **Restart fight** | Same knights, decks and settings, back to turn 1. |
| **End fight** | *Red wins* / *Blue wins* / *Draw*, then the normal result screen. |
| **Back to title** | Ends the fight and closes the room. |

Restart, Back to title, Kick and Reset are two-step: the second press within four seconds does it.

**Settings** — applied to the *next* fight, and persisted in `localStorage` (`src/game/settings.js`, key
`tilt.settings`): starting HP per side (10–50), counters per side (0–3), voltage max (fixed at 2), the sim beat
length (1.0–2.5 s; live arms keep the move library's 1.4 s), the **plan timer**, the opening and finishing pose
(the same catalogue the versus screen and the lobby offer — changing it here changes what the next fight uses),
sim/live arms, the four audio toggles, a **show tells** switch for the campaign and a **Marla chatter** switch
that skips her dialogue entirely. The strip's own buttons stay as shortcuts and stay in step with the drawer;
the audio toggles now persist too (`tilt.audio`).

**Phone duel** — only when a room is open. The room code and both links, each side's name and connection state
(the age of that phone's last poll, straight from the server), **Force lock now**, **Kick and reissue**,
**Swap seats** (lobby / between fights), **Rematch now** and **Auto-forfeit after N missed plan timers**.

### The plan timer

`off / 30 / 60 / 90 / 120 s`. When set, every planning phase shows a countdown under the round title and on
both phones; at zero, every side that has not locked in is **auto-locked with its current slots** and unfilled
beats rest. In the campaign it applies to the player's own card table too — the countdown also rides on the
**Lock in** button. Pause freezes it; Skip animation deliberately does not touch it.

The phones post a `draft` action on every tap, so "current slots" means the cards that player really chose, not
three rests. A side that misses **N** plan timers in a row (Auto-forfeit) loses the fight; if *both* phones run
out on the same timer, nobody is playing and it is called a draw.

## Deck manager

Before the run and between fights you may **swap up to two cards**: each swap takes one card out of the deck
and puts one from the catalogue in, so the deck never changes size. `screens.deck(deck, pool)` on the big
screen, the same thing on a phone, and `DeckEdit` in `src/net/room.js` holds the bookkeeping for both. The
counter is a run resource, not a deck card, so it is never in the pool.

## Two phones, one arena (1v1 multiplayer)

`Play 1v1 from phones` on the title screen. The big screen is the **host** and the only place the rules run;
`server.py` is a mailbox and a relay (in memory, no database); the phones are thin clients that render what
the host publishes and post back their choices.

```
big screen  --publish(rev, public, private.a, private.b)-->  server.py  --long-poll-->  phone A / phone B
big screen  <--long-poll /acts (join, deck, lock, ready)---   server.py  <--POST------   phone A / phone B
```

The lobby shows two QR codes (Red knight, Blue knight) with the links printed underneath, the names as they
arrive, the pose pickers, and a Start that lights up once both have joined. Each phone gets a join screen,
the deck manager, its own hand (tap a card into a beat, tap a beat to take it back), energy coins, VOLTAGE
and Counter chips, a Lock in button, the two cards of each beat as the arena reveals them, and a Ready
button for a rematch. A phone can be reloaded at any point — the token lives in the URL.

The server endpoints (all JSON, all `/api/mp/`):

| route | who | what |
|---|---|---|
| `POST /rooms` | host | `{ code, tokens: {a,b}, urls: {a,b} }`. 4-letter code, 16-char url-safe tokens. |
| `POST /rooms/<code>/publish` | host | `{ rev, public, private: {a,b} }`. Bumps the rev and wakes both phones. |
| `GET /rooms/<code>/acts?since=K&wait=25` | host | long-polls the players' actions; carries `seen` and `now`. |
| `GET /rooms/<code>/state` | host | `{ rev, seq, seen: {a,b}, now, urls }` — who is still out there. No tokens, no view. |
| `POST /rooms/<code>/adopt` | host | take a room back after a reload: `{ code, tokens, urls, rev, seq, seen }`. |
| `POST /rooms/<code>/reissue` | host | `{side}` → a new ticket for that seat; the old token is **retired**, not deleted. |
| `POST /rooms/<code>/swap` | host | the two tickets trade colours. |
| `GET /p/<token>?rev=N&wait=25` | phone | `{ side, code, rev, public, private }` — **that side's private view only**. |
| `POST /p/<token>/act` | phone | `{type:'join'\|'deck'\|'lock'\|'ready'\|'draft', ...}`; the server stamps `side` and `seq`. |
| `GET /qr.svg?text=...` | host | an SVG QR code (server-side, the python `qrcode` package). |

Every poll and every action stamps a **`seen`** timestamp for that seat, so the host can say "connected" or
"40 s ago" per phone without any extra chatter; a phone parked in a long-poll keeps its stamp fresh, because
the wait loop re-stamps every second. A **retired** token (its seat was reissued) answers `410 {"error":
"reissued"}` to both phone routes, which is how the old phone knows to say so instead of looping for ever.

### Surviving a reload of the big screen

The host owns every rule and every card, so a reload of the big screen used to kill the duel outright. Now:

* the room code lives in the page URL (`?room=CODE`), put there the moment the room is created;
* a snapshot of the whole host state goes into **`sessionStorage`** after every phase change — both players,
  both decks, the tokens, the settings and poses in force, the revealed beats, and the match itself (turn, hp,
  statuses, hands, draw and discard piles, the locked chains);
* on load with a room in the URL the title leads with **"Resume the phone duel in room CODE"** (and a plain
  title otherwise, plus a *Forget it* that drops the snapshot).

Resuming POSTs `/adopt`, which hands the tokens — and so the QR links — back, rebuilds `MpHost` and the `Match`
from the snapshot (`new Match({ ..., resume })`, which hydrates the decks and status instead of dealing), then
republishes and carries on **from the start of the phase that was interrupted**: a planning phase comes back
with the same hands, an exchange restarts at its first beat. That is why the snapshot's match state is frozen
at the phase boundary and only the revealed beats move during an exchange — replaying beat 1 after beat 2 had
landed would apply its damage twice. **The phones do nothing at all**; they never even notice.

### When a player walks away

The plan timer, force lock, kick and auto-forfeit are one feature between them: nobody can freeze the arena by
wandering off. **Kick and reissue** mints a new ticket for a seat — the old phone is told the seat was
reissued, the lobby QR and the drawer show the new code and link, and the seat's **name, deck and cards stay
exactly where they are**, so the fight carries straight on when the new phone joins. The rematch wait gets the
same treatment: **Rematch now** starts the next fight without waiting for both Ready presses.

Long-polling is one `threading.Condition`: a publish bumps `rev`, an action bumps `seq`, both `notify_all()`,
and a waiter sleeps on the condition until its number moves or `wait` seconds pass. No busy loops. Rooms
expire three hours after the last activity, and a few dozen are kept at most.

The host trusts nothing a phone sends: a locked chain is filtered down to cards really in that hand and
really affordable (`sanitizeChain`), a deck must be the starter's size, hold only real cards and differ by
at most two (`validateDeck`), and a lock for the wrong turn is dropped. A `draft` is only ever used as the
chain a force lock plays, and it goes through the same filter.

There is still no authentication anywhere: a 4-letter room code is the only thing standing between a stranger
and `/adopt`, which hands back that room's tokens. That is the same trust model the room codes always had — it
is a tavern game on a local network, not a bank — but do not put a room on a public tunnel and read the code
out to a room full of people you would not hand the phones to.

## Running it for two phones

```bash
python3 server.py 8770          # binds 0.0.0.0 and prints the LAN URL; HOST=127.0.0.1 to keep it local
```

Phones must reach this machine. On the same Wi-Fi the QR codes point at `http://<lan-ip>:8770/play/?t=...`
(found from the default-route interface). If the venue's Wi-Fi isolates clients from each other, put a tunnel
in front and point the QR codes at it:

```bash
cloudflared tunnel --url http://localhost:8770     # prints a public https URL, no account needed
PUBLIC_URL=https://<whatever>.trycloudflare.com python3 server.py 8770
```

`ngrok http 8770` works the same way. **On this machine `ngrok` is installed (`/opt/homebrew/bin/ngrok`) and
`cloudflared` is not** — `brew install cloudflared` if you want the no-account option.

`chrisshi.com` resolves to GitHub Pages, which serves static files only and cannot run this Python server, so
it cannot host the host. To use that domain you would need a *named* Cloudflare tunnel plus a CNAME for a
subdomain of `chrisshi.com`, which needs DNS access to the domain.

## Layout

| Path | What |
|---|---|
| `src/game/cards.js` | Card catalogue. Every card carries `hw`, the move name in `robot-jousting/arm/motions_tuned.json`. `taught: false` = not tuned on the arm yet (plays in sim, `fallback` on hardware). |
| `src/game/rules.js` | Pure beat resolution, including the rail (voltage / Rush / Full Tilt / Counter). Tested in `tests/rules.test.mjs`. |
| `src/game/ai.js` | Opponent chain chooser (sampled chains, profile-weighted scoring, softmax) and the tell (the champion bluffs). |
| `src/game/match.js` | One fight: decks, turn loop, orchestration of stage / table / dialogue / bridge / audio. |
| `src/game/script.js` | Marla's lines, opponents, decks. |
| `src/ui/stage.js` | The arena scene (town + arena sheets), arm sprites, move timelines (`TIMELINES`, keyed by hw move name), reactions, fx, and the two-arm emote scenes (`SCENES`, `MOPES`, `stage.playScene()`). |
| `src/ui/battle.js` | HUD banners, hand, beat slots, energy, duel row. |
| `src/ui/dialogue.js` | Marla's speech box with the garbled typewriter voice. |
| `src/ui/screens.js` | Title, versus, reward, result overlays, the phone-duel lobby (QR codes) and the deck manager. |
| `src/net/room.js` | The room client both ends share: `HostRoom` / `PlayerClient` long-polling, `DeckEdit`, `validateDeck`, `qrSrc`. |
| `src/net/mphost.js` | The host half of a phone duel: publishes the view, turns phone locks into the match's player controllers, runs the rematch loop, and owns force lock / auto-forfeit / reissue and the host snapshot. |
| `src/net/snapshot.js` | The resumable host: the room code in the URL, the sessionStorage snapshot, and `/adopt`. |
| `src/game/hostctl.js` | The pausable, skippable clock every wait in a fight sleeps on, plus `session` — what is on the stage and the actions the drawer may call. |
| `src/game/settings.js` | The host settings (HP, counters, beat length, plan timer, poses, tells, chatter, auto-forfeit), persisted in localStorage. |
| `src/ui/hostpanel.js` | The Host Controls drawer behind the `⚙ host` button. A renderer only: every button calls into `hostctl` or `settings`. |
| `play/` | The phone client (`index.html`, `play.js`, `play.css`). Mobile portrait, no build step, reuses `cardEl` and `styles.css` for the card faces. |
| `src/audio/audio.js` | Web Audio core: buses, synth helpers, sfx, the built-in fallbacks for voice / music / ambience. |
| `src/audio/foley.js` | **The arm sound.** Knight foley driven by the real 50 Hz trajectories (`assets/motions/moves.json`, made by `tools/make_moves.py`): blade whoosh from the blade-tip speed, chainmail and leather on wind-ups and reversals, armour clanks as a guard sets, a steel "shing" as the sword cocks, steel clangs / shield thuds / binds at impact, randomized variants, sub-bass and drive for weight. Same API as servo.js. |
| `src/audio/servo.js` | The trajectory analysis (velocities, reversals, stops, jaw snaps) foley.js builds on, plus the original robotic servo-whine timbres kept for reference. |
| `src/audio/voice.js` | Formant-synth gibberish voices (Marla, the Squire, Percival, the Champion, a Herald) with moods; `say()` types text locked to the audio clock. |
| `src/audio/music.js` | The score: one theme jingle in every mood, layered stems that build with `setIntensity()` as health drops. |
| `src/audio/crowd.js` | Crowd babble + reactions (cheer, ooh, gasp, laugh, boo, chant, ko, aww). **Off by default**: the music carries the ambience; the `crowd` button in the settings strip turns it on. |
| `src/game/barks.js` | In-character lines for both fighters (Lionheart, the Squire, Sir Percival, the Champion) and the Herald: gloats when a feint works, jeers when one is punished, clash and parry banter, wind-up roars, taunts while you dither, dance boasts, muttered excuses, wins and losses. ~230 lines each. |
| `dev/*_lab.html` | Audition pages: `audio_lab` (servo per move, velocity plot), `voice_lab`, `music_lab` (moods, stings, intensity), `crowd_lab`. |
| `dashboard/` | Arm Studio: the **Theatre** (each MuJoCo clip with the foley locked to its timeline, playlist of all moves), the **interactions matrix** (every card vs every card from the game's rules, with the simulated blade distance; click a cell to hear the whole cue), the move library with clips and audit, trajectory and pair viewers. |
| `assets/crowd/` | Painted spectators (from the crowd sheet) placed on the grandstand tiers and along the fence; they jump when the crowd cheers. |
| `src/hw/bridge.js` | Hardware seam: `SimBridge` (timers) / `ArmBridge` (talks to `server.py`, and **waits for the real arms** — see below). |
| `server.py` | Static server + `/api/status`, `/api/play`, `/api/exchange`, `/api/home` proxied to the arm daemons, + the `/api/mp/*` multiplayer mailbox. |
| `tools/slice_sheets.py` | Cuts the four source sheets in `assets/raw/` into `assets/{sprites,arms,arms2,town,arena}/` with `atlas.json` (sizes + ground anchors). |
| `tools/mock_daemon.py` | A faithful fake of `arm/arm_daemon.py`: same routes and shapes, timing from the same motion file, a gantry with states and reference, `--fail` to drop an arm, and a log of every request. |
| `start_live.sh` | Bring up a live show: check the three serial devices, start the daemon, start the server with `ARM_A_URL` / `ARM_B_URL` / `JOUST_REPO`. `--mock` rehearses it with no hardware. |
| `tests/rehearse_live.py` | The whole live path end to end against the mock: the request sequence *and* the waits. |

## Driving the real arms

1. Start the arm daemon from the robot-jousting repo (`arm/arm_daemon.py` on port 8766). **One daemon drives
   both arms**: every POST body carries `{"arm": "A"|"B"}` and `GET /status` answers
   `{"arms": {"A": {busy, last, torque, pose, model}, "B": {...}}, "gantry": {...}}`. `server.py` adds the
   `arm` field to every request it makes, splits that one status into `armA` / `armB` for the front end, and
   marks a side offline when the daemon does not report it. `ARM_B_URL` defaults to `ARM_A_URL`; set it only
   if the two arms really are two separate daemons (that wiring still works).
2. `./start_live.sh` (starts the daemon if needed and the game server wired to it; `joust/` lives inside the repo, so the compiler is found automatically)
3. Open `http://localhost:8770/?hw=live` (or press the `arms` button). Each turn the front end sends both
   three-move chains to `/api/exchange`; with `JOUST_REPO` set the server compiles them with `sim/chain.py`
   into CHAIN_A / CHAIN_B and plays both arms in sync, otherwise it plays the moves one beat at a time.
   The screen beat is 1.4 s in live mode, matching the move library's BEAT.

**Waiting for the metal.** In sim a timer is the truth; on real arms it is not — the daemon holds a busy lock
for the whole of a `/play`, an ease-in and an ease-out bracket every motion, and a compiled chain runs as one
motion of unknown length. So `ArmBridge` never returns on a fixed timer alone:

- a whole-chain exchange times its beats off the chain's own clock (`t0 + n × 1.4 s`, so beat 3 still lines up
  after two beats of jitter) and then polls `GET /api/status` every 150 ms until neither arm reports `busy`
  (8 s cap, then the show goes on regardless);
- the per-move fallback waits at least `beatMs` and then polls to idle after each beat (6 s cap);
- `returnHome()` waits for idle *before* asking for rest, because the daemon refuses `/rest` on a busy arm;
- `emote()` (the opening salute, the finishing pose) posts the scene and then waits for the arms to go idle
  again (30 s cap), and `match.js` runs the screen scene alongside it and waits for both — so the game never
  moves on mid-pose. `SimBridge.emote` resolves after a nominal 2 s so the sim shows the same pause.

`waitIdle()` also rides out the lag between posting a job and the arms starting: an idle reading only counts
once it has seen `busy`, or after a short grace period. A stuck daemon delays the show, it never freezes it.

**What a live turn actually does.** Everything that drives metal is a *job*: the POST returns
`{ok, job: id}` at once and the bridge watches `GET /api/job?id=…` for its `phase` and `steps`, so nothing
ever blocks the browser.

| Screen phase | Front end | server.py | daemon |
|---|---|---|---|
| before the fight | `bridge.prepare()` | `POST /api/prepare` | `/status`, `/gantry/home` (if not referenced), `/gantry/apart`, `/rest` ×2 |
| opening pose | `bridge.emote(scene, {swap})` | `POST /api/emote` | `/play` on both arms — **and the scene's carriage channel** |
| charge | `bridge.charge()` alongside `stage.charge()` | `POST /api/charge` | `/gantry/together` (the 19.5 in stop) |
| exchange | `bridge.startExchange()` then `bridge.beat(i)` ×3 | `POST /api/exchange` | compile with `sim/chain.py`, then `/play CHAIN_A` + `/play CHAIN_B` |
| return | `bridge.retreat()` alongside `stage.retreat()`, then `returnHome()` | `POST /api/retreat`, `/api/home` | `/gantry/apart`, then `/rest` ×2 |
| finale | `bridge.emote(scene, {swap: winner==='b'})` | `POST /api/emote` | `/play` ×2 with the carriage channel |

The charge and the return are **composed** from `/gantry/together`, `/api/exchange` and `/gantry/apart`
rather than handed to the daemon's own `/turn` routine. `/turn` is the right shape for a demo and the wrong
shape for this game: it is one blocking call that holds both arms' busy locks from the first gantry move to
the last, so the screen could not pace its three beats inside it; it always salutes; and it plays whatever
`CHAIN_A` / `CHAIN_B` happen to be on disk rather than compiling *this* turn's two chains first. Composing
costs three requests and buys beat-level synchronisation and a working Abort.

### A live beat is not 1.4 s

This is the thing most likely to make the show look broken, so it is worth being precise. **1.4 s is the
move library's BEAT — the trajectory's share of a `/play`, and nothing else.** What the daemon actually does
for one move is: ease to rest, ease into the first key, settle 0.1 s, play the trajectory, **hold the last
pose for 1.5 s**, then ease home at 60 °/s. Measured off `motions_tuned.json`:

| move | trajectory | whole `/play` | blow lands at |
|---|---|---|---|
| `ATTACK_HIGH` | 1.26 s | **4.54 s** | 0.29 of the beat |
| `FEINT_HIGH` | 2.26 s | **5.48 s** | — |
| `BLOCK_HIGH` (arm B) | 1.20 s | **5.76 s** | 0.26 of the beat |
| `EN_GARDE_OPENER` | 5.92 s | **9.33 s** | — |
| `SAMURAI_FINISH` | 10.40 s | **13.04 s** | — |

Pacing the screen at 1.4 s would run it three beats ahead of the arms inside one turn. So `server.py` owns
the schedule and the front end only consumes it:

- **`GET /api/moves`** gives every move's real timing on both arms (the two arms differ: `BLOCK_HIGH` ends
  far from arm B's rest, so B's return is twice A's, and a beat is the slower of the two).
- **The exchange job carries `beats`, `lead` and `tail`.** With the compiler, `beats` is `sim/chain.py`'s own
  boundaries — it *stretches* a beat whenever the connector into the next move will not fit, so a real pair
  compiles to e.g. 1.79 / 1.91 / 1.46 s. Without it, `beats` is built from the measured per-move totals.
  `lead` is the ease-in before the trajectory clock starts, measured off the real poses rather than guessed.
- **`ArmBridge.beatMsFor(i)` / `impactAtFor(i)`** hand those to `match.js`, which passes them to
  `stage.playBeat()`. The timeline is *not* stretched uniformly over a 4.5 s beat — its keys were authored
  against an impact at 0.7, so it is scaled to put that key on the **real** instant (`pinned_at`), and the arm
  then holds its end pose while the real arm holds and eases home. The cards still turn over only after the
  beat, at the stretched length. The phones get the same schedule.

**A schedule is a model, and metal is slower than any model.** So wherever the daemon can say a beat is
really finished, that is the authority and the schedule only sizes the animation:

- **per-beat path** — each beat is its own blocking `/play` pair, so the job counts them off (`done_beats`)
  and the bridge waits on that. Not on a global busy flag: three beats fire back to back, so `waitIdle` either
  misses the gap between them or swallows the whole turn in the first wait. Both failures were measured.
- **compiled chain** — one continuous motion with no per-beat boundary to observe, so the schedule paces the
  middle beats (the daemon's playback loop is wall-clock accurate against `perf_counter`, so it does not
  drift) and the last beat waits for idle, `tail` and all.
- **openers, finales, charge, retreat, prepare** — never a timer. Arms' busy flags first, then the gantry,
  because a scene that carries a carriage channel is still moving after the arms have stopped; and a gantry
  phase is not done until the machine is **Idle at the stop**, which `server.py` confirms before the job ends.

Every beat and phase also lands `BEAT_MARGIN_MS` (250 ms) *behind* the metal, never in front. `tests/
rehearse_live.py` measures this: it polls `/api/status` every 50 ms throughout and prints a margins table of
how far behind the screen released each phase. The margin must never be negative.

**The gantry never moves under a moving arm.** `charge()` and `retreat()` both wait for the arms to go idle
first. `together` is the direction that can put metal into metal; `apart` is safe, but a knockout breaks the
beat loop early (the winning blow lands on beat 2 and the loop stops) so the arms can still be part-way
through the chain — pulling the rail out from under a swing changes the geometry the move was tuned in. This
was observed happening in a live run before the wait was added.

**The compile is not free.** `sim/chain.py pair` was taking 10–80 s, all of it dead screen time between a
player locking in and the arms moving, because the pair pass rendered a MuJoCo video nobody watches.
`server.py` now passes **`--no-render`** (added to `chain.py`), which keeps the pair's blade-distance
**safety check** and drops the video: 3.5 s instead of 82 s on the same pair. The safety check's verdict was
also being thrown away — it now lands in the job as `closest_cm`, with a `collision_warning` when the two
blades come closer than the checker's own touching threshold. One real compiled pair reported **0.2 cm
against a 2.4 cm touching threshold**, so this is not hypothetical: read it before running that pair on metal.

## Live deployment runbook

Everything below assumes the arms are on the bench, the gantry rails are clear, and **nobody's hands are
between the two carriages**. If you only want to rehearse, skip to *Rehearsing without hardware*.

**1. Plug in.** Three USB devices, all on the same hub if you can:

| | device | what |
|---|---|---|
| arm A | `/dev/cu.usbmodem5AE60818001` | SO-100. Every move in the library was taught and tuned on this one. |
| arm B | `/dev/cu.usbmodem5AE60824811` | SO-101. Its trajectories are re-based to its own roll offset. |
| gantry | `/dev/cu.usbserial-AL00JZ0H` | GRBL 0.9j, two axes: **X carries arm A, Y carries arm B**. |

Names change when the hub re-enumerates. `ls /dev/cu.usb*` shows what is really there; override with
`ARM_PORT` / `ARM_B_PORT`, or edit `gantry.port` in `arm/arms.json`. `start_live.sh` checks all three and
refuses to start if one is missing.

**2. Calibration.** LeRobot loads these by robot id from its own cache, and they are already in place at
`~/.cache/huggingface/lerobot/calibration/robots/so_follower/{my_follower,so101_arm}.json`. If a fresh
machine or a wiped cache ever loses them, they live in the repo:

```bash
mkdir -p ~/.cache/huggingface/lerobot/calibration/robots/so_follower
cp robot-jousting/calib/{my_follower,so101_arm}.json ~/.cache/huggingface/lerobot/calibration/robots/so_follower/
```

Do **not** let LeRobot run its own calibration sweep instead: arm A's moves are only correct in
`my_follower.json`'s zero points, and `pi_bot.json` is a *different* calibration of the same arm — mixing
them silently shifts every pose.

**3. Start.** One command from `joust/`:

```bash
./start_live.sh                  # checks the three devices, starts the daemon, starts the game on :8770
```

It runs `robot-jousting/arm/run_daemon.sh`, which is the only correct way to start the daemon: the **lerobot
python** (`~/anaconda3/envs/lerobot/bin/python`, override with `LEROBOT_PYTHON`), **stdin from `/dev/null`**
(LeRobot prompts on the terminal if it dislikes a calibration, and a daemon blocked on `input()` looks
exactly like a hung daemon), and a log at **`arm/daemon.log`**. `run_daemon.sh stop` / `log` do what they say,
and it refuses to start a second daemon on top of the first — two processes cannot share the serial ports.

Then open **`http://localhost:8770/?hw=live`**. If an arm is missing the game says so and will not start the
fight; it offers *Play it in the sand pit* (sim for this run) or *Try the arms again*.

**4. Prepare.** Open the host drawer (`⚙ host`) → **Arms** → **Prepare**. This is not optional: GRBL has no
absolute encoder, so the gantry must be **referenced once per power-up** before it will accept a single
millimetre move. Prepare homes it (X then Y crawl onto their switches at 150 mm/min — it takes a couple of
minutes), drives both carriages to the apart stop, and eases both arms to rest. The drawer shows each step as
it lands, plus live arm and gantry state. A fight also calls it automatically at `match.run()`.

**5. The limits.** Three rules the choreography was built around. Break one and you bend metal:

- **Jaw**: never more than **118°** closed from fully open. The gripper holds the sword; past that the
  finger is driving through the blade mount.
- **Shoulder lift**: never below **−89°** (arm A; arm B's own floor is −93.8°, see `lift_limit` in
  `arm/arms.json`). Further back puts the upper arm on the board. `sim/tune.py`'s `LIFT_MIN` enforces this
  when moves are *generated*.
- **Gantry**: the carriages must **never** go together while an arm is extended. That is the whole reason
  the return phase drives `/gantry/apart` *before* `/api/home`, and why Prepare parks apart. The daemon does
  not check this — the ordering in `match.js` is the only thing enforcing it, so do not drive the gantry by
  hand from the drawer mid-fight.

**6. Abort.** The **ABORT** button in the drawer's Arms section, one press, no confirm step — it is what you
reach for when metal is about to meet metal. It posts `/api/abort`, which is deliberately *not* a job so it
answers while everything else is blocked: the daemon's `/abort` sets the abort flag on both arms (they stop
where they are and hold) and `/gantry/abort` resets GRBL. **A gantry abort throws the reference away**, so
run Prepare again before anything else moves. From a terminal:

```bash
curl -XPOST http://localhost:8770/api/abort
```

Physical stops, in order of preference: the ABORT button, then cutting power to the gantry, then the arms.

### Rehearsing without hardware

`tools/mock_daemon.py` is a faithful fake of `arm/arm_daemon.py`: same routes, same response shapes, same
blocking behaviour, and timing computed from the same `motions_tuned.json` with the same constants, so `busy`
is true for about as long as it would really be true. It also logs every request, which is what the rehearsal
asserts against.

```bash
./start_live.sh --mock            # mock daemon + game server, no hardware touched
./start_live.sh --mock --fast     # the same at six times speed
python3 tools/mock_daemon.py --fail B    # rehearse the missing-arm path
python3 tests/rehearse_live.py           # the whole live path end to end, ~10 s
python3 tests/rehearse_live.py --repo    # ...including a real sim/chain.py compile
```

`rehearse_live.py` starts both processes, drives prepare → opener → charge → exchange → return → finale →
abort through the HTTP API, and checks the **sequence** the mock logged *and* the **waits** (it polls
`/api/status` alongside each phase and asserts it really saw `busy` before the phase ended — a phase that
never showed busy would pass a timing test and fail the show).

What the mock does **not** model: any physics, and serial reality — GRBL's buffer depth, planner look-ahead,
the "ok"-means-queued handshake, alarm recovery, switch bounce, USB resets. The streamed carriage channel is
the one part of this that has never met the hardware.

### Check these on real metal first

Everything above is proven against the mock. These are the things the mock cannot prove, in the order they
will bite:

1. **The streamed carriage channel.** `GantryStream` queues bare `G1` blocks into GRBL's planner instead of
   using the blocking `XYController.move()`. That is ordinary G-code streaming, but it has never run on this
   controller. Watch for: the planner filling (`send()` blocking on its "ok" and stalling the arm loop), the
   16-block look-ahead making the ride jerky, and a `?` status poll interleaving with a queued block. **First
   test: an emote with the arms unpowered and a hand on the e-stop.**
2. **The pair collision warning.** A compiled pair reported 0.2 cm of blade clearance against a 2.4 cm
   touching threshold. Read `closest_cm` in the exchange job before letting a new pair run at full scale.
3. **The three software limits** (jaw ≤ 118° from open, lift ≥ −89°, carriages never together with an arm
   extended). Nothing in the daemon enforces them — the move library and the phase ordering do.
4. **Timing.** The margins table is measured against the mock's model of the daemon. Real servos lag, and the
   daemon's `ease_to` accumulates its sleeps. Re-run `rehearse_live.py --speed 1` against the real daemon once
   the arms are back and compare; the margins should stay positive, and if they do not, raise
   `BEAT_MARGIN_MS`.
5. **The gantry reference sweep.** Two axes crawling onto their switches at 150 mm/min, modelled here as a
   flat 6 s. On the real rig it is a couple of minutes, and `prepare` is the only thing that does it.

Testing shortcuts: `?opphp=6` (short fights), `?myhp=3` (quick defeat).

## Emotes: the theatre between the fighting

The arms have no faces, so the feeling comes from posture, tempo and the *relationship* between the two of them
(the vocabulary is `robot-jousting/docs/emotes_brainstorm.md`). Two-arm scenes live in `src/ui/stage.js` and are
named exactly as in that document, so the real arms can play the same beat by the same name:

- **Openers** (3-5 s, before the first turn): `SALUTE_FORMAL`, `GLOVE_TOUCH`, `STAREDOWN`, `COCKY_VS_NERVOUS`,
  `CIRCLING`, `CHAMPION_ENTRANCE`, `OLD_RIVALS`, `IMPATIENT`. `match.run()` picks one that fits the opponent
  (the squire is nervous or impatient, Percival stands on ceremony, the Champion makes an entrance).
- **Finales** (~8 s): `VICTORY_VS_DEFEAT`, `GRACIOUS_WIN`, `SORE_LOSER`, `SLOW_CLAP`. The winner really dances
  (blade pumps with hops, a twirl, a crowd wave, a strut to the centre and back, a bow) while the loser mopes for
  the whole time. The mope is per character (`MOPES`): Bluebell throws a tantrum and then sniffles, Percival sulks
  with his back turned and tuts, the Champion powers down joint by joint, Lionheart slumps and then rallies.

```js
stage.playScene('STAREDOWN', { swap: false })          // -> Promise, resolves when the scene ends
stage.playScene('SLOW_CLAP', { swap, mope: 'percival', keep: true })
```

`swap` flips which arm plays the A role; `mope` picks the loser's track; `keep` leaves the final tableau standing.
Lines and vocalizations come back out through `onSay` / `onVox` / `onHerald` (match.js wires them to `barks.js`
and `voice.js`), so a scene can be driven straight from the console: `window.tilt.stage.playScene('OLD_RIVALS')`.
Every scene cleans up its own timers, so the next turn starts clean. The emote CSS states (`sag`, `sway`,
`shiver`, `sobbob`, `slump`, `tantrum`, `jitter`, `hop`, `jig`, `bounce`, `chatter`) are at the end of `styles.css`;
they compose with the pose offset through the `--tx/--ty/--rot/--sc` custom properties that `stage.move()` writes.
`match.js` also calls `bridge.emote?.(name, { swap })` alongside every scene, for the physical arms.

### The carriage channel, and why a swap is not a cross-over

Two scenes in `motions_tuned.json` — **EN_GARDE_OPENER** and **SAMURAI_FINISH** — carry a `gantry_mm` track
and a `gantry_axis` next to their `t` and `q`. Playing only the joints throws half the choreography away: the
opener *is* the two carriages charging in from the apart stop while the arms fold to keep the tips on target.
So `arm_daemon.py` streams that track alongside the arm samples (`GantryStream`, a strictly additive block —
a motion with no channel behaves exactly as it always did), one merged G1 per 0.25 s covering both axes, feed
capped at the configured `charge_feed`, targets clamped into `[0, apart]`, and the carriage prepositioned to
where the scene starts while the arm is still easing in.

A scene is stored as `NAME` (arm A's part, `gantry_axis: X`) and `NAME@B` (arm B's, `axis: Y`). A swap
**cannot** just cross those two over, because the axis is baked into the motion — arm A playing `NAME@B`
would stream arm B's rail. The file therefore also carries `NAME_SWAP` / `NAME_SWAP@B`: the same two parts
with the roles exchanged *and* the axes put back on the right carriage. `server.py`'s `emote_moves()` uses
those when they exist and falls back to the old cross-over (joints right, carriage channel wrong, so the
daemon skips it) when they do not.

## Sound design workflow

Every optional audio module is loaded if present and the game falls back to the core otherwise, so each can be
worked on alone in its lab page: `http://localhost:8770/dev/audio_lab.html` for the arm foley (pick a move, hear
it at the game's beat length, watch the joint velocities and the impact line; the lab now drives foley.js), `voice_lab.html`, `music_lab.html`
(sweep the intensity slider to hear the arrangement build), `crowd_lab.html`. The Arm Studio at
`http://localhost:8770/dashboard/` shows the same moves as the simulation rendered them.
