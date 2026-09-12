# Move Library Architecture

Design for the chainable, flourish-capable move library, built on the current
generator (`sim/move_params.py` -> `sim/tune.py` -> `arm/motions_tuned.json`).

Conventions used throughout: **sim joint convention** (degrees; roll 0 = sword on
top; real roll = sim + 76), metres from the arm's own pan axis, seconds. Real-arm
coordinates appear only in the exporter.

## 1. Data model

**Recommendation: a small stance vocabulary + moves stored as absolute key
poses, with the current end-pose+offset parameters kept as the *authoring*
layer.** Reasons:

- Chaining needs shared boundary poses. If every move *ends exactly at a named
  Stance*, "start where the last ended" is free and needs no per-pair
  transitions. Two stances (HIGH, LOW) plus REST is enough for v1 and matches
  the "stance is a tell" game idea.
- Validation (limits, table, wrap, MuJoCo) and the real arm both consume
  absolute joint angles; that is the unit the library stores and hashes.
- End+offset params are excellent for *tuning one move* and for *variants*
  (section 4), so the recipes stay. A recipe is a pure function
  `params -> [Key]`; the stored Move is its output plus provenance.
- Relative (delta) keys are needed only for stance-preserving flourishes
  (recoil, taunt wobble, twirl), which must work from either stance.

```python
# swordlib/model.py
Q = tuple[float, float, float, float, float, float]   # pan, lift, elbow, wrist_flex, wrist_roll, jaw(0-100)

@dataclass(frozen=True)
class Pose:
    q: Q                          # sim convention, degrees
    intent: dict | None = None    # {"x","z","pitch","pan","roll","jaw"} it was solved from, for provenance
    # invariants: within joint limits; (q[4]+76) in [-170,170]; hilt x<=0.27; sword+arm above table

@dataclass(frozen=True)
class Stance:
    name: str                     # "HIGH" | "LOW" | "REST"
    pose: Pose
    tol_deg: float = 3.0          # a trajectory "is in" the stance if every joint is within tol
    tell: str = ""                # text for the reveal screen

Delta = tuple[float, ...]         # joint offsets added to the beat's entry pose (flourishes only)

@dataclass(frozen=True)
class Key:
    pose: Pose | str | Delta      # absolute | stance name | offset from entry pose
    t: float                      # seconds relative to the beat's HIT instant (negative = before)
    hold: float = 0.0             # dwell at this key before moving on

@dataclass(frozen=True)
class Move:
    name: str                     # "ATTACK_HIGH", "ATTACK_HIGH@stopped", "RECOIL"
    kind: Literal["attack", "block", "feint", "flourish"]
    tags: frozenset[str]          # {"attack","line:high"} -- matched by pair rules
    keys: tuple[Key, ...]         # sorted by t; keys[-1].pose is a stance name or a Delta of 0
    end: str | None               # stance it ends in; None = "same stance it entered" (flourishes)
    start: frozenset[str] | None  # stances it may start from; None = any (prep is auto-blended)
    beats: int = 1
    slot: Literal["beat", "settle", "interlude", "terminal"] = "beat"
    params: dict = field(default_factory=dict)   # recipe input (end+offsets), for regeneration
    recipe: str = ""              # recipe function name

@dataclass(frozen=True)
class Transition:                 # only when the automatic stance->first-key blend fails validation
    from_stance: str
    to_move: str
    via: tuple[Key, ...]          # extra keys inserted before the move's first key

@dataclass
class Chain:
    arm: Literal["A", "B"]
    moves: list[str]              # one name per beat
    overlays: list[tuple[int, str]] = field(default_factory=list)  # (beat index, flourish name)

@dataclass
class Trajectory:                 # compiled output, sim convention, 50 Hz
    t: np.ndarray                 # (N,)
    q: np.ndarray                 # (N, 6)
    marks: dict[str, float]       # "beat0", "hit0", "beat1", ... absolute seconds
```

Flourish is not a separate class: it is a `Move` with `kind="flourish"`, a
`slot`, `end=None` (stance-preserving) and Delta keys. This keeps one compiler.

## 2. Chaining and the beat

Fixed constants: `BEAT = 1.2`, `HIT = 0.8` (hit instant inside the beat),
`SETTLE = BEAT - HIT = 0.4`. Every move's keys are authored relative to HIT
(`t<0` = prep/wind-up, `t=0` = impact or block-ready, `t>0` = settle). Both arms
therefore reach impact at the same instant regardless of what they are doing,
which is what makes a clash look like a clash.

Beat *k* of a chain occupies `[k*BEAT, (k+1)*BEAT)`. Compiling one beat:

1. **Entry pose** = last sample of the previous beat (REST for beat 0, after a
   1.0 s charge segment REST -> chosen opening stance).
