# Emotes: making two robot arms feel something

The joust is a spectator sport, and the arms have no faces. Whatever the crowd feels comes from posture, tempo, and above
all the *relationship* between the two arms. This document is the brainstorm behind `sim/emotes/` (two-arm scenes for
openers, hit reactions, gloating, finales and idle time) and the authoring guide for writing more. Generate with
`cd sim && ../.venv/bin/python emote.py ALL`; clips land in `sim/out/emotes/` and the Playhouse dashboard shows them all.

## 1. The arm's emotional vocabulary (what each degree of freedom can say)

| Signal | Reads as |
|---|---|
| **Height** (lift -40..-20 with the elbow up, blade high) | Pride, confidence, alertness. A tall silhouette is a winner. |
| **Folded / low** (SLUMP, COWER, hand low, elbow tucked) | Dejection, fear, submission, exhaustion. |
| **Lean toward** the opponent (hand 0.22+ m forward) | Aggression, eagerness, intimacy. |
| **Lean away** (hand < 0.15 m, REST-like) | Withdrawal, fear, disdain. |
| **Pan = gaze.** Facing (0) | Attention. This is the strongest social channel we have. |
| Pan turned away (+/-40) | Dismissal, sulking, shame, "can't watch". |
| Pan slow sweep | Scanning, wariness, sizing up. Pan snap = surprise. |
| **Blade vertical** | Ceremony, pride, a salute. |
| Blade level and pointed | Threat, intent, "you". |
| Blade drooping (SLUMP, HANG) | Sadness, fatigue. |
| Blade lolling sideways (roll 90 + jaw open) | Limp, beaten, "dead". |
| **Jaw snap** (0 -> 35 -> 0 in 0.25 s) | A "word": a bark, a clack, punctuation. |
| Jaw chatter (fast, repeated) | Laughing, mocking, applause (a slow clap = jaw 0-60-0 at 0.5 s). |
| Jaw slow gape (to 90 over 1 s) | A yawn, a gasp. Small jaw flutter = nerves. |
| **Tempo** fast and crisp | Excitement, anger, decisiveness. |
| Tempo slow and eased (1.5 s+ per key) | Sadness, weariness, ceremony, reluctance. |
| Jittery small moves | Anxiety. A hard stop = shock. |
| **Shoulder bob** small and fast (lift +/-4 at 0.2 s) | Laughing. Slow and deep (lift +/-6 at 1.2 s) = sobbing or heavy breathing. |
| Wrist nod (+/-12) | Yes, a greeting, acknowledgement. |
| Pan shake (+/-10, 0.5 s) | No, disbelief, "tut tut". |
| Whole-arm tremble (2-3 deg on 3 joints at 0.12 s) | Fear, or barely contained rage. |
| Stillness | Shock, or dominance, depending on who moves next. |

## 2. The relationship is the message (two-arm principles)

1. **Mirroring = rapport.** Saluting together, bowing together, breathing in phase: respect and equality.
2. **Complement = status.** One tall and one low is winner and loser. One still and one twitchy is calm and nervous.
3. **Latency = meaning.** A reaction that follows its trigger instantly is a reflex; delayed by 0.5 s it is reluctance or
   processing; a reaction that starts *before* the other arm finishes is an interruption (rude, eager).
4. **Gaze.** Turning the base away is the arm looking away. Use it for sulking, shame, disdain, "I can't watch".
5. **Space.** Crossing toward the centre line is intrusion or intimacy. Blades touching is contact (a glove-touch, a bind).
6. **Cause and effect must be time-locked.** A hit reaction starts on the attacker's impact frame (`until(t)` on the
   defender's track), otherwise it reads as random twitching.
7. **Every scene gives both arms something to do.** An arm parked at REST for the whole clip is a missed line of dialogue.
8. **One idea per scene, three beats.** Setup, turn, settle. Four to eight seconds. If a scene needs a caption to be
   understood, it is not working.

## 3. Physical rules (from the move library, enforced by `emote.py`)

