// The simulated citoyens.
//
// A bot is a pure function of what one player can legitimately know: the public
// view from the engine, their own hand, and whatever the rest of the table has
// said out loud. It is never handed the game state, so it cannot see a card it
// has no business seeing.
//
// Three tiers, differing in how well the table communicates and thinks ahead:
//   'decent' — own hand only, deaf to the table, takes the biggest swing going
//   'good'   — hears the table, weighs every legal action one move deep
//   'strong' — as good, plus optimal payment and a read on who acts next

import { cardValue } from '../../shared/engine.js';
import { enumeratePlays, outcomeOf } from './moves.js';
import { cheapestPayment, handValue } from './signals.js';

// Starting weights for the 'good' tier. tune.js searches from here.
export const BASE_WEIGHTS = {
  kill: 30,          // felling the royal
  exactHand: 12,     // ...to the last point, claimed into the hand
  exactPeuple: 4,    // ...to the last point, set atop Le Peuple
  damage: 20,        // progress toward the kill
  overkill: 8,       // damage spilled past the royal's last point
  spendCard: 1.5,    // a card leaving the hand
  spendValue: 4,     // the value leaving with it
  drawMine: 2.5,     // Rally, into my own hand
  drawTeam: 2.0,     // Rally, into everyone else's
  heal: 0.8,         // Raid — prisoners back under Le Peuple, the deck's life
  shield: 6,         // barricades still standing when the blow comes
  payCost: 10,       // what surviving the counterattack costs
  death: 500,        // a move that cannot be survived
  jesterBreak: 10,   // shattering an immunity that is actually in the way
  rescue: 15,        // killing for a citoyen who says they cannot defend
  strand: 20,        // leaving a royal alive in front of one who cannot defend
  suits: 1.0,        // keeping a spread of powers available
  stall: 8,          // a turn that deals no damage
  layLowRescue: 25,  // ducking a blow that would have broken me
  regroupBase: -40,  // hoarding: a Regroup is not spent lightly
  regroupNeed: 30,   // ...unless the table is visibly falling apart
  handoff: 6,        // 'strong' only: leaving the kill to one who says they have it
};

const SUITS = ['S', 'H', 'D', 'C'];

function distinctSuits(hand) {
  let n = 0;
  for (const s of SUITS) if (hand.some(c => c.s === s)) n++;
  return n;
}

function without(hand, cards) {
  const rest = [...hand];
  for (const c of cards) {
    const i = rest.indexOf(c);
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

// ---- paying a blow ---------------------------------------------------------

// How much a card is worth keeping, beyond its face value: the Pamphleteer is
// precious, a Sans-Culotte pairs with anything, and a lone suit is a power the
// table may need.
function keepScore(card, hand) {
  if (card.r === 'X') return 100;
  let score = cardValue(card) * 0.5;
  if (card.r === 'A') score += 4;
  const sameSuit = hand.filter(c => c.s === card.s).length;
  if (sameSuit === 1) score += 3;
  const sameRank = hand.filter(c => c.r === card.r).length;
  if (sameRank >= 2 && typeof card.r === 'number') score += 2;
  return score;
}

// Give up the least useful cards that still cover the blow, then hand back
// anything the pile turns out not to need.
export function choosePayment(hand, damage) {
  if (damage <= 0) return [];
  const order = [...hand].sort((a, b) => keepScore(a, hand) - keepScore(b, hand));
  const pile = [];
  let total = 0;
  for (const c of order) {
    if (total >= damage) break;
    pile.push(c);
    total += cardValue(c);
  }
  if (total < damage) return null;
  // Drop the most valuable card the pile can spare, repeatedly.
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    const spare = pile
      .filter(c => total - cardValue(c) >= damage)
      .sort((a, b) => keepScore(b, hand) - keepScore(a, hand))[0];
    if (spare) {
      pile.splice(pile.indexOf(spare), 1);
      total -= cardValue(spare);
      trimmed = true;
    }
  }
  return pile;
}

// The 'strong' tier searches for the cheapest pile outright rather than
// trusting the greedy ordering. Hands are small enough for this to be safe.
export function optimalPayment(hand, damage) {
  if (damage <= 0) return [];
  if (hand.length > 14) return choosePayment(hand, damage);
  let best = null;
  let bestCost = Infinity;
  const n = hand.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let total = 0;
    let cost = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { total += cardValue(hand[i]); cost += keepScore(hand[i], hand); }
    }
    if (total >= damage && cost < bestCost) {
      bestCost = cost;
      best = mask;
    }
  }
  if (best === null) return null;
  return hand.filter((_, i) => best & (1 << i));
}

// ---- scoring an action -----------------------------------------------------

