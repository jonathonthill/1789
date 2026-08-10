// Plays a whole Revolution between simulated citoyens and reports how it ended.
//
// Every decision goes through viewFor(), so the bots see exactly what a real
// client sees — hand counts, the board, La Prison — plus whatever the table has
// said out loud. Nothing here hands a bot the state.

import {
  newGame, viewFor, playCards, discardForDamage, yieldTurn,
  regroup, usePamphleteer, callAssembly, callPamphleteerAssembly, castVote, surrenderGame,
} from '../../shared/engine.js';
import { decide, motionCarries, inLastResort, BASE_WEIGHTS } from './bot.js';
import { speak, mute } from './signals.js';
import { damageProfile } from './moves.js';

const NAMES = ['Danton', 'Robespierre', 'Marat', 'Desmoulins'];
const MAX_ACTIONS = 4000;

// The remarks the table can hear this instant. A citoyen playing quietly says
// nothing, but still hears whatever the others volunteer.
// One view serves for every speaker: a remark is derived from a citoyen's own
// hand and from the board, and the board looks the same from every seat.
function listen(state, view, seatTiers) {
  if (seatTiers.every(t => t === 'decent')) return mute(view);
  return state.players.map((p, i) => (
    seatTiers[i] === 'decent' ? mute(view)[i] : speak(view, p.hand, i)
  ));
}

// One tier for the whole table, or a seat-by-seat mix.
function seatsOf(tier, players) {
  if (Array.isArray(tier)) {
    return Array.from({ length: players }, (_, i) => tier[i % tier.length]);
  }
  return Array.from({ length: players }, () => tier);
}

// Every citoyen answers on the same public read of the table, so l'Assemblée
// agrees with itself instead of putting the same question twice.
function holdAssembly(state, caller, talk, weights) {
  const aye = motionCarries(talk, caller, state.players.length, weights);
  callAssembly(state, caller);
  let spins = 0;
  while (state.assembly && spins++ < 8) {
    const pending = state.assembly.voters.find(i => state.assembly.votes[i] === undefined);
    if (pending === undefined) break;
    castVote(state, pending, aye);
  }
  return state;
}

function unleashPamphleteer(state, caller) {
  if (state.solo) return usePamphleteer(state, caller);
  callPamphleteerAssembly(state, caller);
  let spins = 0;
  while (state.assembly && spins++ < 8) {
    const pending = state.assembly.voters.find(i => state.assembly.votes[i] === undefined);
    if (pending === undefined) break;
    castVote(state, pending, true);
  }
  return state;
}

export function wantsPamphleteer(view, hand, tier, rng, humanProfile = {}) {
  if (!view.canUsePamphleteer || !view.enemy || view.enemy.immunityCancelled) return false;
  const blocked = hand.filter(card => card.s === view.enemy.card.s);
  if (!blocked.length) return false;
  const strongest = Math.max(...blocked.map(card => typeof card.r === 'number' ? card.r : 1));
  const useful = strongest >= 5 || view.enemy.card.r === 'K';
  if (view.solo && view.enemy.card.s === 'C') {
    const before = damageProfile(view, hand);
    const after = damageProfile({
      ...view,
      enemy: { ...view.enemy, immunityCancelled: true },
    }, hand);
    // Against Clubs, timing is arithmetic: wait until doubling a known Club
    // play creates an exact finish, rather than spending the resource merely
    // because a large blocked Club happens to be in hand.
    if (before.hasExact) return false;
    return after.hasExact;
  }
  // Practiced humans still overlook or postpone a useful shared resource. The
  // reference bots retain their deterministic timing for regression studies.
  if (tier === 'human' && useful && rng && rng() < (humanProfile.pamphleteerMissRate ?? 0.15)) return false;
  return useful;
}