Joints `[pan, lift, elbow, wrist, roll, jaw]` in sim degrees; positive lift/elbow/wrist pitch the chain *down*.
- shoulder lift >= -89 (hard rule; the spline is clamped there). Joint ranges: pan +/-110, lift/elbow +/-97..100, wrist +/-95.
- servo peak <= 300 deg/s (Catmull-Rom peaks at ~1.5x the mean rate: a 60 deg move needs >= 0.3 s).
- hand (hilt) reach <= 0.30 m from the own base; hand z >= 0.04 m; blade tip z >= 0.02 m unless `allow_table=True` (a tap).
- sim roll in [-180, 100] (the real servo cannot cross +/-180; real = sim + 76).
- Blade/blade and blade/body contacts between the arms are *reported* (`warnings`), not blockers: collision handling is
  managed later. Hits are theatre: the defender acts the hit, time-locked to the attacker's impact.

## 4. Scene families

### Openers (starting poses and pre-round interactions)
| Scene | Moods (A / B) | The beat |
|---|---|---|
| SALUTE_FORMAL | courteous / courteous | Both raise the blade vertical, a small nod, drop to en garde together. Mutual respect. |
| GLOVE_TOUCH | sporting / sporting | Both extend, blades tap once at the centre, both retreat to guard. Boxing's glove touch. |
| STAREDOWN | menacing / menacing | Slow lean-in, blades level, tips a hand apart; a tremor of held tension; both snap back to guard at once. |
| COCKY_VS_NERVOUS | cocky / nervous | A twirls the blade and beckons lazily; B fidgets, blade wavering, and shrinks back. |
| IMPATIENT | impatient / drowsy | A taps the table (allow_table) faster and faster; B stretches, yawns (slow gape), finally gets up. |
| CIRCLING | wary / wary | Both sweep pan in mirror like fencers circling, out of phase, then lock (pan 0) at the same instant. |
| CHAMPION_ENTRANCE | regal / deferent | A holds a proud tall pose and raises the blade slowly; B bows low and waits. |
| OLD_RIVALS | grudging / grudging | One curt nod each, a mutual shrug, instant en garde. They have done this before. |

### Hits (the physical reaction to a landed blow; one-sided unless noted)
| Scene | Moods (A / B) | The beat |
|---|---|---|
| HIT_HIGH_TAKEN | striking / struck | A plays ATTACK_HIGH; on the impact frame B's head snaps back (lift back 20, wrist up 30, pan 15 away), the blade flops (jaw 40), wobbles, recovers. |
| HIT_LOW_TAKEN | striking / struck | A plays ATTACK_LOW_LR; B's knee buckles: elbow folds, hand drops toward z 0.10, wrist droops, pan drifts away, slow recover. |
| STAGGERED | pressing / staggered | After a hit, B wobbles drunkenly for a whole beat (lift rocks +/-12 twice, pan drifts 20 away, blade droops) and ends exposed; A leans in. |
| CLASH | fierce / fierce | Both chop high; both freeze at contact, rebound 5 cm along the strike path with a jaw jitter, hold. |
| BOUNCED_OFF | rebuffed / solid | A attacks into B's BLOCK_HIGH; A's blade rebounds (wrist snaps back, arm recoils), B's bar bounces once, smug. |
| FEINT_FOOLED | sly / fooled | A feints high; B throws a block at nothing, freezes, over-corrects with a twitchy re-guard. |
| KNOCKOUT | triumphant / beaten | The finishing blow: B collapses slowly (sag, blade lolls sideways, folds to REST over 2.5 s); A holds the strike then rises tall. |

### After the hit (the emotional aftermath: gloating and sulking)
| Scene | Moods (A / B) | The beat |
|---|---|---|
| GLOAT | gloating / hurt | A's blade quivers in the "wound", then a twirl and a beckon; B nurses the hit, sags, turns away. |
| LAUGH_AT | mocking / seething | A laughs (shoulder chatter + pan wag); B trembles with rage (fast tiny shakes) then slams the blade on the table (allow_table). |
| SMUG_BLOCK | smug / frustrated | After a successful block A guard-bounces and finger-wags; B stomps (lift rocks) and turns away. |
| DISBELIEF | shrugging / stunned | B was hit; B looks at its own blade (wrist rotate + pan), shakes "no"; A shrugs. |
| TANTRUM | serene / tantrum | B throws a tantrum (rapid wags, table slaps); A answers with one slow, calm beckon. |
| CHEAP_SHOT_SORRY | sheepish / gracious | A landed a cheap hit and bows slightly in apology; B waves it off (pan wag, jaw flick) and re-guards. |

