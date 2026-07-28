// What a citoyen says out loud.
//
// The table is not supposed to name its cards, but it does speak up — "I can't
// defend", "I need to lie low", "I got this", "please kill the royal". These are
// those remarks, derived honestly from a hand and published as coarse flags.
//
// A signal is only broadcast when it is worth saying: trouble, or a hand that can
// settle the fight. The mundane middle ("I can chip a bit", "I'm fine") stays
// unspoken, which is what keeps this well short of playing with open hands.

import { cardValue } from '../../shared/engine.js';
import { damageProfile } from './moves.js';

export function handValue(hand) {
  let v = 0;
  for (const c of hand) v += cardValue(c);
  return v;
}

// The cheapest pile of cards that covers a blow, and what it costs to give up.
// Returns null when the hand cannot cover it at all.
export function cheapestPayment(hand, damage) {
  if (damage <= 0) return { cards: [], value: 0 };
  const sorted = [...hand].sort((a, b) => cardValue(a) - cardValue(b));
  const cards = [];
  let value = 0;
  for (const c of sorted) {
    if (value >= damage) break;
    cards.push(c);
    value += cardValue(c);
  }
  return value >= damage ? { cards, value } : null;
}

// Everything one citoyen would be willing to say about their own hand, given
// what the table can already see.
export function readHand(view, hand) {
  const enemy = view.enemy;
  if (!enemy) return null;
  const remaining = enemy.health - enemy.damage;
  const blow = enemy.effectiveAttack;
  const value = handValue(hand);

  const { best, canFinish, hasExact } = damageProfile(view, hand);

  const payment = cheapestPayment(hand, blow);
  let defence;
  if (!payment) defence = 'none';
  else if (payment.value > 0.6 * Math.max(1, value)) defence = 'tight';
  else defence = 'safe';

  let power;
  if (best >= 0.6 * remaining) power = 'strong';
  else if (best >= 0.2 * remaining) power = 'useful';
  else power = 'nothing';

  return { defence, power, canFinish, hasExact, best, value };
}

// The public remark: what the rest of the table actually hears. Only trouble and
// decisive strength get said; everything else is withheld.
export function speak(view, hand, seat) {
  const read = readHand(view, hand);
  if (!read) return null;
  const player = view.players[seat];
  return {
    seat,
    handCount: player.handCount,
    laidLow: player.laidLow,
    // "I can't defend."
    cannotDefend: read.defence === 'none',
    // "I got this."
    strong: read.power === 'strong',
    // "I can kill it." / "I can take it clean."
    canFinish: read.canFinish,
    hasExact: read.hasExact,
    // "I need to lie low."
    wantsLayLow: read.defence === 'none' && read.power === 'nothing' && !player.laidLow && !view.solo,
    // "Please kill the royal."
    wantsRoyalDead: read.defence === 'none',
  };
}

// The whole table's remarks, as heard by everyone.
export function tableTalk(state, viewOf) {
  return state.players.map((p, i) => speak(viewOf(i), p.hand, i));
}

// A silent table: hand counts are still public, but nobody volunteers anything.
export function mute(view) {
  return view.players.map((p, i) => ({
    seat: i,
    handCount: p.handCount,
    laidLow: p.laidLow,
    cannotDefend: false,
    strong: false,
    canFinish: false,
    hasExact: false,
    wantsLayLow: false,
    wantsRoyalDead: false,
  }));
}
