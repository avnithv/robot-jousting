// Small woodcut-style glyphs for card types (inline SVG).
const S = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="#2a1a10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const GLYPH = {
  attack: S('<path d="M4 20l11-11"/><path d="M13 5l6 6"/><path d="M15 3l6 6"/><path d="M6 15l3 3"/><path d="M3 18l3 3"/>'),
  block:  S('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="rgba(30,78,156,.25)"/><path d="M12 3v18"/>'),
  feint:  S('<path d="M4 20l7-7" stroke-dasharray="3 3"/><path d="M11 13l4-4"/><path d="M13 5l6 6"/><path d="M15 3l6 6"/><circle cx="6" cy="6" r="2"/>'),
  special: S('<path d="M12 3l2.6 5.8 6.4.6-4.8 4.2 1.5 6.2L12 16.6 6.3 19.8l1.5-6.2L3 9.4l6.4-.6z" fill="rgba(217,164,65,.35)"/>'),
  rest:   S('<path d="M5 12h14"/><path d="M8 8h8"/><path d="M10 16h4"/>'),
  stagger: S('<path d="M4 18c3-6 5 6 8 0s5 6 8 0"/><circle cx="7" cy="6" r="1.5"/><circle cx="17" cy="6" r="1.5"/>'),
  // VOLTAGE cards: a charged blade running forward on speed streaks, and a guard catching a blow to throw it back.
  rush: S('<path d="M3 8h7"/><path d="M2 12h5"/><path d="M4 16h6"/><path d="M9 19l10-10" /><path d="M17 5l4 4"/><path d="M19 3l2 2"/><path d="M12 12l3 3" stroke-opacity=".55"/>'),
  counter: S('<path d="M12 3l7 2.6v5.2c0 4.3-3 6.9-7 8-4-1.1-7-3.7-7-8V5.6z" fill="rgba(61,106,156,.28)"/><path d="M8.6 8.6l6.8 6.8"/><path d="M15.4 8.6l-6.8 6.8"/>'),
};
// Marks for the HUD and the card line row: they take the colour of the box they sit in.
export const BOLT = '<svg class="bolt" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.6 1.5 4 13.4h6.1L9.2 22.5 19.6 9.9h-6.4z"/></svg>';
export const COUNTER_MARK = '<svg class="countermark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.6l8 3v5.7c0 4.8-3.4 7.7-8 9-4.6-1.3-8-4.2-8-9V5.6z" fill="currentColor" fill-opacity=".16"/><path d="M8.2 8.2l7.6 7.6"/><path d="M15.8 8.2l-7.6 7.6"/></svg>';
// Card art: the arm doing the move, from the arm sprite sheet.
// Card art: the arm doing the move. 'arms2:' = steel-sword action sheet, 'arms:' = the first sheet.
export const ART = {
  chop: 'arms2:smash', slash_l: 'arms2:twirl', slash_r: 'arms2:twirl', thrust: 'arms2:lunge', feint_high: 'arms2:windup', feint_low: 'arms2:crouch',
  feint_right: 'arms2:crouch', guard_left: 'arms2:low', guard_right: 'arms2:low',
  guard_high: 'arms2:high', guard_low: 'arms2:low', parry_high: 'arms2:rising', parry_low: 'arms2:rising', brace: 'arms2:crouch', windup: 'arms2:raise', flourish: 'arms2:swing',
  rest: 'arms:rest', stagger: 'arms2:dizzy',
  rush: 'arms2:smash', counter: 'arms2:high',      // no sprites of their own: the chop and the high guard, re-tinted below
};
// The two VOLTAGE cards borrow a sprite and are filtered into their own metal: ember for Rush, cold steel for
// Counter. sepia()/grayscale() flatten the sheet's own hue first, so the same filter works on red and blue arms.
const WARM = 'filter: sepia(.6) saturate(2.9) hue-rotate(-14deg) brightness(1.08) drop-shadow(0 0 7px rgba(240,140,40,.55)) drop-shadow(0 4px 3px rgba(0,0,0,.35))';
const COOL = 'filter: grayscale(.9) sepia(.65) hue-rotate(176deg) saturate(2.4) brightness(1.02) drop-shadow(0 0 7px rgba(130,180,240,.45)) drop-shadow(0 4px 3px rgba(0,0,0,.35))';
export const ART_STYLE = { slash_r: 'transform: scaleX(-1)', rush: WARM, counter: COOL };
/** `alt` (the card's type) is tried when the id has no art of its own, so a renamed card still gets a face. */
export function artSrc(id, color, alt) { const key = ART[id] ? id : (alt && ART[alt] ? alt : id); const [dir, name] = (ART[key] || 'arms:rest').split(':'); return `assets/${dir}/${color}_${name}.png`; }