function scorePlay(ctx, o) {
  const { view, hand, talk, w, tier } = ctx;
  const enemy = view.enemy;
  const remaining = enemy.health - enemy.damage;
  let score = 0;

  if (o.kills) {
    score += w.kill;
    if (o.exact) score += view.rules.exactKillTo === 'hand' ? w.exactHand : w.exactPeuple;
  } else {
    score += w.damage * (o.damage / remaining);
  }
  score -= w.overkill * (o.overkill / remaining);
  score -= w.spendCard * o.spent;
  score -= w.spendValue * (o.spentValue / 20);
  score += w.drawMine * o.drawsMine;
  score += w.drawTeam * o.drawsTeam;
  score += w.heal * o.heals;
  if (o.damage === 0 && !o.isJester) score -= w.stall;

  const rest = without(hand, o.cards);
  score += w.suits * distinctSuits(rest);

  if (!o.kills) {
    score += w.shield * (Math.min(o.shieldAfter, enemy.attack) / 20);
    // The blow lands on me; what does surviving it cost?
    const payment = cheapestPayment(rest, o.counter);
    if (!payment) {
      // Cards drawn this play may yet cover it — but only maybe.
      const hopeful = handValue(rest) + o.drawnValue >= o.counter;
      score -= hopeful ? w.death * 0.35 : w.death;
    } else {
      score -= w.payCost * (payment.value / 20);
    }
  }

  // The Pamphleteer earns his keep only when an immunity is actually in the way.
  if (o.isJester) {
    const blocked = !enemy.immunityCancelled
      && hand.some(c => c.s === enemy.card.s && c.r !== 'X');
    score += blocked ? w.jesterBreak : -w.jesterBreak;
  }

  // What the table said.
  if (talk) {
    const others = talk.filter(t => t && t.seat !== ctx.seat);
    if (o.kills && others.some(t => t.wantsRoyalDead)) score += w.rescue;
    if (!o.kills) {
      const next = nextSpeaker(ctx);
      if (next?.cannotDefend) score -= w.strand;
      if (tier === 'strong' && next?.canFinish && o.damage > 0) score += w.handoff;
    }
  }
  return score;
}

function nextSpeaker(ctx) {
  const { view, talk, seat } = ctx;
  if (view.players.length < 2) return null;
  return talk[(seat + 1) % view.players.length];
}

// ---- fallible play ---------------------------------------------------------
//
// A weaker citoyen is not a novice: they read the table, they know what the
// cards do, and most turns they play the move they meant to. An error rate is
// how often they don't — they reach for a lesser move instead of the best one
// on offer. Errors are drawn from the legal moves actually available, so a slip
// costs whatever a slip in that position happens to cost, which is sometimes
// nothing and occasionally the game.

function errs(opts) {
  return opts.errorRate > 0 && opts.rng && opts.rng() < opts.errorRate;
}

// Reach for something other than the best move on the table.
function slip(candidates, best, rng) {
  const others = candidates.filter(c => c !== best);
  if (!others.length) return best;
  return others[Math.floor(rng() * others.length)];
}

// Paying a blow without thinking: throw cards in as they come to hand until the
// damage is covered. Still legal, still survivable — just wasteful of whatever
// the hand happened to be holding.
function carelessPayment(hand, damage, rng) {
  if (damage <= 0) return [];
  const order = [...hand];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pile = [];
  let total = 0;
  for (const c of order) {
    if (total >= damage) break;
    pile.push(c);
    total += cardValue(c);
  }
  return total >= damage ? pile : null;
}

// ---- the decision ----------------------------------------------------------

// The quiet table: no remarks, no weighing, just the biggest blow that lands —
// but not one that leaves you unable to survive the reply.
function greedyPlay(view, hand) {
  let best = null;
  let bestKey = -Infinity;
  for (const cards of enumeratePlays(hand, { companion: view.rules.pamphleteerCompanion })) {
    const o = outcomeOf(view, cards);
    const rest = without(hand, o.cards);
    const survivable = o.kills || !!cheapestPayment(rest, o.counter);
    const key = (survivable ? 1000 : 0)
      + Math.min(o.damage, view.enemy.health - view.enemy.damage) * 10
      - o.spent;
    if (key > bestKey) { bestKey = key; best = cards; }
  }
  return best;
}

// The last resort: no action on the table avoids losing on the spot. Either the
// blow cannot be paid, or there is nothing to play and no duck left, or every
// attack available invites a reply this hand cannot survive.
export function inLastResort(view, hand) {
  if (view.phase === 'discard') return !cheapestPayment(hand, view.pendingDamage);
  if (hand.length === 0) return !view.canYield;
  if (view.canYield) return false;
  for (const cards of enumeratePlays(hand, { companion: view.rules.pamphleteerCompanion })) {
    const o = outcomeOf(view, cards);
    if (o.kills) return false;
    if (cheapestPayment(without(hand, cards), o.counter)) return false;
  }
  return true;
}

