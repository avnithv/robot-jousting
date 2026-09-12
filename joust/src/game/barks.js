// Short in-character lines the fighters shout during play, plus the Herald's announcements. Text only; the
// voice module (src/audio/voice.js) says them and stage.bark() shows them in a bubble over the arm, so every
// line has to fit: keep them under ~45 characters and aimed at the human as much as at the arm.
// Keyed by match event:
//   intro, plan (while the player thinks), plan_long / plan_long2 (12 s and 25 s of thinking: escalating),
//   taunt_idle (the player left a beat empty), taunt_lead (well ahead), taunt_behind (losing but defiant),
//   comeback (nearly dead and landed one), hit_landed, took_hit, blocked, got_blocked, exposed, staggered,
//   clash, low_hp, win, lose, feint_worked, punished_feint, clean_hit, parry, windup, double_feint,
//   rush / full_tilt (the rail: got to the centre first, twice in a row), countered (a held counter fired),
//   charged (the rail filled up), no_voltage (a rush on an empty rail),
//   dance (shouted through the victory dance), mope (muttered through the defeat),
//   opener_<SCENE> (one per opening scene in stage.js: SALUTE_FORMAL, GLOVE_TOUCH, STAREDOWN,
//   COCKY_VS_NERVOUS, CIRCLING, CHAMPION_ENTRANCE, OLD_RIVALS, IMPATIENT; missing ones fall back to intro).
export const BARKS = {
  squire: {   // Bluebell: sweet, reckless, ten going on knight
    intro: ["Hi! I'm Bluebell! Ready? GO!", "Sir Percival said watch my feet. Whatever!", "I've never lost! Well. Once. Twice.", "Loser buys the honey cakes!", "You're the tavern arm? Neat!", "I practised ALL morning. Mostly.", "Don't go easy. I'll know!", "My first real Tilt! Don't blink!", "Marla says you're good. Prove it!", "I named my sword Biscuit. Say hi!"],
    plan: ["Hurry uuup!", "Pick a card! Any card!", "Are you scared? I'm not scared.", "Ooh, is it the pointy one?", "I already know what I'm doing!", "Is your hand stuck?", "Blink twice if you need help.", "Pick the shiny one! Trust me!", "Tick! Tock! Tick! Tock!", "I could've eaten a cake by now."],
    plan_long: ["Are you asleep over there?", "My cake is getting cold!", "Have you FOUND the cards yet?", "Blink if you can hear me!", "Marla, is it broken?", "I could learn to read by now.", "Should I come and pick for you?", "Still thinking? Wow. Okay. Wow.", "The sun's going down, you know.", "Is this a staring contest?"],
    plan_long2: ["I've grown an INCH waiting!", "Your mum picks faster than this!", "The crowd went home! ALL of them!", "I'm having a nap. Wake me.", "Should I fetch you a chair?", "My honey cakes went stale. STALE!", "Sir Percival's beard grew. Twice.", "Pick one! Any one! I'll allow it!", "Is your brain buffering?", "Longest. Day. Of. My. LIFE."],
    taunt_idle: ["You just STOOD there!", "Was that a nap? In a FIGHT?", "Free hit! Thank you!", "Do something! Anything!", "Are you saving them for later?", "Empty beat! Even I know that's bad!", "Sir Percival would faint!", "Standing still isn't a move!", "Hello? Is anybody driving?"],
    taunt_lead: ["I'm WINNING! Me! Bluebell!", "Look at the board! LOOK!", "Should I go easier? I can't.", "This is my best day ever!", "Are you letting me win? Don't!", "Honey cakes are MINE!", "Tell Marla I said hello!", "One more and it's over!", "You're not very good at this!"],
    taunt_behind: ["That's fine. That's TOTALLY fine.", "I'm just warming up!", "Sir Percival lost first too!", "Not crying. Sweating. From my eyes.", "I've got a plan. Sort of!", "You got lucky! Four times!", "Wait till you see my NEXT one!", "I'm meant to be losing. Tactics!", "Best of a hundred?"],
    comeback: ["Hey! You're meant to fall over!", "How are you still UP?", "That's not fair, you're wobbly!", "Stop being brave! Stop it!", "Marla, he's cheating with grit!", "Okay. That one hurt. A bit.", "You're all scratches and spite!", "Fine! FINE! Stay up then!"],
    hit_landed: ["Got you! Got you!", "Did you SEE that?!", "Sir Percival! Did you see?", "Oops! Sorry! Not sorry!", "That's for the honey cakes!", "Biscuit says hello!", "Bonk! Right on the shiny bit!", "I'm GOOD at this!"],
    took_hit: ["Ow! That's my arm!", "Hey! I wasn't ready!", "Okay. Okay. That's fine.", "I'm telling Marla!", "That's going to be a bruise!", "Rude! Very rude!", "Do that again and I'll cry.", "OW. Ow ow ow."],
    blocked: ["Ha! Wall!", "Nope! Blocked it!", "Sir Percival taught me that one!", "Bonk! Nothing!", "Try the OTHER line, genius!", "My bar! My rules!", "You telegraphed that one!", "Boing! Off you go!"],
    got_blocked: ["Aw, come on!", "Stop being so BLOCKY!", "That was my best chop!", "You can't just... block!", "Move out the WAY!", "Who taught you that? Marla?", "Boo! Boring!", "Fine. I'll go round."],
    exposed: ["Wait, that wasn't real?", "Hey! You tricked me!", "Whoops. Guarding air.", "That's cheating! Is that cheating?", "You LIED with your arm!", "My guard! It's all wasted!", "Sneaky! I'm learning that one.", "Nooo, I fell for it!"],
    staggered: ["Whoa whoa whoa!", "The ground moved! Not me!", "Dizzy. Very dizzy.", "I meant to do that.", "Everything's got two of it!", "Who put the sky there?", "Give me a second! One second!", "Legs! Legs, listen to me!"],
    clash: ["Sparks! Do it again!", "CLANG! I love that noise!", "Same line! Jinx!", "My teeth are buzzing!", "Oooh, that felt expensive.", "Biscuit's fine! I checked!", "Again! AGAIN!", "That's my favourite sound."],
    low_hp: ["I'm not crying. YOU'RE crying.", "Just a scratch. Lots of scratches.", "I can still stand! Mostly.", "Don't tell Sir Percival.", "I'm fine! Everything's fine!", "Squires don't quit. Ever.", "Okay, maybe one little cry.", "I'm still here! Barely, but here!"],
    win: ["I WON! I actually WON!", "Marla! Everyone! I WON!", "Honey cakes are on YOU!", "Sir Percival, did you SEE?", "Best squire in Tiltford!", "Put my name over the bar!", "I beat the Red Lion! ME!", "Again! Let's go again!"],
    lose: ["Okay. You were better. Today.", "Best of five? Best of ten?", "I'm going to practise SO much.", "Ow. Good fight. Ow.", "Don't tell the Lily. Please.", "You're really, really good.", "Hmph. Next Tilt. You'll see.", "That's my first proper loss."],
    feint_worked: ["Ha HA! You fell for it!", "Made you flinch! Made you flinch!", "That wasn't even real!", "Gotcha! Guarding nothing!", "Your guard's rubbish now!", "I learned that from a BOOK!", "Flinchy! Flinchy knight!", "Look at you, blocking air!"],
    punished_feint: ["Nice try! Not!", "I saw that from the tavern!", "Fake swing, REAL bonk!", "Trick me? Ha!", "Liars get bonked!", "That's what you get!", "My eyes work, you know!", "Silly wiggle. Real hit."],
    clean_hit: ["You just STOOD there!", "Free hit! Thanks!", "Wake up, Lionheart!", "That one's for the honey cakes!", "Napping? In MY Tilt?", "Easiest hit of my LIFE!", "Was that on purpose? Really?", "Do that again! Please!"],
    parry: ["Caught it! Now watch THIS!", "Parry! Riposte! Percival's word!", "Ha! And back at you!", "Snap! Mine now!", "Thank you for the sword!", "I'm keeping this one!", "Catch and throw! Catch and throw!", "Sir Percival, DID YOU SEE?"],
    windup: ["Big one coming! Ready? READY?", "Watch this, everybody!", "This one's gonna be HUGE!", "Up, up, uuuup!", "I'm winding! I'm winding!", "Cover your eyes, Marla!", "Here comes a BIG one!", "Biscuit is VERY excited!"],
    double_feint: ["We both faked! Ha!", "Nobody did anything! Again!", "Jinx! You owe me a cake!", "That was silly. Do it again!", "Two liars, no sword!", "The crowd's so confused!", "We're both terrible!", "Did we just dance?"],
    dance: ["I WON! I ACTUALLY WON!", "Marla! MARLA! Did you see?!", "Honey cakes are on YOU!", "Look at me! LOOK AT ME!", "Sir Percival! I did it! ME!", "Dancing! I'm dancing! Whee!", "Best squire in Tiltford!", "Put my name over the bar!", "Wheeeee!"],
    mope: ["I had him. I HAD him.", "The sun was in my eyes.", "Biscuit slipped. It wasn't me.", "Don't look at me. Don't.", "I want my honey cakes.", "The crowd put me off. All of them.", "I'm not crying, it's windy.", "Sir Percival is going to KNOW.", "One more go. Please? One?", "This floor is crooked. Very."],
    opener_COCKY_VS_NERVOUS: ["Ooh. You're bigger up close.", "I'm not nervous. You're nervous.", "Don't do the twirly thing. Please."],
    opener_IMPATIENT: ["Come ON! I've been ready for AGES!", "Any day now, tavern arm!", "Tap tap tap. That's me waiting."],
    opener_GLOVE_TOUCH: ["Tap! That's for luck!", "Good luck! Not too much luck.", "Blades touched. No takebacks!"],
    opener_CIRCLING: ["Round and round and round!", "I'm circling. Very scary, yes?", "Stop copying my feet!"],
    rush: ["Down the rail! WHEEE!", "I got there first! I GOT THERE FIRST!", "Zoom! That's a rush!"],
    full_tilt: ["FULL TILT! Both of them! BOTH!", "I did the two-in-a-row thing!", "Can't stop! Won't stop!"],
    countered: ["Bonk! That was YOUR swing!", "Counter! Sir Percival taught me!", "Ha! You hit you!"],
    charged: ["Rail's full! Rail's FULL!", "Two charges! Watch this!"],
    no_voltage: ["Huh? Nothing happened.", "Oh. I forgot to load it.", "Wait, that was supposed to go!"],
  },
  percival: {   // Sir Percival of the Lily: pompous, immaculate, never wrong
    intro: ["Sir Percival of the Lily. Charmed.", "Do try to make it interesting.", "A tavern arm? How quaint.", "En garde, as the poets say.", "I have a cordial waiting. Be brief.", "My record is unblemished. Mostly.", "You smell faintly of ale, sirrah.", "Shall we? The light is perfect.", "Bluebell speaks well of you. Odd.", "Mind the plate. It was polished."],
    plan: ["Take your time. I have all day.", "One notices you hesitate.", "The high line again, I expect.", "Deliberating? How novel.", "I planned three moves already.", "Do consult your barkeep.", "A guard, then. Predictably.", "Fascinating. Truly riveting.", "I shall admire the bunting.", "Courage is also a choice, sirrah."],
    plan_long: ["Sirrah. The century is passing.", "My cordial has gone warm.", "Is this a siege or a duel?", "One could compose a sonnet.", "The Lily wilts, and so do I.", "Do the cards require translation?", "I have begun to age visibly.", "Choose, or I shall choose for you.", "Even the Herald is yawning.", "Deliberation is not a virtue here."],
    plan_long2: ["I have written my memoirs. Twice.", "The crowd has aged. I have aged.", "Your mother picks faster, sirrah.", "Shall I send for a physician?", "This is no longer sport. It is geology.", "I could have knighted someone!", "Bluebell has learned to READ.", "Pick. A. Card. Any card.", "The Lily has flowered. And died.", "I accept your surrender by boredom."],
    taunt_idle: ["You did... nothing. Bold.", "An empty beat. How avant-garde.", "Was that a statement, sirrah?", "Standing still is not a guard.", "One must actually play the cards.", "The blade goes in the other one.", "A free hit. How generous of you.", "Did the arm fall asleep, or you?", "Nothing. Beautifully executed."],
    taunt_lead: ["The tally is embarrassing. For you.", "Shall I fight left-handed?", "I do this professionally, sirrah.", "You may concede at any point.", "The Lily is barely creased.", "This is the part where you lose.", "I shall be gentle in my memoirs.", "Do you require a handicap?", "One more, and a cordial."],
    taunt_behind: ["A temporary arrangement.", "I am simply studying you.", "The Lily bends. It does not break.", "I permitted those. All of them.", "The real duel begins now.", "My tailor will hear of this.", "Luck is not a strategy, sirrah.", "I have you exactly where I want you.", "This is a comeback. Observe."],
    comeback: ["Stay DOWN, you dreadful man.", "How are you still upright?", "That is structurally impossible.", "Impudent, and still standing!", "The tavern breeds stubbornness.", "One does not rally. It is gauche.", "Fall over. It is the custom.", "You are held together by spite."],
    hit_landed: ["Noted, and punished.", "A touch. Naturally.", "One does not miss.", "For the Lily!", "That was for the ale smell.", "Textbook. My textbook.", "Do write that one down.", "Effortless, as advertised."],
    took_hit: ["You DARE?", "A lucky swing. Purely lucky.", "The plate is dented. The pride is not.", "Impudent!", "That was my GOOD side.", "I shall allow you the one.", "Do you know what polish costs?", "Unworthy. And effective. Hm."],
    blocked: ["Predictable. Utterly.", "Ah. The bar was up.", "I read that in a book once.", "Did you think I would not guard?", "You telegraph like a herald.", "The Lily does not open.", "A wall, sirrah. A wall.", "Try the other line. I dare you."],
    got_blocked: ["Hm. Sturdy.", "A block! How sporting.", "Fortune favours the fool. Briefly.", "Bracing. Truly.", "One notes the guard. One adapts.", "Lucky. Write it down as luck.", "A tavern trick.", "Very well. The low line, then."],
    exposed: ["A feint? Ungentlemanly!", "Deception! I protest!", "You... feinted. Noted.", "That is NOT in the book.", "Theatre! In MY duel!", "My guard, wasted on a lie.", "The Lily does not lie, sirrah.", "I shall pretend that never happened."],
    staggered: ["Unhand my footing!", "A momentary stumble.", "The ground is uneven. Clearly.", "I meant to lean.", "This is a considered wobble.", "My boots are new!", "Someone move the sky back.", "One moment. Composure. One moment."],
    clash: ["Steel sings!", "A proper exchange at last.", "Even. For now.", "Ah. Sparks. How festive.", "Finally, a duel and not a scuffle.", "Your blade rings cheaply.", "Again, sirrah! With feeling!", "The Lily approves of that one."],
    low_hp: ["I have been better. Briefly.", "The Lily does not wilt.", "Merely winded, sirrah.", "A flesh wound. Several, in fact.", "This is a tactical dishevelment.", "My plate is a suggestion now.", "I decline to fall over.", "One does not yield to a tavern."],
    win: ["As foretold. Naturally.", "The Lily stands. Do sit down.", "Marla! A cordial. I've earned it.", "Adequate sport. Barely.", "Write it as a lesson, not a loss.", "Superb. And expected.", "Bluebell, take notes.", "That is how it is done, sirrah."],
    lose: ["Impossible. Utterly impossible.", "I demand a rematch. In writing.", "Bluebell, do not look at me.", "The sun was in my visor.", "This will not appear in my memoirs.", "My tailor distracted me.", "An administrative error.", "Well struck. I said it. Once."],
    feint_worked: ["Deceived. As planned.", "You guard shadows, sirrah.", "A feint. Elementary.", "Do keep swinging at nothing.", "The Lily has a sense of humour.", "Your guard is now decorative.", "Flinching is a choice, sirrah.", "I lied. Gracefully."],
    punished_feint: ["Theatre. I do not attend.", "A feint? Punished, naturally.", "One sees through cheap tricks.", "Sincerity, sirrah. Try it.", "Your wiggle cost you dearly.", "I have read that book too.", "A liar's bruise.", "Do not wave. Strike."],
    clean_hit: ["Idle arms invite the blade.", "You stood still. I did not.", "Effortless.", "Perhaps guard next time.", "A gift. I accepted it.", "Charity, and I am not proud.", "One cannot parry a nap.", "You were AFK, I believe the term is."],
    parry: ["Caught. And returned with interest.", "Parry, riposte. The classics.", "Textbook. My textbook.", "Now: the answer.", "Your blade, briefly mine.", "That is called technique.", "Thank you for the momentum.", "Bluebell, THAT is a parry."],
    windup: ["Observe. A proper swing.", "Brace yourself. Or do not.", "The Lily rises.", "This will be educational.", "I am winding. You are worrying.", "Choose a line. Choose poorly.", "Announcing it is only fair.", "Somebody fetch the physician."],
    double_feint: ["We are both fools, it seems.", "A dance. How embarrassing.", "Neither of us committed. Tsk.", "The crowd deserves better.", "Two lies and no blade.", "Shall we try honesty?", "That was a conversation, not a duel.", "I blame your influence."],
    dance: ["The Lily! The LILY!", "Marla, my cordial! Chilled!", "Bow, Tiltford. Bow properly.", "Unblemished. Nearly.", "That is how a knight wins.", "Bluebell, take notes. Many notes.", "Modesty forbids. Mostly.", "A flourish! For the ladies!", "Applaud. You may applaud."],
    mope: ["The light was wrong. Obviously.", "My tailor will answer for this.", "Do not look at me, Bluebell.", "A clerical error. Nothing more.", "The crowd breathed on my visor.", "I permitted that. I think.", "The Lily has never lost. Never.", "Someone oiled the floor. Someone.", "Tsk. Tsk, I say.", "I shall be in the tent."],
    opener_SALUTE_FORMAL: ["The forms first, sirrah. Always.", "A salute. Even to a tavern.", "Blade up. Chin up. Begin."],
    opener_OLD_RIVALS: ["You again. Of course.", "Same line, same bruise, same day.", "Let us skip the pleasantries."],
    opener_GLOVE_TOUCH: ["Touch. There. Sporting, yes?", "A courtesy. Do not mistake it.", "Steel to steel. Good luck, sirrah."],
    opener_CIRCLING: ["Circle all you like. I see you.", "Measure me, sirrah. Do.", "Round we go. How tiresome."],
    opener_STAREDOWN: ["Stare away. The Lily blinks last.", "Closer. I want to see the fear.", "Hm. You do not flinch. Noted."],
    rush: ["The rail is mine.", "First to the centre. As always.", "Speed, sir. Then steel."],
    full_tilt: ["FULL TILT. Stand aside.", "Twice down the rail. Nothing holds.", "This is what the rail is FOR."],
    countered: ["Your own stroke, sir. Returned.", "The counter answers you.", "I merely held it still."],
    charged: ["The rail is charged. Mind yourself.", "Two loads. I need only one."],
    no_voltage: ["Bah. An empty rail.", "Wasted. My error.", "One does not rush on nothing."],
  },
  champion: {   // The Iron Champion: cold, huge, speaks in status reports
    intro: ["CHALLENGER DETECTED.", "THREE TILTS. ZERO DEFEATS.", "BEGIN.", "YOUR HOUSE. IRRELEVANT.", "NAME LOGGED. OUTCOME KNOWN.", "YOU ARE THE FOURTH THIS YEAR.", "TAVERN ARM. SERIAL UNKNOWN.", "I HAVE READ YOUR DECK.", "RESISTANCE NOTED. CONTINUE.", "THE CROWD WILL BE DISAPPOINTED."],
    plan: ["WAITING.", "DECIDE.", "YOUR PATTERN. KNOWN.", "SUCCESS PROBABILITY. LOW.", "TICK. TOCK.", "I HAVE SIMULATED ALL OF THEM.", "CHOOSE. THE RESULT IS FIXED.", "YOUR HAND IS NOT A SECRET.", "PROCESSING YOUR DELAY.", "THIS IS NOT A PUZZLE."],
    plan_long: ["DELAY LOGGED. TWELVE SECONDS.", "STILL WAITING.", "YOUR PROCESSOR IS SLOW.", "THINKING DOES NOT HELP YOU.", "I HAVE COOLED DOWN. RESTART?", "TIMEOUT APPROACHING.", "DECISION. NOW.", "IDLE HUMAN DETECTED.", "THE OUTCOME HAS NOT CHANGED.", "PATIENCE: NOT INSTALLED."],
    plan_long2: ["DELAY: TWENTY FIVE SECONDS.", "I HAVE ENTERED LOW POWER MODE.", "THE CROWD HAS AGED. I HAVE NOT.", "YOUR MOTHER DECIDES FASTER.", "RECOMMENDATION: ANY CARD.", "THIS IS NOT STRATEGY. IT IS FEAR.", "I WILL BEGIN WITHOUT YOU.", "ERROR: OPPONENT NOT RESPONDING.", "SHALL I FETCH THE HERALD?", "BOREDOM: NOW MEASURABLE."],
    taunt_idle: ["EMPTY BEAT. LOGGED.", "NO INPUT DETECTED.", "YOU DID NOTHING. I NOTICED.", "IDLE ARMS ARE TARGETS.", "THAT WAS NOT A MOVE.", "VACANCY. EXPLOITED.", "STANDING STILL: NOT A STRATEGY.", "FREE DAMAGE. THANK YOU.", "WAS THAT INTENTIONAL? TRULY?"],
    taunt_lead: ["YOUR INTEGRITY: FAILING.", "PROJECTED OUTCOME: UNCHANGED.", "TWO MORE. THEN THE TILT ENDS.", "YOU MAY YIELD NOW.", "THE MATH IS NOT KIND.", "I AM NOT EVEN WARM.", "SCOREBOARD. READ IT.", "THIS IS THE EXPECTED RESULT.", "RESISTANCE: DECORATIVE."],
    taunt_behind: ["ANOMALY. TEMPORARY.", "RECALCULATING. STAND BY.", "THIS CHANGES NOTHING.", "YOUR LUCK IS A VARIABLE.", "I HAVE NOT YET BEGUN.", "CORRECTION INCOMING.", "ERROR ACKNOWLEDGED. ADAPTING.", "THE CURVE WILL RETURN.", "ENJOY THE LEAD. BRIEFLY."],
    comeback: ["STILL FUNCTIONAL. HOW.", "YOUR HULL SHOULD HAVE FAILED.", "UNEXPECTED. RECALCULATING.", "STUBBORNNESS IS NOT ARMOR.", "THAT SHOULD NOT HAVE LANDED.", "REVISING THREAT ESTIMATE.", "YOU ARE HARDER TO CLOSE.", "ANOMALY DETECTED: YOU."],
    hit_landed: ["IMPACT CONFIRMED.", "DAMAGE. AS CALCULATED.", "STRUCTURAL FAILURE. PENDING.", "YIELDING IS PERMITTED.", "ANOTHER. AS PREDICTED.", "YOUR GUARD WAS ELSEWHERE.", "EFFICIENT.", "THAT WILL LEAVE A MARK."],
    took_hit: ["ARMOR HOLDS.", "DAMAGE. NEGLIGIBLE.", "RECALIBRATING.", "NOTED.", "PAIN SUBROUTINE: ABSENT.", "SUPERFICIAL. CONTINUE.", "YOU HAVE MY ATTENTION.", "THAT WAS PERMITTED."],
    blocked: ["DENIED.", "PREDICTED.", "GUARD. OPTIMAL.", "NO.", "REJECTED.", "YOUR LINE WAS OBVIOUS.", "IMPACT ABSORBED.", "TRY THE OTHER LINE."],
    got_blocked: ["GUARD ACKNOWLEDGED.", "ADJUSTING.", "INEFFICIENT.", "YOUR BAR. NOTED.", "PATTERN UPDATED.", "ONE ATTEMPT. WASTED.", "REROUTING.", "NEXT ATTEMPT: LOWER."],
    exposed: ["FEINT. UNEXPECTED.", "ERROR. GUARD MISPLACED.", "RECOMPUTING.", "THAT WAS NOT A SWING.", "DECEPTION LOGGED.", "MY GUARD: WASTED.", "UNFORESEEN. ONCE.", "YOU LIED WITH YOUR ARM."],
    staggered: ["GYRO FAULT.", "BALANCE. RESTORING.", "STABILITY LOST. TEMPORARY.", "SERVO. STALL.", "HORIZON. MISPLACED.", "REBOOTING LEGS.", "THIS IS NOT A FALL.", "CORRECTING. CORRECTING."],
    clash: ["FORCE EQUAL.", "CONTACT.", "AGAIN.", "ACCEPTABLE.", "SYMMETRY.", "NEITHER YIELDS. NOTED.", "SPARKS. IRRELEVANT.", "THE SAME LINE. AGAIN."],
    low_hp: ["CORE INTEGRITY. THIRTY PERCENT.", "THIS CHANGES NOTHING.", "PROTOCOL: CONTINUE.", "PAIN. NOT FOUND.", "SYSTEMS: DEGRADED. WILL: NOT.", "I HAVE BEEN LOWER. ONCE.", "RESERVE POWER ENGAGED.", "STILL STANDING. STILL WINNING."],
    win: ["TILT RETAINED.", "FOUR TILTS. ZERO DEFEATS.", "REST, LIONHEART.", "AS CALCULATED.", "THE RESULT WAS ALWAYS THIS.", "YOU LASTED LONGER THAN MOST.", "RECORD UPDATED.", "RETURN NEXT YEAR."],
    lose: ["IMPOSSIBLE. RECALCULATING.", "SHUTTING... DOWN.", "TILT... LOST.", "WELL FOUGHT. LIONHEART.", "ERROR. ERROR. ERR—", "MY RECORD. BROKEN.", "THE TAVERN ARM. WINS.", "LOGGING... DEFEAT."],
    feint_worked: ["DECOY ACCEPTED.", "YOU GUARDED NOTHING.", "PREDICTABLE.", "ERROR: YOURS.", "YOUR GUARD IS NOW DEAD WEIGHT.", "I CAN LIE TOO.", "FLINCH LOGGED.", "DECEPTION: EFFECTIVE."],
    punished_feint: ["DECEPTION DETECTED.", "FEINT REJECTED.", "YOUR TRICK. MY HIT.", "INEFFECTIVE.", "I DO NOT FLINCH.", "THEATRE. PUNISHED.", "YOUR WIGGLE COST YOU.", "LIES COMPUTE POORLY."],
    clean_hit: ["TARGET IDLE. STRUCK.", "NO RESISTANCE.", "EFFICIENT.", "STAND STILL AGAIN.", "AN OPEN ARM IS AN INVITATION.", "ZERO DEFENCE. FULL DAMAGE.", "THAT WAS FREE.", "YOU WERE NOT THERE."],
    parry: ["CAUGHT. RETURNING.", "PARRY. RIPOSTE.", "ABSORBED. AMPLIFIED.", "YOUR FORCE. MINE.", "MOMENTUM: CONFISCATED.", "THANK YOU FOR THE ENERGY.", "REDIRECTED.", "NOW: THE ANSWER."],
    windup: ["CHARGING.", "MAXIMUM TORQUE.", "BRACE.", "IMPACT IMMINENT.", "POWER: NINETY PERCENT.", "THIS ONE WILL HURT.", "WINDING. GUESS THE LINE.", "SKY INCOMING."],
    double_feint: ["NULL EXCHANGE.", "WASTED MOTION. BOTH.", "RECALCULATING.", "POINTLESS.", "TWO LIES. NO DAMAGE.", "THE CROWD IS CONFUSED.", "INEFFICIENT. BOTH OF US.", "ZERO. ZERO."],
    dance: ["TILT RETAINED. AGAIN.", "OBSERVE THE RECORD.", "FOUR. ZERO.", "THE IRON HOLDS.", "CELEBRATION SUBROUTINE: RUNNING.", "TILTFORD. YOUR CHAMPION.", "THIS IS JOY. APPROXIMATELY.", "DANCE PROTOCOL ENGAGED.", "YOU MAY CHEER NOW."],
    mope: ["RECALCULATING... RECALCULATING...", "THE MATH WAS CORRECT.", "SOMETHING IN MY JOINT. SAND.", "POWERING DOWN. JOINT BY JOINT.", "MY RECORD... MY RECORD...", "THE CROWD. TOO LOUD. A FACTOR.", "I DO NOT UNDERSTAND.", "ERROR NOT FOUND. THAT IS WORSE.", "LOG IT. LOG IT ALL.", "...WELL FOUGHT."],
    opener_CHAMPION_ENTRANCE: ["KNEEL. IT IS EFFICIENT.", "THE CHAMPION HAS ARRIVED.", "YOU MAY LOOK UP NOW."],
    opener_STAREDOWN: ["I DO NOT BLINK.", "SCANNING. YOU ARE AFRAID.", "CLOSER. LET ME MEASURE YOU."],
    opener_OLD_RIVALS: ["YOU AGAIN. SAME RESULT.", "FILE REOPENED.", "BEGIN. AS BEFORE."],
    opener_SALUTE_FORMAL: ["CEREMONY. ACCEPTED.", "FORMALITIES LOGGED. BEGIN.", "BLADE UP. THEN DOWN."],
    rush: ["RAIL CLAIMED.", "FIRST. ALWAYS FIRST.", "VELOCITY: SUPERIOR."],
    full_tilt: ["FULL TILT. NO GUARD APPLIES.", "TWO RUSHES. ONE RESULT.", "MAXIMUM RAIL."],
    countered: ["RETURNED TO SENDER.", "YOUR FORCE. YOUR PROBLEM.", "COUNTER: EXPENDED. WORTH IT."],
    charged: ["RAIL: FULL.", "CHARGE AT MAXIMUM."],
    no_voltage: ["ERROR. NO CHARGE.", "RAIL EMPTY. LOGGED.", "MISCALCULATION."],
  },
};
// The player's own knight, the red arm: brash, loyal to the Crown, a bit of a show-off.
BARKS.lionheart = {
  intro: ["For the Red Lion!", "Marla's watching. Don't blink.", "Right. Let's give them a show.", "Steady, steady... GO.", "Tiltford! Are you AWAKE?", "One more for the tavern!", "Mind the good arm, it's rented.", "Let's make this loud.", "The Crown's watching. Probably.", "Pint's waiting. Let's be quick."],
  taunt_idle: ["Napping, are we?", "That was NOTHING. Do better.", "Free hit, thanks kindly!", "Move something! Anything!", "Is that arm plugged in?", "You left the door wide open!", "Empty beat, empty head!", "Hello? Anyone steering?", "I'll wait. No I won't."],
  taunt_lead: ["Look at that scoreboard!", "Shall I fight one-handed?", "Tiltford's already singing!", "You're running out of arm.", "Pint's nearly poured!", "One more and it's over.", "This is going in the song.", "Don't feel bad. Feel beaten.", "Marla, warm up the bar!"],
  taunt_behind: ["Right. NOW I'm cross.", "Lions bite last.", "I've had worse. Recently.", "That's my warm-up done!", "You'll not like the next one.", "Down but very, very loud.", "Come on then! COME ON!", "Marla, watch THIS bit.", "Still here. Still swinging."],
  comeback: ["Not! Done! Yet!", "The Lion's still got teeth!", "Told you not to blink!", "That's the comeback, that is!", "Get up, Lion. Good lad.", "One arm, all spite!", "Tiltford, are you watching?!", "I live on scraps and grudges!", "Down? Me? Never!"],
  hit_landed: ["That's the one!", "Felt that, did you?", "For the Crown!", "Ha! Right on the plate!", "Put that in your ledger!", "Marla, mark it down!", "One for the tavern!", "That's what a Lion does!"],
  took_hit: ["Oof. Fair.", "Gah! Cheeky!", "That'll bruise.", "Alright. ALRIGHT.", "Hah! Barely felt it. Liar.", "Right in the paintwork!", "Noted. Returning shortly.", "That one's going on the tab."],
  blocked: ["Not today!", "Wall of iron!", "Bounce off THAT.", "Nope.", "Tavern doors, mate. Shut.", "Try knocking.", "Denied, politely.", "All day long!"],
  got_blocked: ["Bah! Sturdy.", "Come on, budge!", "Fine. Fine. Next one lands.", "Guarded, eh?", "Blocky sort, aren't you?", "Move that bar and fight me!", "Good arm. Annoying arm.", "Right. Low next."],
  exposed: ["Wh... that wasn't real?", "Cheeky feint!", "Swinging at ghosts, am I?", "Oh, that's dirty. I like it.", "You LIED with your elbow!", "My guard! Wasted!", "Sneaky little thing!", "Right. That's a free one for you."],
  staggered: ["Whoa... floor's moving.", "Give us a second...", "Ugh. Ears ringing.", "Steady... steady...", "Two of everything!", "Who moved the arena?", "Legs. LEGS. Work.", "That's the ale, honest."],
  clash: ["Steel!", "Ha! Again!", "Feel that ring!", "Even, are we?", "Sparks over the barrels!", "Good! AGAIN!", "My favourite noise!", "Nobody yields!"],
  low_hp: ["Still standing. Just.", "Marla, keep that pint warm.", "Not done. Not nearly.", "Come on, Lion. One more.", "Held together by rust and pride.", "Tiltford! Louder!", "One good swing left in me.", "This is where I'm best."],
  win: ["LION! LION! LION!", "Drinks are on the Crown!", "Told you not to blink!", "For Tiltford!", "Put it over the bar, Marla!", "That's the Red Lion, that is!", "Who's next?! ANYONE?", "We're having a night of it!"],
  lose: ["Argh... next year.", "Well fought. Well fought.", "Pint. Then revenge.", "The Lion yields. Today.", "You earned that one.", "Down. Not out. Just down.", "Tiltford, I'm sorry.", "Hah. Beaten by a better arm."],
  feint_worked: ["HA! Made you flinch!", "Guarding air, are we?", "Oldest trick at the Tilt!", "Gotcha. Now the real one.", "Look at that lovely flinch!", "Marla taught me that!", "Your guard's scrap now!", "Lies! Beautiful lies!"],
  punished_feint: ["Saw it coming a mile off!", "Fake swing? Real bonk.", "Nice try, pretty please.", "Marla taught me that tell!", "Waggle at me, will you?", "Liars get the low line!", "That's a tavern trick, mate.", "Not falling for that twice!"],
  clean_hit: ["Free hit! Thanks kindly!", "You just STOOD there!", "Wake up, that's a sword!", "Clean as a whistle!", "Open arm, open ledger!", "Was that a rest? In a TILT?", "Easy money.", "Do that again, please."],
  parry: ["Caught it! And BACK!", "Parry! Riposte! Cheers!", "Mine now!", "Snap. Yours to lose.", "Thanks for the swing!", "Borrowed your blade, mate.", "That's technique, that is!", "Catch! Give! Catch! Give!"],
  windup: ["Big one! Duck!", "Here comes the sky!", "Up, up... and DOWN!", "Brace, friend!", "Everyone SEE this?", "Guess the line. Go on.", "This one's for the crowd!", "Winding! Fair warning!"],
  double_feint: ["Ha! We both flinched!", "Well that was embarrassing.", "Dance partner, are you?", "Nobody swung! Again!", "Two liars, no blade!", "The crowd hates us.", "Shall we try actually fighting?", "Marla's covering her eyes."],
  dance: ["LION! LION! LION!", "Tiltford, ON YOUR FEET!", "Drinks on the Crown! ALL of them!", "Told you not to blink!", "Look at this! LOOK AT IT!", "Marla, my name! Over the bar!", "That's how the Lion dances!", "Bow? No. YOU bow.", "Who's next?! ANYONE?"],
  mope: ["...that was my best, that was.", "Ah, Marla. Don't watch this bit.", "The floor moved. It did.", "Give me a minute. Just a minute.", "Rusted at the wrong moment.", "The crowd... no. No excuses.", "Right. Right. Deep breath.", "Beaten fair. Say it, Lion. Fair.", "Next year. I mean it.", "Pint. Then practice. Then revenge."],
  rush: ["Down the rail! MINE!", "Got there first, mate!", "That's a RUSH, that is!", "Beat you to the middle!"],
  full_tilt: ["FULL TILT! Get out the way!", "Twice! TWICE down the rail!", "Nothing stops this one!"],
  countered: ["Counter! Have it back!", "That was YOUR swing, mate!", "Held the counter. You paid for it."],
  charged: ["Rail's full! Two charges!", "Charged up! Mind the sparks!"],
  no_voltage: ["Nothing on the rail! Bah!", "Oi, that was supposed to GO.", "Empty rail. My fault."],
  opener_SALUTE_FORMAL: ["Blade up! Proper, like.", "Manners first, bruises after.", "Right. Ceremony. Then chaos."],
  opener_GLOVE_TOUCH: ["Tap! Good luck to you.", "Steel to steel. No hard feelings.", "Touch blades, then no mercy."],
  opener_STAREDOWN: ["Go on then. Blink.", "Closer. I don't bite. Much.", "I can do this all day, mate."],
  opener_COCKY_VS_NERVOUS: ["Watch the blade, not my feet.", "Nervous? You should be.", "Come on then. I'll be gentle. No I won't."],
  opener_CIRCLING: ["Round we go, round we go.", "Measuring you, mate.", "Nice footwork. Shame about the arm."],
  opener_CHAMPION_ENTRANCE: ["Big, aren't you.", "Bow now, swing later.", "All that iron, and still beatable."],
  opener_OLD_RIVALS: ["You. Again.", "Same bruise, same spot?", "No speeches. Let's go."],
  opener_IMPATIENT: ["Alright, alright! I'm coming!", "Keep your bolts on!", "Tapping won't make me faster."],
};
// The Herald: announcer phrases, shouted at the crowd. {n} and {opp} are filled by bark(); beat[i] is beat i.
export const HERALD = {
  round_start: ["Hear ye! Round {n} of the Tilt!", "Arms to the line! Tiltford, be still!", "Lionheart against {opp}! Places!", "Round {n}! Fill your mugs, hold your tongues!"],
  opener: ["Make way! MAKE WAY!", "Salute your fighters, Tiltford!", "Hats off! The arms are facing!", "Silence for the courtesies!"],
  lock_in: ["The Lion locks in!", "Cards down! No changing now!", "Sealed and sworn! To the tilt!", "The choices are made!"],
  charge: ["CHARGE!", "They ride! They ride!", "Lances down! Look away, children!", "Have at thee!"],
  beat: ["First beat!", "Second beat!", "Third beat!"],
  clean_hit: ["A clean hit! Oh, the crowd!", "Right on the plate!", "Struck true! Struck TRUE!", "Somebody fetch a bucket!"],
  clash: ["CLASH! Sparks over the barrels!", "Steel meets steel!", "They lock! Nobody yields!", "A crack like thunder!"],
  rush: ["A RUSH! Down the rail!", "First to the centre! Oh, the speed!", "It beat the swing! It BEAT it!"],
  full_tilt: ["FULL TILT! Through the guard!", "Twice down the rail! Have mercy!", "Nothing holds that, Tiltford!"],
  countered: ["COUNTERED! Their own stroke!", "Thrown straight back at 'em!", "The counter fires and shatters the swing!"],
  ko: ["DOWN! The arm is DOWN!", "Yield! Yield! It's over!", "And that... is the tilt!", "Stay down, for pity's sake!"],
  dance: ["Look at it GO, Tiltford!", "On your feet! ON YOUR FEET!", "A dance! The crowd wants a dance!", "Throw your hats! Throw them!", "Hear that? That's the whole town!", "Somebody write this down!"],
  mope: ["Aww! Give it a cheer anyway!", "Chin up! Chin up, brave arm!", "Don't look, children. It's sulking.", "A hand for the beaten arm!", "There, there. Have a mug.", "Tiltford weeps. Briefly."],
  victory: ["LIONHEART! Victor of the round!", "The Red Lion roars! Tiltford roars back!", "A cheer for the Red Lion!", "The tavern's arm takes it!"],
  defeat: ["The Lion falls! Tiltford weeps!", "A brave tilt, but the round is lost.", "Carry the Lion home, lads.", "The crowd goes quiet. Well fought."],
};
// Which voice mood fits each bark: a default per event, then per-character overrides (the Champion is flat).
const MOOD = {
  intro: 'neutral', plan: 'sly', plan_long: 'angry', plan_long2: 'angry', taunt_idle: 'sly', taunt_lead: 'sly',
  taunt_behind: 'angry', comeback: 'excited', hit_landed: 'excited', took_hit: 'angry', blocked: 'sly',
  got_blocked: 'angry', exposed: 'worried', staggered: 'worried', clash: 'excited', low_hp: 'worried',
  win: 'excited', lose: 'worried', feint_worked: 'sly', punished_feint: 'excited', clean_hit: 'excited',
  parry: 'excited', windup: 'angry', double_feint: 'sly', dance: 'excited', mope: 'worried',
  rush: 'excited', full_tilt: 'excited', countered: 'sly', charged: 'excited', no_voltage: 'worried',
};
// Openers: the mood of the scene, per role-neutral scene name (a character can override it below).
const OPENER_MOOD = { SALUTE_FORMAL: 'neutral', GLOVE_TOUCH: 'neutral', STAREDOWN: 'angry', COCKY_VS_NERVOUS: 'sly', CIRCLING: 'sly', CHAMPION_ENTRANCE: 'neutral', OLD_RIVALS: 'neutral', IMPATIENT: 'angry' };
const MOOD_OVERRIDE = {
  squire: { plan: 'excited', plan_long: 'excited', plan_long2: 'excited', took_hit: 'worried', got_blocked: 'worried', blocked: 'excited', taunt_behind: 'worried', mope: 'worried', dance: 'excited', opener_COCKY_VS_NERVOUS: 'worried', opener_IMPATIENT: 'excited' },
  percival: { exposed: 'angry', staggered: 'angry', lose: 'angry', clash: 'neutral', plan_long: 'sly', plan_long2: 'angry', taunt_idle: 'sly', mope: 'angry', dance: 'excited', opener_OLD_RIVALS: 'sly' },
  champion: { intro: 'neutral', plan: 'neutral', plan_long: 'neutral', plan_long2: 'neutral', taunt_idle: 'neutral', taunt_lead: 'neutral', taunt_behind: 'neutral', comeback: 'neutral', hit_landed: 'neutral', took_hit: 'neutral', blocked: 'neutral', got_blocked: 'neutral', exposed: 'neutral', staggered: 'worried', clash: 'neutral', win: 'neutral', lose: 'worried', feint_worked: 'neutral', punished_feint: 'neutral', clean_hit: 'neutral', parry: 'neutral', windup: 'neutral', double_feint: 'neutral', dance: 'neutral', mope: 'worried', opener_CHAMPION_ENTRANCE: 'neutral', opener_STAREDOWN: 'neutral' },
  lionheart: { exposed: 'angry', plan: 'neutral', taunt_behind: 'angry', mope: 'worried', dance: 'excited' },
  herald: { defeat: 'worried', round_start: 'neutral', mope: 'worried', dance: 'excited' },
};
const WHO = { knight: 'percival' };   // opponent ids from script.js map onto the cast
export const BARK_EVENTS = Object.keys(MOOD);
export const HERALD_EVENTS = Object.keys(HERALD);
export const OPENER_SCENES = Object.keys(OPENER_MOOD);
const pick = list => list[Math.floor(Math.random() * list.length)];

