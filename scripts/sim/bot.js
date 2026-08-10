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
//   'human'  — a bounded, fallible search meant to resemble practiced solo play

import { cardValue } from '../../shared/engine.js';
import { enumeratePlays, outcomeOf, damageProfile } from './moves.js';
import { cheapestPayment, handValue } from './signals.js';

// Starting weights for the weighted tiers. tune.js optimizes the strong tier
// from here against the rules currently shipped.
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
  heal: 0.8,         // Raid — prisoners back into shuffled Le Peuple, the deck's life
  shield: 6,         // barricades still standing when the blow comes
  payCost: 10,       // what surviving the counterattack costs
  death: 500,        // a move that cannot be survived
  jesterBreak: 10,   // breaking an immunity that is actually in the way
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
// precious, Les Renforts pairs with anything, and a lone suit is a power the
// table may need.
function keepScore(card, hand, preserve = []) {
  if (card.r === 'X') return 100;
  let score = cardValue(card) * 0.5;
  if (preserve?.includes(card)) score += 30;
  if (card.r === 'A') score += 4;
  const sameSuit = hand.filter(c => c.s === card.s).length;
  if (sameSuit === 1) score += 3;
  const sameRank = hand.filter(c => c.r === card.r).length;
  if (sameRank >= 2 && typeof card.r === 'number') score += 2;
  return score;
}

// Give up the least useful cards that still cover the blow, then hand back
// anything the pile turns out not to need.
export function choosePayment(hand, damage, preserve = []) {
  if (damage <= 0) return [];
  preserve ??= [];
  const order = [...hand].sort((a, b) => keepScore(a, hand, preserve) - keepScore(b, hand, preserve));
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
      .sort((a, b) => keepScore(b, hand, preserve) - keepScore(a, hand, preserve))[0];
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
export function optimalPayment(hand, damage, preserve = []) {
  if (damage <= 0) return [];
  if (hand.length > 14) return choosePayment(hand, damage);
  let best = null;
  let bestCost = Infinity;
  const n = hand.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let total = 0;
    let cost = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { total += cardValue(hand[i]); cost += keepScore(hand[i], hand, preserve); }
    }
    if (total >= damage && cost < bestCost) {
      bestCost = cost;
      best = mask;
    }
  }
  if (best === null) return null;
  return hand.filter((_, i) => best & (1 << i));
}

const isRoyal = card => ['J', 'Q', 'K'].includes(card.r);

// Solo can plan around every card it holds. Hearts are the long-term engine and
// captured Club/Spade royals are the strongest two-card stacking pieces, so a
// careful player gives them up only when the current royal makes that sensible.
function soloPreserve(view, hand, planned = []) {
  if (!view.solo) return planned;
  const keep = new Set(planned);
  for (const card of hand) {
    if (card.s === 'H' && view.enemy.card.s !== 'H') keep.add(card);
    if (isRoyal(card) && (card.s === 'C' || card.s === 'S')) keep.add(card);
  }
  return [...keep];
}

// ---- scoring an action -----------------------------------------------------