2. **Prep blend**: an implicit key at `t = -HIT` equal to the entry pose is
   prepended, so the Catmull-Rom spline runs entry -> first authored key. Its
   duration is whatever time is left before the first key. If a `Transition`
   exists for `(entry stance, move)` its `via` keys are spliced in.
3. **Authored keys** as given; a block's key at `t = -0.2` with
   `hold` to the beat end.
4. **Settle**: the last key is a stance name at `t = +SETTLE`, so the beat
   ends *exactly* on that stance's pose. For an attack whose natural end is
   not a stance (ATTACK_LOW ends at pan 20, roll 90), the settle segment
   carries it back (roll 90 -> 0 in 0.4 s = 225 deg/s, under the cap).
5. The dense trajectory is resampled to the 50 Hz grid and the segment's
   speed is checked; a failure names the beat and joint.

Because the entry pose is always a stance (within `tol_deg`) the prep blend
only ever has `|stances| x |moves|` distinct cases. The builder precomputes a
`compat[(stance, move)] -> ok | needs-Transition | impossible` table; the game
rules can hide impossible moves from the hand or charge a beat for them.

Timing stays on the beat because nothing stretches: a move that cannot reach
its first key from a stance within `HIT + t_first` at 300 deg/s fails
validation at build time, not at play time. Multi-beat moves (`beats=2`, e.g.
a hammer wind-up) just span two grid slots with their HIT in the second.

## 3. Compositing flourishes

Flourishes are Moves with a `slot` that says where the compiler splices them:

| slot | when | example | contract |
|---|---|---|---|
| `beat` | replaces a whole beat | stagger recoil, feint-abort, "skip beat" | Delta keys from entry pose, `end=None` (returns to entry stance) |
| `settle` | replaces `[HIT, BEAT)` of a beat | clash ring, hit reaction, block shudder | Delta keys; must land on the beat's declared end stance |
| `interlude` | between turns, any length | taunt, sword twirl (roll +-60 within wrap bounds) | stance-preserving, no HIT |
| `terminal` | end of match | victory, defeat droop | from any stance, ends at REST, no timing constraint |

`Chain.overlays` lists `(beat, flourish)`; the game's rules engine produces
these from the outcome table (stagger -> loser gets `("RECOIL", k+1)`; clash ->
both get `("CLASH_RING", k)` on the settle slot). A `beat` overlay is a
substitution, so the loser's chosen move for that beat is simply dropped.
Flourishes never move the hit instant and never change the exit stance, so the
rest of the chain compiles unchanged.

## 4. Two-arm awareness without N^2 moves

Keep single-arm moves canonical. Pair-specific adjustment is a **rule table on
tags**, producing *variants* and *overlays*, not new moves:

```python
# swordlib/rules.py
PAIR_RULES = [   # (tags_A, tags_B) -> adjustments; first match wins; symmetric by construction
    ({"attack","line:high"}, {"block","line:high"}, dict(A="stopped", B=None, overlay=("CLASH_RING","settle"))),
    ({"attack"},             {"attack"},            dict(A="stopped", B="stopped", overlay=("CLASH_RING","settle"))),
    ({"feint"},              {"block"},             dict(A=None, B="shudder")),
]
VARIANTS = {   # name -> param override applied before re-running the recipe
    "stopped": {"end.x": -0.04},          # pull the slam/slash end 4 cm short of the incoming blade
}
```

A variant is compiled as `ATTACK_HIGH@stopped` by re-running the recipe with
the override; it is a normal Move with the same keys' timing and end stance, so
it chains identically. `compile_pair()` looks up the rule per beat, swaps in
variants, adds overlays, then compiles both chains. Roughly 5-8 rules cover the
outcome classes; nothing is duplicated per opponent move.

## 5. Validation pipeline

Runs at build time, in cost order; results cached by content hash of the
inputs so the MuJoCo tier is only rerun for changed pairs.

**Pose tier** (every key, every stance):
- joint limits from the arena model (`ik.LO/HI` with 1 deg margin);
- roll wrap: `-170 <= q[4] + 76 <= 170` (ATTACK_LOW_LR at real 166 is already
  marginal, flag it);