### Finale (the match ends)
| Scene | Moods (A / B) | The beat |
|---|---|---|
| VICTORY_VS_DEFEAT | victorious / dejected | A pumps the blade overhead three times then a crowd wave (pan -50..+50); B sags, blade lolls sideways, folds to rest. |
| GRACIOUS_WIN | gracious / dejected | A wins, then bows to B; after a reluctant pause B returns the bow. |
| SORE_LOSER | amused / sore | B slams the table and turns its back; A shrugs, then does a little victory jig. |
| SLOW_CLAP | sarcastic / sulking | A slow-claps (jaw 0-60-0 at 0.5 s); B sulks, then gives a grudging nod. |
| HANDSHAKE | friendly / friendly | Blades cross gently at the centre and pump twice (allow_touch), both retire to rest. |
| EXHAUSTED_DRAW | spent / spent | Both sag and breathe heavily (slow deep shoulder bobs), a mutual nod, rest. |

### Idle (between turns, waiting for the players)
| Scene | Moods (A / B) | The beat |
|---|---|---|
| BREATHING | calm / calm | Idle breathing loops, out of phase, blades drifting a few degrees. The arms are alive. |
| NERVOUS_VS_CALM | calm / nervous | A stone-still with one slow blade dip; B twitchy, small jitters, keeps re-gripping (jaw flutter). |
| BORED | bored / bored | A yawns (lean back, slow gape, stretch); B taps the table (allow_table) and checks the time (pan glance away). |
| SHOW_OFF | showing off / unimpressed | A twirls and flourishes; B pointedly looks away, then a single slow "tut" pan shake. |
| PSYCH_UP | pumped / pumped | Both bounce on the spot (shoulder bobs) getting faster, then snap to guard at the same instant. |

## 5. Authoring guide (`sim/emote_lib.py`)

```python
from emote_lib import *
SCENES = {}
def gloat():
    A = (Track().move("ATTACK_HIGH", "chops")                     # a real tuned move, keys included
           .osc(n=3, period=0.24, jaw=35, pan=3, note="blade quivers in the wound")
           .to(EN_GARDE, 0.7).wag(n=1, period=1.5, roll=45, note="twirl").rest(1.2))
    B = (Track().to(EN_GARDE, 0.8, "waits").until(1.27)            # hold until A's impact frame (sum of A's key times)
           .nudge(0.2, lift=-20, wrist=-30, pan=15, jaw=40, note="takes the hit")
           .to(SLUMP, 1.2, "sags").set(1.0, pan=40, note="turns away").rest(1.5))
    return scene(A, B, "Gloat", "after_hit", {"A": "gloating", "B": "hurt"}, "A crows over a landed chop; B nurses it.")
SCENES["GLOAT"] = gloat
```
- `Track()` starts at REST; `Track(EN_GARDE)` starts elsewhere (the daemon eases the arm there first).
- `.to(q, dt, note)`, `.hold(dt)`, `.until(t_abs)`, `.set(dt, lift=..)` (absolute), `.nudge(dt, lift=+5)` (relative),
  `.osc(n, period, **amps)` one-sided, `.wag(n, period, **amps)` symmetric, `.move("ATTACK_HIGH")`, `.rest(dt)`.
- Named poses: REST, EN_GARDE, READY_MID, TUCK, GATE, SALUTE, PROUD, SLUMP, POINT, COWER, LOOK_AWAY, STRETCH, BLADE_UP;
  `pose(EN_GARDE, jaw=30)` copies with overrides; `move_pose("BLOCK_HIGH")` is a tuned move's end pose.
- Notes become the captions burned into the clip and the beat-by-beat script in the dashboard: write them as stage directions.
- `A.t` is the track's current time: use it to schedule the other arm's reaction (`B.until(A_impact)`).
