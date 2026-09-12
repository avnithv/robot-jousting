// Marla, keeper of The Tilted Crown, is the guide, coach and announcer. Each line has a pose from the
// barkeep sprite sheet (assets/sprites/*.png). {opp} is replaced with the opponent's name.
export const TOWN = 'Tiltford';
export const PLAYER_NAME = 'Lionheart';   // the red arm, House of the Red Lion (our SO-101)

export const OPPONENTS = {
  squire: {
    id: 'squire', name: 'The Squire', title: 'Bluebell, squire of the Lily', hp: 18, profile: 'squire', counters: 0,
    deck: ['chop', 'chop', 'slash_l', 'slash_r', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'thrust', 'rush', 'flourish'],
    color: 'blue',
  },
  knight: {
    id: 'knight', name: 'Sir Percival', title: 'Sir Percival of the Lily', hp: 25, profile: 'knight', counters: 1,
    deck: ['chop', 'chop', 'slash_l', 'slash_r', 'thrust', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'parry_high', 'brace', 'rush', 'flourish'],
    color: 'blue',
  },
  champion: {
    id: 'champion', name: 'The Iron Champion', title: 'The Iron Champion of Tiltford', hp: 32, profile: 'champion', counters: 1,
    deck: ['chop', 'chop', 'chop', 'slash_l', 'slash_r', 'thrust', 'thrust', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'parry_high', 'parry_low', 'brace', 'rush', 'rush', 'windup'],
    color: 'blue',
  },
};
export const LADDER = ['squire', 'knight', 'champion'];

const L = (pose, text, opts = {}) => ({ pose, text, ...opts });