function scorePlay(ctx, o) {
  const { view, hand, talk, w, tier } = ctx;
  const enemy = view.enemy;
  const remaining = enemy.health - enemy.damage;
  let score = 0;

  if (o.kills) {
    score += w.kill;
    if (o.exact && ctx.recognizeExact !== false) {
      score += view.rules.exactKillTo === 'hand' ? w.exactHand : w.exactPeuple;
      // Captured Clubs can one-shot a same-tier Spade royal; captured Spades can
      // then erase much of the following royal's strike. Value that chain before
      // the next royal is known, without pretending to peek at the Régime.
      if (view.solo && view.rules.exactKillTo === 'hand') {
        if (enemy.card.s === 'C') score += w.captureClub ?? w.exactHand * 0.35;
        if (enemy.card.s === 'S') score += w.captureSpade ?? w.exactHand * 0.25;
      }
    }
  } else {
    score += w.damage * (o.damage / remaining);
    // Solo players can deliberately leave a number they already know how to
    // finish exactly on their following turn. The reward is discounted because
    // the plan still has to survive a counterattack and an intervening payment.
    if (o.plannedExact) score += w.exactSetup ?? w.exactHand * 0.85;
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
    const paymentCards = view.solo
      ? optimalPayment(rest, o.counter, soloPreserve(view, rest, o.plannedCards))
      : null;
    const payment = view.solo
      ? (paymentCards && {
        cards: paymentCards,
        value: paymentCards.reduce((sum, card) => sum + cardValue(card), 0),
      })
      : cheapestPayment(rest, o.counter);
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

function humanAttackSlip(opts) {
  return opts.tier === 'human'
    && opts.rng
    && opts.rng() < (opts.attackErrorRate ?? 0.10);
}

// Reach for something other than the best move on the table.
function slip(candidates, best, rng) {
  const others = candidates.filter(c => c !== best);
  if (!others.length) return best;
  return others[Math.floor(rng() * others.length)];
}

// A practiced player does not normally enumerate every legal subset in their
// hand. They notice a few salient lines — the biggest hit, an obvious Rally or
// barricade, and occasionally an exact finish — then compare those. Keep this
// separate from the generic error model: overlooking a line is not the same as
// deliberately reaching for a random legal move.
function exactNextTurnFromKnownCards(view, hand, outcome, seat) {
  if (!view.solo || outcome.kills) return null;
  const afterAttack = without(hand, outcome.cards);
  // Plan around the sacrifice this policy would normally prefer. Rally cards
  // are deliberately excluded: their identities are not known yet.
  const payment = choosePayment(afterAttack, outcome.counter);
  if (!payment) return null;
  const knownNextHand = without(afterAttack, payment);
  if (!knownNextHand.length) return null;

  const nextView = {
    ...view,
    enemy: {
      ...view.enemy,
      damage: view.enemy.damage + outcome.damage,
      shield: outcome.shieldAfter,
      effectiveAttack: Math.max(0, view.enemy.attack - outcome.shieldAfter),
    },
    players: view.players.map((p, i) => (
      i === seat ? { ...p, handCount: knownNextHand.length } : p
    )),
  };
  const exacts = enumeratePlays(knownNextHand, { companion: view.rules.pamphleteerCompanion })
    .filter(cards => outcomeOf(nextView, cards, seat).exact);
  return exacts.reduce((best, cards) => (
    !best || cards.length < best.length ? cards : best
  ), null);
}

function sameCards(a, b) {
  return a.length === b.length && a.every(card => b.includes(card));
}

// Search only cards the solo player can actually see. Unknown Rally draws are
// never sampled. With a dead strike this reaches three attacks deep, allowing
// the common barricade -> small setup -> exact finish line without cheating.
function knownExactPlan(view, hand, seat, maxTurns) {
  let best = null;

  function visit(currentView, currentHand, turnsLeft, steps, cost) {
    for (const cards of enumeratePlays(currentHand, { companion: currentView.rules.pamphleteerCompanion })) {
      const outcome = outcomeOf(currentView, cards, seat);
      const attackCost = cards.reduce((sum, card) => sum + cardValue(card), 0);
      const nextCost = cost + attackCost + cards.length * 0.5;
      if (outcome.exact) {
        const candidate = { steps: [...steps, { cards, outcome }], cost: nextCost };
        if (!best || candidate.cost < best.cost
          || (candidate.cost === best.cost && candidate.steps.length < best.steps.length)) best = candidate;
        continue;
      }
      if (outcome.kills || turnsLeft <= 1 || outcome.drawsMine > 0) continue;

      const afterAttack = without(currentHand, cards);
      const payment = optimalPayment(afterAttack, outcome.counter, soloPreserve(currentView, afterAttack));
      if (!payment) continue;
      const nextHand = without(afterAttack, payment);
      if (!nextHand.length) continue;
      const nextView = {
        ...currentView,
        enemy: {
          ...currentView.enemy,
          damage: currentView.enemy.damage + outcome.damage,
          shield: outcome.shieldAfter,
          effectiveAttack: Math.max(0, currentView.enemy.attack - outcome.shieldAfter),
        },
        players: currentView.players.map((player, i) => (
          i === seat ? { ...player, handCount: nextHand.length } : player
        )),
      };
      const paymentCost = payment.reduce((sum, card) => sum + cardValue(card), 0);
      visit(nextView, nextHand, turnsLeft - 1, [...steps, { cards, outcome }], nextCost + paymentCost * 1.5);
    }
  }

  visit(view, hand, maxTurns, [], 0);
  return best;
}

function humanShortlist(view, hand, plays, seat, rng, opts) {
  const outcomes = plays.map(cards => ({ cards, o: outcomeOf(view, cards, seat), recognizedExact: false }));
  const picked = [];
  const add = entry => {
    if (entry && !picked.some(p => p.cards === entry.cards)) picked.push(entry);
  };
  const bestBy = fn => outcomes.reduce((best, entry) => (
    !best || fn(entry.o) > fn(best.o) ? entry : best
  ), null);

  // These are the lines players tend to see without exhaustively searching.
  add(bestBy(o => o.damage));
  add(bestBy(o => o.drawsMine * 10 - o.spent));
  add(bestBy(o => o.shieldAfter * 10 - o.spent));
  add(bestBy(o => -o.spentValue - o.spent));

  // Carry through a plan made on the preceding turn. The same card objects are
  // still in the hand, so this does not reveal anything the player did not know.
  if (opts.plannedCards?.length) {
    const intended = outcomes.find(entry => (
      entry.o.exact
      && entry.cards.length === opts.plannedCards.length
      && entry.cards.every(card => opts.plannedCards.includes(card))
    ));
    if (intended) intended.recognizedExact = true;
    add(intended);
  }

  // Planning is intentionally solo-only. It uses the hand after the likely
  // sacrifice and never samples or peeks at cards that Rally might draw.
  const planRecognition = opts.planRecognition ?? 0.65;
  if (view.solo && rng && rng() < planRecognition) {
    for (const entry of outcomes) {
      entry.o.plannedCards = exactNextTurnFromKnownCards(view, hand, entry.o, seat);
      entry.o.plannedExact = !!entry.o.plannedCards;
    }
    const setups = outcomes.filter(x => x.o.plannedExact);
    add(setups.reduce((best, entry) => (
      !best
      || entry.o.spentValue + entry.o.overkill < best.o.spentValue + best.o.overkill
        ? entry : best
    ), null));
  }

  // Exact arithmetic is noticed some of the time, not on every hand. When it
  // is noticed, prefer the least expensive clean finish.
  const exactRecognition = opts.exactRecognition ?? 0.55;
  if (rng && rng() < exactRecognition) {
    const exacts = outcomes.filter(x => x.o.exact);
    const noticed = exacts.reduce((best, entry) => (
      !best || entry.o.spentValue < best.o.spentValue ? entry : best
    ), null);
    if (noticed) noticed.recognizedExact = true;
    add(noticed);
  }

  // A couple of less-obvious candidates represent ordinary table scanning.
  const budget = Math.max(4, opts.candidateBudget ?? 6);
  const remaining = outcomes.filter(x => !picked.includes(x));
  while (picked.length < budget && remaining.length) {
    const i = rng ? Math.floor(rng() * remaining.length) : 0;
    add(remaining.splice(i, 1)[0]);
  }
  return picked;
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

  if (view.phase === 'discard') {
    const paymentSlip = tier === 'human'
      && opts.rng
      && opts.rng() < (opts.paymentErrorRate ?? 0.08);
    const pay = errs(opts) || paymentSlip
      ? carelessPayment(hand, view.pendingDamage, opts.rng)
        : (tier === 'strong'
        ? optimalPayment(hand, view.pendingDamage, soloPreserve(view, hand, opts.plannedCards))
        : (tier === 'decent' ? cheapestPayment(hand, view.pendingDamage)?.cards ?? null
          : choosePayment(hand, view.pendingDamage, tier === 'human' ? opts.plannedCards : [])));
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
  const plays = enumeratePlays(hand, { companion: view.rules.pamphleteerCompanion });
  const soloPlan = tier === 'strong' && view.solo
    ? knownExactPlan(view, hand, seat, view.enemy.effectiveAttack === 0 ? 3 : 2)
    : null;
  const considered = tier === 'human'
    ? humanShortlist(view, hand, plays, seat, opts.rng, opts)
    : plays.map(cards => {
      const o = outcomeOf(view, cards, seat);
      if (soloPlan?.steps.length > 1 && sameCards(cards, soloPlan.steps[0].cards)) {
        o.plannedExact = true;
        o.plannedCards = soloPlan.steps[1].cards;
      }
      return { cards, o };
    });
  for (const { cards, o, recognizedExact = true } of considered) {
    const score = scorePlay({ ...ctx, recognizeExact: tier !== 'human' || recognizedExact }, o);
    const action = { type: 'play', cards };
    if (o.plannedCards?.length) action.plannedCards = o.plannedCards;
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
  return (errs(opts) || humanAttackSlip(opts)) ? slip(candidates, best, opts.rng) : best;
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
  const { view, hand, talk, w, seat } = ctx;
  const lastOfTier = (view.enemy.card.r === 'J' && view.castleCount === 8)
    || (view.enemy.card.r === 'Q' && view.castleCount === 4);
  if (view.solo && lastOfTier) {
    const exactReady = damageProfile(view, hand).hasExact;
    const missing = Math.max(0, view.handSize - hand.length);
    // It refreshes after this royal, so an unspent card has no carry value. Use
    // it to repair a depleted/weak hand, but never throw away a clean capture.
    if (!exactReady && (missing > 0 || handValue(hand) < view.handSize * 5)) {
      return 100 + missing * 20 + (seat === view.current ? 1 : 0);
    }
  }
  const inTrouble = (talk ?? []).filter(t => t && (t.cannotDefend || t.handCount === 0)).length;
  const share = inTrouble / view.players.length;
  return w.regroupBase + w.regroupNeed * share;
}