// A small deterministic stream for everything that is not the deal: which games
// seat a weaker citoyen, and which turns they misplay. Kept separate from the
// engine's own rng so the cards a table is dealt do not change when the study
// varies how fallible the table is.
function tableRng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return function () {
    a |= 0; a = (a + 0x9E3779B9) | 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21F0AAAD);
    t = Math.imul(t ^ (t >>> 15), 0x735A2D97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export function playGame({
  players, rules, seed, tier = 'good', weights = BASE_WEIGHTS, noTacticalYield = false,
  // What share of games seat one citoyen who misplays, and how often they do.
  weakFraction = 0, errorRate = 0, humanProfile = {},
} = {}) {
  const seatTiers = seatsOf(tier, players);
  const rng = tableRng(seed);
  // Decided once, before a card is dealt: is one of tonight's citoyens off form,
  // and which seat are they in?
  const weakSeat = weakFraction > 0 && rng() < weakFraction
    ? Math.floor(rng() * players)
    : -1;
  const errorFor = i => (i === weakSeat ? errorRate : 0);
  // An 'average' citoyen plays exactly as a good one does — hears the table,
  // weighs every legal action — but judges by hand-reasoned instinct instead of
  // the fitted weights. Right ideas, imperfect priorities.
  const weightsFor = t => (t === 'average' || t === 'human' ? BASE_WEIGHTS : weights);
  const policyFor = t => (t === 'average' ? 'good' : t);
  const state = newGame(NAMES.slice(0, players), { seed, rules });
  let actions = 0;
  let regroupsForced = 0;
  let regroupsChosen = 0;
  let blocked = -1; // seat whose motion has just fallen
  let layLows = 0;
  let exactKills = 0;
  let blowsPaid = 0;
  let damagePaid = 0;
  const plannedCards = Array.from({ length: players }, () => null);

  while (state.phase !== 'won' && state.phase !== 'lost') {
    if (++actions > MAX_ACTIONS) { surrenderGame(state, 0); break; }
    const seat = state.current;
    const view = viewFor(state, seat);
    const talk = listen(state, view, seatTiers);
    const hand = state.players[seat].hand;

    // Pamphleteers are a free shared action, so decide on one before selecting
    // the attack that still follows on this same turn.
    if (state.phase === 'play' && wantsPamphleteer(view, hand, seatTiers[seat], rng, humanProfile)) {
      try { unleashPamphleteer(state, seat); } catch { surrenderGame(state, seat); }
      continue;
    }

    let action;
    try {
      action = decide(view, hand, talk, {
        ...humanProfile,
        tier: policyFor(seatTiers[seat]),
        weights: weightsFor(seatTiers[seat]),
        noTacticalYield,
        allowRegroup: blocked !== seat,
        errorRate: errorFor(seat),
        rng,
        plannedCards: plannedCards[seat],
      });
    } catch {
      surrenderGame(state, seat);
      break;
    }

    try {
      if (action.type === 'play') {
        playCards(state, seat, action.cards);
        plannedCards[seat] = action.plannedCards ?? null;
        if (state.lastEvent?.exact) exactKills++;
      } else if (action.type === 'discard') {
        blowsPaid++;
        damagePaid += view.pendingDamage;
        discardForDamage(state, seat, action.cards);
      } else if (action.type === 'yield') {
        layLows++;
        yieldTurn(state, seat);
      } else if (action.type === 'regroup') {
        // Was this the last thing standing between the table and defeat?
        const forced = inLastResort(view, hand);
        const before = state.regroupsUsed;
        if (state.solo) regroup(state, seat);
        else holdAssembly(state, seat, talk, weightsFor(seatTiers[seat]));
        if (state.regroupsUsed > before) {
          plannedCards.fill(null);
          if (forced) regroupsForced++; else regroupsChosen++;
          blocked = -1;
        } else if (forced) {
          surrenderGame(state, seat); // the motion was the last road out
        } else {
          blocked = seat;             // asked and refused; act on your own hand
        }
      } else {
        surrenderGame(state, seat);
      }
    } catch {
      // An illegal move means the citoyen had nothing legal left.
      surrenderGame(state, seat);
    }
  }

  return {
    won: state.phase === 'won',
    royalsFelled: 12 - state.castle.length - (state.enemy ? 1 : 0),
    regroupsUsed: state.regroupsUsed,
    regroupsForced,
    regroupsChosen,
    layLows,
    exactKills,
    blowsPaid,
    damagePaid,
    actions,
  };
}

// A batch of games on one ruleset, reported as a win rate and the extras the
// report needs to sanity-check how the bots behaved.
export function runBatch({ players, rules, seeds, tier = 'good', weights = BASE_WEIGHTS, noTacticalYield = false, weakFraction = 0, errorRate = 0, humanProfile = {} }) {
  const total = { wins: 0, royalsFelled: 0, regroupsUsed: 0, regroupsChosen: 0, layLows: 0, exactKills: 0, blowsPaid: 0, damagePaid: 0 };
  for (const seed of seeds) {
    const r = playGame({ players, rules, seed, tier, weights, noTacticalYield, weakFraction, errorRate, humanProfile });
    if (r.won) total.wins++;
    for (const k of ['royalsFelled', 'regroupsUsed', 'regroupsChosen', 'layLows', 'exactKills', 'blowsPaid', 'damagePaid']) {
      total[k] += r[k];
    }
  }
  const n = seeds.length;
  return {
    games: n,
    wins: total.wins,
    winRate: total.wins / n,
    avgRoyals: total.royalsFelled / n,
    avgRegroups: total.regroupsUsed / n,
    avgLayLows: total.layLows / n,
    avgExactKills: total.exactKills / n,
    avgBlowsPaid: total.blowsPaid / n,
    avgDamagePaid: total.damagePaid / n,
    discretionaryShare: total.regroupsUsed ? total.regroupsChosen / total.regroupsUsed : 0,
  };
}
