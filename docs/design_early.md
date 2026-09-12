# Robot Arm Joust — Design Document (v0.2, physical arms)

## One-line pitch
Two real robot arms face each other. Each player picks a move on their phone.
When both have locked in, the arms perform the clash and the crowd sees who
landed the hit.

## Guiding principle
**The rules decide the outcome. The arms perform it.**

The move pair (A, B) is looked up in a table that returns the result
(who took damage, who gained an advantage). That result maps to a scripted
choreography built from poses that were physically verified once. There is no
sensing, no physics, and no collision detection at runtime. Every motion the
arms ever make has been seen before.

---

## 1. Assumptions (correct me)

- Two arms with a Python SDK (xArm, MyCobot, Dobot, Niryo, or similar), 4 to 6 joints.
- One computer on the same network as the arms and the players' phones.
- Arms are mounted facing each other with a shared "clash zone" between them.
- Foam or padded lances. Whether they physically touch is a choice, see §7.

## 2. The move set

Six moves. Two lines (high, low) create the guessing game. Stamina creates rhythm.

| Move        | Stamina | What it does                                            |
|-------------|--------:|---------------------------------------------------------|
| High Thrust | -1      | Attack on the high line                                 |
| Low Thrust  | -1      | Attack on the low line                                  |
| High Guard  | 0       | Block the high line                                     |
| Low Guard   | 0       | Block the low line                                      |
| Feint       | -1      | Fake attack. Punishes guards, gets punished by thrusts  |
| Recover     | +2      | Rest. Half damage taken this turn                       |

- Stamina starts at 3, max 3. If you have 0 stamina, only Guard and Recover are available.
- Health starts at 5. First to 0 loses.

## 3. Outcome table

Symmetric: swap the players and the result swaps. "Hit N" means the other player takes N damage.

| A \ B       | High Thrust      | Low Thrust       | High Guard     | Low Guard      | Feint            | Recover          |
|-------------|------------------|------------------|----------------|----------------|------------------|------------------|
| High Thrust | Clash, no damage | Both hit 1       | Blocked        | A hits 2       | A hits 2         | A hits 1         |
| Low Thrust  | Both hit 1       | Clash, no damage | A hits 2       | Blocked        | A hits 2         | A hits 1         |
| High Guard  | Blocked          | B hits 2         | Nothing        | Nothing        | B gains Opening  | B recovers       |
| Low Guard   | B hits 2         | Blocked          | Nothing        | Nothing        | B gains Opening  | B recovers       |
| Feint       | B hits 2         | B hits 2         | A gains Opening| A gains Opening| Nothing          | B recovers       |
| Recover     | B hits 1         | B hits 1         | A recovers     | A recovers     | A recovers       | Both recover     |

**Opening**: your next Thrust ignores Guard (it still clashes with a Thrust on
the same line). Lasts one turn. This makes Feint the tool against a turtle,
and makes turtling against a feinter a losing plan.

Design notes:
- Thrust vs wrong-line Guard deals 2 because the guarder is off balance. This
  keeps guessing the line meaningful instead of "always guard".
- Thrust vs Thrust on different lines both land for 1, like a real joust where
  both riders often connect. Same line clashes with no damage, which is the
  dramatic "lances shatter" moment and is fun to perform.
- Recover is never free: any Thrust punishes it. But it is the only way to
  regain stamina, so a player who spends everything must expose themselves.

## 4. Turn flow

1. **Program** (30 second timer). Each player sees both health bars, both
   stamina counts, their own available moves, and whether they hold an
   Opening. They pick a move and lock in. Choices are hidden.
2. **Reveal**. Big screen by the arena shows both moves with a beat of drama.
3. **Perform**. Arms execute the choreography for that outcome (5 to 10 seconds).
4. **Apply**. Health and stamina update. If someone is at 0, the winner's arm
   does a victory pose and the loser's arm droops.
5. Next turn.