- centre line: hilt `x <= 0.27` (tip may cross; that is the sword's job);
- table: hilt z, tip z and every arm geom above z = 0.02 via MuJoCo contacts with
  the floor plane;
- self-collision: MuJoCo contacts between non-adjacent bodies of the same arm;
- IK residual < 1 cm / 5 deg where the key came from intent.

**Trajectory tier** (every compiled move, per stance it can start from):
- `|dq/dt| <= 300 deg/s` on the 50 Hz signal; also a soft acceleration
  bound so the servos track;
- no roll sample jumps > 90 deg between neighbours (wrap detector);
- pose-tier checks on every sample, not just keys (splines overshoot);
- beat contract: last sample within `tol_deg` of the declared end stance,
  a hit-side key exactly at t = 0, total length = `beats * BEAT`.

**Pair tier** (MuJoCo, both arms with the actuator model, as `pair.py`):
- forbidden contacts: blade-vs-opponent-arm, arm-vs-arm at any time
  (closest approach must exceed 3 cm);
- allowed contacts: blade-vs-blade, only inside `HIT +- 0.15 s`;
- tracking error between commanded and simulated joints < 8 deg (catches
  moves the servos cannot follow even under the speed cap).

Pair-tier inputs are all (move_A, move_B) combos the outcome table allows, each
with its overlays: with ~10 moves, under 200 short sims, run once and cached.

## 6. File layout and API

```
game/
  swordlib/
    model.py      # dataclasses above
    stances.py    # STANCES = {"HIGH": Stance(...), "LOW": ..., "REST": ...}
    params.py     # PARAMS (moved from sim/move_params.py) + FLOURISH_PARAMS
    recipes.py    # attack_high(P), attack_low(P), block(P), recoil(P)... -> tuple[Key]
    build.py      # define_move, compile_move, spline, prep blend
    chain.py      # compile_chain, compile_pair, rules lookup
    rules.py      # PAIR_RULES, VARIANTS, TRANSITIONS
    validate.py   # pose / trajectory / pair tiers
    export.py     # -> arm/library.json (real coords), arm/chains/<id>.json
    preview.py    # MuJoCo render + closest-approach log
  library/
    moves.json    # compiled Moves (sim coords), keyed "NAME[@variant]"
    compat.json   # (stance, move) prep feasibility
    report.json   # last validation results, keyed by hash
  arm/library.json, arm/chains/*.json   # what play_chain.py loads
```

```python
# build.py
def define_move(name: str, kind: str, tags: set[str], recipe: str, params: dict,
                end: str | None, start: set[str] | None = None, beats: int = 1,
                slot: str = "beat") -> Move: ...
def compile_move(move: Move, entry: Stance, transitions: dict[tuple[str, str], Transition]) -> Trajectory: ...

# chain.py
def compile_chain(chain: Chain, library: dict[str, Move], opening: str = "HIGH") -> Trajectory: ...
def compile_pair(chain_a: Chain, chain_b: Chain, outcomes: list[dict]) -> tuple[Trajectory, Trajectory]:
    """Applies PAIR_RULES per beat (variants + overlays from the rules engine's outcomes), then compiles both."""
def compat_table(library: dict[str, Move], stances: dict[str, Stance]) -> dict[tuple[str, str], str]: ...

# validate.py
def check_pose(pose: Pose) -> list[str]: ...                         # empty list = ok
def check_trajectory(traj: Trajectory, move: Move) -> list[str]: ...
def check_pair(traj_a: Trajectory, traj_b: Trajectory, hits: list[float]) -> list[str]: ...
def validate_library(library: dict[str, Move], stances: dict[str, Stance], pairs: list[tuple[str, str]]) -> dict: ...

# export.py
def export_move(traj: Trajectory, name: str, path: str = "arm/library.json") -> None: ...   # adds ROLL_OFFSET, 50 Hz
def export_chain(traj_a: Trajectory, traj_b: Trajectory, chain_id: str) -> str: ...        # -> arm/chains/<id>.json

# preview.py
def render_move(traj: Trajectory, out: str, view: str = "iso") -> None: ...
def render_pair(traj_a: Trajectory, traj_b: Trajectory, out: str) -> np.ndarray: ...       # returns (t, blade distance) log
```

`arm/play_chain.py` is `play_motion.py` with one change: it eases from the
current pose to `Q[0]` (REST at chain start) and plays the whole chain
trajectory; the beat marks are emitted to the game server for sound and screen
cues. Everything the real arm ever plays is a `Trajectory` that passed all
three tiers.

## Migration from today

1. Move `PARAMS` into `swordlib/params.py`; re-express each recipe's keys as
   `Key(t relative to HIT)` and replace the leading `(REST, 0)` key with a
   settle-to-stance key at the end. The new `FEINT_* {"like": ATTACK}` params
   already fit: a feint recipe reuses the attack's prep keys and adds a
   pull-back key, so it inherits the attack's `start`/prep compat for free.
2. Choose stance poses deliberately rather than reusing a block: the new
   BLOCK_HIGH (pan 20, roll 90 = real 166, jaw 100) is asymmetric and 14 deg
   from the wrap, so it should be a *move* that settles to HIGH, not the HIGH
   stance itself. A good HIGH stance is the ATTACK_HIGH cocked pose (roll 0,
   jaw open): the chop from it is then just the 0.22 s slam. LOW can be the
   BLOCK_MIDDLE hanging guard (roll 0, jaw 0).
3. Run `compat_table`; author `Transition`s only for the pairs it flags.
4. Add RECOIL and CLASH_RING as Delta-key flourishes; re-run pair validation.
