// Every attack a hand can make, and what each one would do — worked out from a
// citoyen's own view of the table, never from the hidden state. This is the only
// place the simulated players are allowed to reason about consequences, which is
// what guarantees they cannot peek at anyone else's cards.

import { cardValue } from '../../shared/engine.js';

const AVG_PEUPLE_CARD = 5.3; // mean value of an unseen card, for weighing a draw

// Combinations of k items, by index.
function combos(arr, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

// Every legal attack: singles, a Sans-Culotte with one partner, same-rank combos
// capped at 20, and the Pamphleteer — alone, or with one companion when the
// rules allow him one.
export function enumeratePlays(hand, { companion = false } = {}) {
  const plays = [];
  for (const c of hand) plays.push([c]);

  if (companion) {
    const jester = hand.find(c => c.r === 'X');
    if (jester) {
      for (const partner of hand) {
        if (partner.r === 'X') continue;
        plays.push([jester, partner]);
      }
    }
  }

  const aces = hand.filter(c => c.r === 'A');
  if (aces.length) {
    for (let i = 0; i < hand.length; i++) {
      const partner = hand[i];
      if (partner.r === 'X') continue;
      for (const a of aces) {
        if (a === partner) continue;
        plays.push([a, partner]);
      }
    }
  }

  const byRank = new Map();
  for (const c of hand) {
    if (typeof c.r !== 'number') continue;
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }
  for (const [rank, cards] of byRank) {
    for (let k = 2; k <= Math.min(4, cards.length); k++) {
      if (rank * k > 20) break;
      for (const set of combos(cards, k)) plays.push(set);
    }
  }
  return plays;
}

// Everything a hand could do to the royal this turn, without building the plays.
// Signals are read for every citoyen after every action, so this stays cheap:
// it collects the achievable damage totals and answers from that set alone.
export function damageProfile(view, hand) {
  const enemy = view.enemy;
  const clubDoubles = enemy.immunityCancelled || enemy.card.s !== 'C';
  const remaining = enemy.health - enemy.damage;
  let best = 0;
  let canFinish = false;
  let hasExact = false;

  const note = (value, withClub) => {
    const d = withClub && clubDoubles ? value * 2 : value;
    if (d > best) best = d;
    if (d >= remaining) canFinish = true;
    if (d === remaining) hasExact = true;
  };

  const aces = hand.filter(c => c.r === 'A');
  const rankCount = new Map();
  const rankHasClub = new Set();
  // A companion arrives after the Pamphleteer has broken immunity, so its
  // suit power lands even on a royal of its own suit — a clubs companion always
  // doubles.
  const withJester = view.rules.pamphleteerCompanion && hand.some(c => c.r === 'X');

  for (const c of hand) {
    note(cardValue(c), c.s === 'C');
    if (withJester && c.r !== 'X') {
      const value = cardValue(c) + cardValue({ r: 'X' });
      const d = c.s === 'C' ? value * 2 : value;
      if (d > best) best = d;
      if (d >= remaining) canFinish = true;
      if (d === remaining) hasExact = true;
    }
    if (typeof c.r === 'number') {
      rankCount.set(c.r, (rankCount.get(c.r) ?? 0) + 1);
      if (c.s === 'C') rankHasClub.add(c.r);
    }
  }

  if (aces.length) {
    const aceClub = aces.some(c => c.s === 'C');
    for (const partner of hand) {
      if (partner.r === 'X' || (partner.r === 'A' && aces.length < 2)) continue;
      if (partner === aces[0] && aces.length < 2) continue;
      note(cardValue(partner) + cardValue(aces[0]), aceClub || partner.s === 'C');
    }
  }

  for (const [rank, count] of rankCount) {
    for (let k = 2; k <= Math.min(4, count); k++) {
      const value = rank * k;
      if (value > 20) break;
      // The suits in a combo are the player's to choose, so both a clubless
      // combo and a doubled one are on the table when the cards allow it.
      if (rankHasClub.has(rank)) note(value, true);
      if (count - (rankHasClub.has(rank) ? 1 : 0) >= k) note(value, false);
    }
  }
  return { best, canFinish, hasExact };
}

// Spade value already committed against this royal — what starts counting the
// moment a Pamphleteer breaks a spade royal's immunity.
function committedSpades(view) {
  let total = 0;
  for (const combo of view.playedCombos) {
    let value = 0;
    let spade = false;
    for (const c of combo.cards) {
      value += cardValue(c);
      if (c.s === 'S') spade = true;
    }
    if (spade) total += value;
  }
  return total;
}

// How a Rally spreads round the table, given only the public hand counts.
function distributeDraws(view, total, seat, spent, holdSlot) {
  const counts = view.players.map(p => p.handCount);
  counts[seat] -= spent;
  const cap = i => view.handSize - (holdSlot && i === seat ? 1 : 0);
  let mine = 0;
  let team = 0;
  let left = total;
  let i = seat;
  let skips = 0;
  while (left > 0 && skips < counts.length) {
    const idx = i % counts.length;
    if (counts[idx] < cap(idx)) {
      counts[idx]++;
      if (idx === seat) mine++; else team++;
      left--;
      skips = 0;
    } else skips++;
    i++;
  }
  return { mine, team };
}

// What playing these cards would do, as far as the player can know it.
export function outcomeOf(view, cards, seat = view.you?.index ?? view.current) {
  const enemy = view.enemy;
  const isJester = cards.some(c => c.r === 'X');
  const enemySuit = enemy.card.s;
  const cancelled = enemy.immunityCancelled || isJester;

  let value = 0;
  const suits = new Set();
  for (const c of cards) {
    value += cardValue(c);
    if (c.s) suits.add(c.s);
  }
  const active = s => suits.has(s) && (s !== enemySuit || cancelled);

  const doubled = active('C');
  const damage = doubled ? value * 2 : value;
  const remaining = enemy.health - enemy.damage;
  const kills = damage >= remaining;
  const exact = damage === remaining;
  const overkill = Math.max(0, damage - remaining);

  const heals = active('D') ? Math.min(value, view.discardCount) : 0;

  // An exact kill claimed into the hand keeps a slot open for the royal.
  const holdSlot = exact && view.rules.exactKillTo === 'hand';
  const drawTotal = active('H') ? Math.min(value, view.tavernCount) : 0;
  const draws = distributeDraws(view, drawTotal, seat, cards.length, holdSlot);

  let shieldAfter;
  if (isJester && enemySuit === 'S' && !enemy.immunityCancelled) {
    shieldAfter = committedSpades(view); // his broadside makes every spade count at last
  } else {
    shieldAfter = enemy.shield + (active('S') ? value : 0);
  }
  const protectedFromBlow = kills || (isJester && view.rules.pamphleteerImmune);
  const counter = protectedFromBlow ? 0 : Math.max(0, enemy.attack - shieldAfter);

  return {
    cards, value, damage, doubled, kills, exact, overkill, heals, counter,
    isJester,
    drawsMine: draws.mine,
    drawsTeam: draws.team,
    shieldAfter,
    // Cards the play costs and what it leaves behind, for the evaluator.
    spent: cards.length,
    spentValue: value,
    // Cards drawn are unknown, so they are weighed at the average of Le Peuple.
    drawnValue: draws.mine * AVG_PEUPLE_CARD,
  };
}

export { AVG_PEUPLE_CARD };