If a player's timer runs out or their phone disconnects, their move defaults
to High Guard. The game never stalls waiting on a client.

## 5. Optional depth (v2)

- **Damage states**. At 2 health your arm is "damaged": Feint and High Thrust
  are removed from your list. Maps directly to a slower, sadder choreography set.
- **Best of three tilts**. Reset health between tilts, stamina carries over.
- **Crowd vote**. Spectators on their phones vote a bonus for the next turn.

## 6. System architecture

```
 Player phone (browser)  --ws-->  +---------------------------+
 Player phone (browser)  --ws-->  |  Game server (Python)     |  --sdk-->  Arm A
 Big screen (browser)    --ws-->  |  rooms, turn state, rules |  --sdk-->  Arm B
                                  |  choreography scheduler   |
                                  +---------------------------+
```

- **Game server**: Python, FastAPI with WebSockets. Python because every
  common arm SDK is Python. Serves the phone client as a static page, so
  players join by scanning a QR code with a room code in the URL. No app install.
- **Rules engine**: pure function `resolve(state, move_a, move_b) -> (new_state, outcome)`.
  No I/O. Fully unit tested against the table in §3.
- **Arm controller interface**: `perform(outcome, side) -> None`, plus `home()`
  and `stop()`. One adapter per arm SDK. A **simulator adapter** logs the pose
  sequence and drives a canvas animation on the big screen, so the whole game
  is playable with no hardware attached.
- **Big screen client**: a browser page for a monitor by the arena. Health bars,
  stamina, timer, reveal animation, and the simulator animation during development.

## 7. Choreography

### Poses
A pose is a named tuple of joint angles per arm, recorded once by jogging the
arm there by hand (teach mode) and saving it. Around 8 poses per arm:

`rest`, `ready`, `high_thrust`, `low_thrust`, `high_guard`, `low_guard`,
`feint_start`, `hit_recoil`, `victory`, `defeat`

### Sequences
An outcome's choreography is an ordered list of steps `(arm, pose, seconds)`.
Steps run sequentially, never in parallel, so at most one arm moves at a time.
Example, "A High Thrust, B Low Guard, A hits 2":

```
B  low_guard    1.0
A  high_thrust  0.8   <- fast, this is the hit
B  hit_recoil   0.5
A  ready        1.0
B  ready        1.0
```

Because every step uses a verified pose and only one arm moves per step,
the only question to check is "can arm A be at pose X while arm B sits at
pose Y". That is a finite list you walk through once during setup, with a
hand on the e-stop.

### Contact or no contact
- **v1, no contact**: arms stop a few centimetres short. Sound, lights on
  the big screen, and the recoil animation sell the hit. Zero risk.
- **v2, contact**: foam lance taps a padded target plate on the other arm's
  forearm. Only the sequenced ordering above makes this safe: the target arm
  is stationary in a known pose when it gets tapped.

## 8. Safety

- Hardware e-stop within reach of the operator at all times.
- Software speed cap on every motion, set per arm in config.
- If either arm SDK reports a fault, the game pauses and both arms stop.
  It does not auto-resume.
- Watchdog: if a choreography step takes more than 2x its expected time, stop both arms.
- Home routine on startup and shutdown.
- Poses are verified in isolation, then all pairs (pose_A, pose_B) that can
  co-occur are verified with the speed cap at 20 percent before any game runs.

## 9. Build plan

1. Rules engine + tests. Half a day.
2. Server, phone client, big screen, simulator adapter. Playable with no hardware.
3. Teach poses on the real arms. Save to a JSON file per arm.
4. Adapter for your arm SDK. Run every choreography at 20 percent speed.
5. First real match.

## Open questions

1. Which arms exactly, and which SDK? This decides the adapter.
2. How are they mounted, and how much of their workspace overlaps?
3. Contact or no contact for the first version? I recommend no contact.
4. Is there a big screen by the arena, or are the phones the only display?