function forcedRegroup(view, hand) {
  return view.canRegroup && inLastResort(view, hand);
}

export function decide(view, hand, talk, opts = {}) {
  const tier = opts.tier ?? 'good';
  const w = opts.weights ?? BASE_WEIGHTS;
  const seat = view.you.index;
  // A motion that has just fallen is not put again on the same turn.
  const mayRegroup = view.canRegroup && opts.allowRegroup !== false;

  if (view.phase === 'jesterChoose') {
    return { type: 'chooseNext', target: chooseFloor(view, talk, seat, tier) };
  }

  if (view.phase === 'discard') {
    const pay = errs(opts)
      ? carelessPayment(hand, view.pendingDamage, opts.rng)
      : (tier === 'strong'
        ? optimalPayment(hand, view.pendingDamage)
        : (tier === 'decent' ? cheapestPayment(hand, view.pendingDamage)?.cards ?? null
          : choosePayment(hand, view.pendingDamage)));
    if (pay) return { type: 'discard', cards: pay };
    if (mayRegroup) return { type: 'regroup' };
    return { type: 'discard', cards: [...hand] }; // doomed, but the engine decides that
  }

  // phase 'play'
  if (mayRegroup && forcedRegroup(view, hand)) return { type: 'regroup' };
  if (hand.length === 0) {
    if (view.canYield) return { type: 'yield' };
    return { type: 'regroup' }; // the engine will reject it if none remain; loss follows
  }

  if (tier === 'decent') {
    // Even a quiet table ducks a blow it plainly cannot pay.
    if (view.canYield && !cheapestPayment(hand, view.enemy.effectiveAttack)) {
      return { type: 'yield' };
    }
    return { type: 'play', cards: greedyPlay(view, hand) };
  }

  const ctx = { view, hand, talk, w, tier, seat };
  const candidates = [];
  let best = null;
  let bestScore = -Infinity;
  for (const cards of enumeratePlays(hand, { companion: view.rules.pamphleteerCompanion })) {
    const o = outcomeOf(view, cards, seat);
    const score = scorePlay(ctx, o);
    const action = { type: 'play', cards };
    candidates.push(action);
    if (score > bestScore) { bestScore = score; best = action; }
  }


  // `noTacticalYield` is for the study only: it measures what Lay Low as a
  // deliberate duck is worth, by leaving it available only to an empty hand.
  if (view.canYield && !opts.noTacticalYield) {
    const action = { type: 'yield' };
    candidates.push(action);
    const score = scoreLayLow(ctx);
    if (score > bestScore) { bestScore = score; best = action; }
  }
  if (mayRegroup) {
    const action = { type: 'regroup' };
    const score = scoreRegroup(ctx);
    // A Regroup is never reached for by accident — it takes the table's assent,
    // and a citoyen who misplays a card does not misplay a motion.
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return errs(opts) ? slip(candidates, best, opts.rng) : best;
}

// A motion carries when the mover is visibly out of road, or when enough of the
// table is. The same read every citoyen can make, so l'Assemblée agrees with
// itself rather than putting the question again and again.
export function motionCarries(talk, caller, playerCount, w = BASE_WEIGHTS) {
  const mover = talk?.[caller];
  if (mover && (mover.cannotDefend || mover.handCount === 0)) return true;
  const inTrouble = (talk ?? []).filter(t => t && (t.cannotDefend || t.handCount === 0)).length;
  return w.regroupBase + w.regroupNeed * (inTrouble / playerCount) > 0;
}

function scoreLayLow(ctx) {
  const { view, hand, w } = ctx;
  const blow = view.enemy.effectiveAttack;
  let score = -w.stall;
  const payment = cheapestPayment(hand, blow);
  if (!payment) score += w.layLowRescue;          // a duck that saves the Revolution
  else score += w.payCost * (payment.value / 20); // ...or merely a blow not paid
  score += w.suits * distinctSuits(hand);
  return score;
}

function scoreRegroup(ctx) {
  const { view, talk, w } = ctx;
  const inTrouble = (talk ?? []).filter(t => t && (t.cannotDefend || t.handCount === 0)).length;
  const share = inTrouble / view.players.length;
  return w.regroupBase + w.regroupNeed * share;
}

// The Pamphleteer names who takes the floor: the citoyen who says they can end
// it, else the fullest hand that is not already in trouble.
function chooseFloor(view, talk, seat, tier) {
  let best = seat;
  let bestScore = -Infinity;
  for (let i = 0; i < view.players.length; i++) {
    const t = talk?.[i];
    let score = view.players[i].handCount;
    if (tier !== 'decent' && t) {
      if (t.canFinish) score += 40;
      if (t.strong) score += 20;
      if (t.cannotDefend) score -= 25;
    }
    if (i === seat) score -= 1; // all else equal, share the floor around
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