/** A random line for `who` ('squire' | 'knight'/'percival' | 'champion' | 'lionheart' | 'herald') and `event`.
 *  vars fill {n}, {opp}; vars.beat picks the Herald's beat call; vars.tier 2 escalates plan_long to plan_long2.
 *  An opener_<SCENE> with no lines for this character falls back to its intro. Returns '' when there is
 *  nothing to say. */
export function bark(who, event, vars = {}) {
  const w = WHO[who] || who;
  let e = event;
  if (e === 'plan_long' && vars.tier >= 2) e = 'plan_long2';
  const src = w === 'herald' ? HERALD : BARKS[w] || {};
  let list = src[e];
  if (!list && e.startsWith('opener_')) list = src.opener || src.intro;
  if (!list && e === 'plan_long2') list = src.plan_long;
  if (!list) return '';
  const line = Array.isArray(list) ? (e === 'beat' && vars.beat != null ? list[vars.beat] || pick(list) : pick(list)) : list;
  return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}
/** The voice mood to say a bark with: bark(who, e) + barkMood(who, e) -> say(line, { voice, mood }). */
export function barkMood(who, event) {
  const w = WHO[who] || who, o = MOOD_OVERRIDE[w] || {};
  if (o[event]) return o[event];
  if (event.startsWith('opener_')) return OPENER_MOOD[event.slice(7)] || o.intro || MOOD.intro;
  return MOOD[event] || (w === 'herald' ? 'excited' : 'neutral');
}