export const MARLA = {
  intro: [
    L('wave', "Oi! Over here, love. Welcome to The Tilted Crown."),
    L('arms_wide', "It's Tilt Day in Tiltford. Once a year the whole town shuts its shutters and comes to watch the arms fight."),
    L('point_right', "See the red one? That's Lionheart. House of the Red Lion. Been in the family since me nan ran this bar."),
    L('lean_in', "Thing is, nobody's left to steer it. So today, YOU'RE the knight. I'll shout the moves, you pick 'em."),
    L('hip_smile', "Three fights. Squire, knight, then the Iron Champion. Win the Tilt and your name goes over the bar. Drinks are on you either way."),
  ],
  tutorial: [
    L('finger_up', "Quick lesson, then I'll shut up. Every turn you get 3 ENERGY and 5 cards. Play up to 3 cards into 3 BEATS."),
    L('sword_raised', "Attacks hit on a LINE: high or low. A guard on the same line stops it. Guard the wrong line and you eat it, plus a bit."),
    L('sword_ready', "Both arms swing at once. Same line? CLASH, no damage. Different lines? You both get hit."),
    L('thinking', "Feints are free. A feint into a guard leaves them EXPOSED. But an attack catches a feint mid-swing and punishes it."),
    L('stop_hand', "Leave a beat empty and your arm just stands there. Hit an idle arm and it STAGGERS: it loses the next beat."),
    L('sword_raised', "New this year: the rail. Every feint you play puts VOLTAGE on it, up to two."),
    L('finger_up', "Spend one and the arm RUSHES the rail: it gets to the middle before any swing lands. A bar still stops it. Two rushes back to back is FULL TILT, and that goes through anything."),
    L('thinking', "And hold a COUNTER: anything that swings at it comes straight back at 'em. One use, mind."),
    L('lean_in', "One more. Before you lock in, watch their arm twitch. I'll tell you what kind of move is coming first. Now go on."),
  ],
  fightIntro: {
    squire: [
      L('point_left', "First up: Bluebell, the Lily's squire. Sweet kid. Swings at anything that moves."),
      L('belly_laugh', "Her tells are honest as bread. Read 'em and you'll be fine."),
    ],
    knight: [
      L('arms_crossed', "Sir Percival of the Lily. Proper knight. Guards well, feints when you turtle, and he REMEMBERS what you did last turn."),
      L('finger_up', "Mix your lines. If you chop twice, he'll have a bar up for the third."),
    ],
    champion: [
      L('worried', "Right. The Iron Champion. Three Tilts running. Winds up, then brings the sky down on you."),
      L('lean_in', "Its tells LIE about half the time. When you see it wind up, that's the one honest thing it'll ever show you."),
      L('hand_heart', "Whatever happens, there's a pint waiting. Go on, Lionheart."),
    ],
  },
  plan: [
    L('hands_hips', "Pick your three. Think about which line they'll guard."),
    L('thinking', "A feint before a chop is a classic. If they guard the feint, the chop lands clean."),
    L('mug_hip', "Empty beats are free hits for them. Fill 'em if you can."),
    L('finger_up', "Thrust can't be blocked. Only three damage, but it's honest work."),
    L('lean_in', "Watch the twitch. Guard what's coming, then punish."),
    L('hip_smile', "Wind Up is a promise. Everyone sees it. Make 'em guess where it lands."),
    L('sword_raised', "Feint, then Rush. That's the rail: load it, then race it."),
    L('thinking', "Hold the Counter and let them swing. Their own stroke comes back at 'em."),
  ],
  tell: {
    attack: [L('lean_in', "Their shoulder's dropping. First beat's an ATTACK, I'd wager."), L('point_left', "See that? Blade's cocking. ATTACK coming first.")],
    guard: [L('lean_in', "Elbow's tucking in. They'll open with a GUARD."), L('arms_crossed', "Turtle time. First beat's a GUARD. Feint it.")],
    trick: [L('thinking', "Odd little wiggle. A TRICK first. Feint or a flourish."), L('lean_in', "That's not a swing and not a guard. Something sneaky first.")],
    rest: [L('worried', "They're... just standing there? Hit 'em.")],
    liar: [L('worried', "Can't read it. Might be a bluff.")],
  },
  outcome: {
    hit_opp: [L('cheer_mug', "THAT'S IT! Right on the plate!"), L('belly_laugh', "Ha! Felt that from here."), L('two_mugs', "Lovely stroke, love!"), L('point_left', "Oof. That one'll dent.")],
    hit_player: [L('worried', "Ooh. That one got through."), L('hands_hips', "Guard the LINE, not the air!"), L('hand_heart', "Shake it off. Plenty of pint left in you.")],
    both_hit: [L('arms_wide', "Both landed! The crowd loves a trade."), L('belly_laugh', "Everyone's bleeding! Classic Tilt.")],
    clash: [L('two_mugs', "CLASH! Sparks over the barrels!"), L('cheer_mug', "Steel on steel! Well, plastic on plastic.")],
    blocked_by_player: [L('hip_smile', "Stopped it dead. Now RIPOSTE: your next swing's got teeth."), L('finger_up', "That's a wall. Punish 'em next beat.")],
    blocked_by_opp: [L('hands_hips', "Bar was up. Told you to mix the lines."), L('arms_crossed', "Bounced right off. They'll come back harder.")],
    exposed_opp: [L('belly_laugh', "They BIT on the feint! Their next guard is worthless."), L('point_left', "Look at 'em shoving air. Exposed!")],
    exposed_player: [L('worried', "You guarded a feint. Your next guard won't hold."), L('hands_hips', "Made you flinch. Don't guard next beat, ATTACK.")],
    feint_punished_opp: [L('cheer_mug', "Caught 'em mid-feint! Extra hurt!"), L('belly_laugh', "Nothing sadder than a punished feint.")],
    feint_punished_player: [L('worried', "They saw through it. Feint's a gamble."), L('hand_heart', "That stung. Feint into GUARDS, not attacks.")],
    stagger_opp: [L('two_mugs', "STAGGERED! They're reeling. Free beat!"), L('point_left', "Look at it wobble! Hit it again!")],
    stagger_player: [L('worried', "You're reeling. You lose the next beat."), L('stop_hand', "Get your feet back, love.")],
    clean_hit_opp: [L('cheer_mug', "Clean hit on an open arm! Beautiful."), L('belly_laugh', "They just STOOD there!")],
    clean_hit_player: [L('hands_hips', "You left a beat empty and paid for it."), L('worried', "Open arm, open wound.")],
    double_feint: [L('belly_laugh', "Two feints! Nobody did anything! The crowd's confused."), L('thinking', "Well that was a dance.")],
    double_guard: [L('arms_crossed', "Two walls. Riveting."), L('mug_hip', "Bit of a stare-down, that.")],
    feint_wasted: [L('thinking', "Feinted at nothing. Bit awkward."), L('hands_folded', "Save the feints for a guard.")],
    windup: [L('lean_in', "WIND UP. Next swing's a big one. Guard the line or eat it."), L('worried', "Blade's up and shaking. Here it comes.")],
    flourish: [L('belly_laugh', "A twirl! Showing off! Extra cards next turn."), L('two_mugs', "The crowd loves a flourish.")],
    nothing: [L('mug_hip', "Nothing happened. Pint?"), L('hands_folded', "Quiet beat.")],
    unblockable: [L('finger_up', "Thrust goes straight through a guard. Honest work."), L('point_left', "Can't block a straight line.")],
    // the rail: voltage, rushes, full tilt, counters
    loaded: [L('finger_up', "That feint put a charge on the rail. VOLTAGE up."), L('thinking', "Feints aren't just lies, love. They're fuel."), L('lean_in', "One more of those and the rail's full.")],
    charged: [L('sword_raised', "Rail's FULL. Two charges. Let it off!"), L('cheer_mug', "CHARGED! Now get down that rail before they're ready.")],
    no_voltage: [L('hands_hips', "No voltage! The rail's dead. Feint first, THEN rush."), L('worried', "Nothing on the rail, so nothing happened. Load it first.")],
    rush_opp: [L('two_mugs', "RUSH! Got to the middle before they even swung!"), L('cheer_mug', "Beat 'em down the rail! That's the whole trick!")],
    rush_player: [L('worried', "They rushed the rail. Got there first, too."), L('hands_hips', "Put a bar up, love. Any guard stops a rush.")],
    full_tilt_opp: [L('cheer_mug', "FULL TILT! Two rushes back to back! Nothing stops that!"), L('arms_wide', "The whole rail came at 'em at once!")],
    full_tilt_player: [L('worried', "Full tilt. Straight through the guard. Ouch."), L('hand_heart', "No bar holds that one. A Counter's the only answer.")],
    rush_clash: [L('two_mugs', "Both rushed! Met in the middle! Sparks over the barrels!"), L('belly_laugh', "Two arms, one rail. Crowd's delighted.")],
    countered_opp: [L('belly_laugh', "COUNTERED! They wore their own stroke!"), L('cheer_mug', "Straight back at 'em! That's the Counter spent, mind.")],
    countered_player: [L('worried', "Counter. They threw your own stroke back at you."), L('hands_hips', "Never swing into a Counter, love.")],
    counter_idle: [L('mug_hip', "Counter's up, nothing came. Polishing it, I suppose."), L('thinking', "A held Counter and an empty beat. Riveting.")],
    counter_standoff: [L('arms_crossed', "Two Counters. They're just waiting for each other."), L('belly_laugh', "Nobody's swinging! Nobody CAN!")],
  },
  lowHp: {
    player: [L('worried', "You're nearly done, love. Guard smart or go all in."), L('hand_heart', "Last pint in the barrel. Make it count.")],
    opp: [L('cheer_mug', "They're nearly done! Finish it!"), L('point_left', "One more good stroke!")],
  },
  win: {
    squire: [L('belly_laugh', "Bluebell's down! Sweet kid, no guard. Next round's on the house."), L('hip_smile', "Pick a card for your deck. Something you'll actually use.")],
    knight: [L('two_mugs', "SIR PERCIVAL, BEATEN! The Lily's crying into their ale!"), L('lean_in', "Only the Champion left. Pick a card. Pick well.")],
    champion: [L('cheer_mug', "THE IRON CHAMPION IS DOWN! LIONHEART TAKES THE TILT!"), L('arms_wide', "Your name goes over the bar tonight. Right next to me nan's."), L('wave', "Now drink. You've earned it. Come back next year.")],
  },
  lose: [L('hand_heart', "Down you go. Happens to the best of 'em."), L('mug_hip', "There's always next Tilt. And there's always a pint."), L('hands_hips', "Or... you could go again right now. I'll pretend I didn't see.")],
  reward: [L('finger_up', "Three cards from the rack. Take one for your deck.")],
  hardwareLive: [L('sword_raised', "The real arms are awake! Mind your fingers. Every card you play, the arm plays for real.")],
  hardwareOffline: [L('worried', "The real arms are asleep. We'll play it in the sand pit for now.")],
};

export function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
