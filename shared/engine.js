// Régicide 1789 — pure rules engine (rulebook-faithful Regicide).
// Runs identically in Node (server-authoritative multiplayer) and the browser (solo).
// Cards: { r, s } where r ∈ 2..10 | 'A' (Sans-Culotte) | 'J' | 'Q' | 'K' | 'X' (Pamphleteer, s=null)
// Suits: 'S' | 'H' | 'D' | 'C'

export const SUITS = ['S', 'H', 'D', 'C'];

const HAND_SIZE = { 1: 8, 2: 7, 3: 6, 4: 5 };
const JESTERS = { 1: 0, 2: 0, 3: 1, 4: 2 };
export const ENEMY_STATS = { J: { attack: 10, health: 20 }, Q: { attack: 15, health: 30 }, K: { attack: 20, health: 40 } };

export function cardValue(c) {
  if (c.r === 'X') return 0;
  if (c.r === 'A') return 1;
  if (c.r === 'J') return 10;
  if (c.r === 'Q') return 15;
  if (c.r === 'K') return 20;
  return c.r;
}

export function cardId(c) { return `${c.r}${c.s ?? ''}`; }
export function sameCard(a, b) { return a.r === b.r && a.s === b.s; }

function makeRng(seed) {
  // mulberry32 — deterministic when a numeric seed is given (tests), random otherwise
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(playerNames, opts = {}) {
  const n = playerNames.length;
  if (n < 1 || n > 4) throw new Error('1-4 players');
  const rng = makeRng(opts.seed ?? Math.floor(Math.random() * 2 ** 31));

  // Castle deck: shuffled Kings on the bottom, Queens on them, Jacks on top.
  // Top of any pile = end of array (pop to draw).
  const castle = [
    ...shuffle(SUITS.map(s => ({ r: 'K', s })), rng),
    ...shuffle(SUITS.map(s => ({ r: 'Q', s })), rng),
    ...shuffle(SUITS.map(s => ({ r: 'J', s })), rng),
  ];

  const tavern = [];
  for (const s of SUITS) {
    tavern.push({ r: 'A', s });
    for (let r = 2; r <= 10; r++) tavern.push({ r, s });
  }
  const jesters = n === 1 ? 0 : JESTERS[n];
  for (let i = 0; i < jesters; i++) tavern.push({ r: 'X', s: null });
  shuffle(tavern, rng);

  const state = {
    playerCount: n,
    handSize: HAND_SIZE[n],
    solo: n === 1,
    soloJesters: n === 1 ? 2 : 0,
    soloJestersUsed: 0,
    players: playerNames.map(name => ({ name, hand: [], yielded: false })),
    castle,
    tavern,
    discard: [],
    enemy: null,          // { card, damage, revealSeq, threatVariant, immunityCancelled }
    playedCombos: [],     // [{ cards, value, suits }] against current enemy
    current: 0,
    phase: 'play',        // 'play' | 'discard' | 'jesterChoose' | 'won' | 'lost'
    pendingDamage: 0,
    revealSeq: 0,
    actionSeq: 0,
    lastEffects: null,    // { healed, drawn } from the most recent play, for client animation
    log: [],
    lastEvent: null,      // { type: 'reveal'|'defeat', ... } for client animation
    result: null,         // on loss: { reason }; on win: { medal? }
    rngState: null,
  };
  state._rng = rng;

  for (const p of state.players) drawTo(state, p);
  revealEnemy(state);
  state.lastEvent = { type: 'reveal', seq: state.revealSeq };
  log(state, `The Revolution begins. ${n === 1 ? 'You stand alone, citoyen.' : `${n} citoyens take to the streets.`}`);
  return state;
}

function drawTo(state, player) {
  while (player.hand.length < state.handSize && state.tavern.length > 0) {
    player.hand.push(state.tavern.pop());
  }
}

function revealEnemy(state) {
  const card = state.castle.pop();
  state.revealSeq++;
  state.enemy = {
    card,
    damage: 0,
    immunityCancelled: false,
    revealSeq: state.revealSeq,
    threatVariant: Math.floor(state._rng() * 3),
  };
  state.playedCombos = [];
}

export function enemyAttack(state) { return ENEMY_STATS[state.enemy.card.r].attack; }
export function enemyHealth(state) { return ENEMY_STATS[state.enemy.card.r].health; }

// Spades shield is dynamic: vs a Spades enemy, spade plays only count once the
// Pamphleteer has cancelled immunity — including spades played BEFORE him.
export function currentShield(state) {
  if (!state.enemy) return 0;
  if (state.enemy.card.s === 'S' && !state.enemy.immunityCancelled) return 0;
  return state.playedCombos
    .filter(c => c.suits.includes('S'))
    .reduce((sum, c) => sum + c.value, 0);
}

export function effectiveEnemyAttack(state) {
  return Math.max(0, enemyAttack(state) - currentShield(state));
}

function handValue(player) {
  return player.hand.reduce((s, c) => s + cardValue(c), 0);
}

function removeFromHand(player, cards) {
  for (const c of cards) {
    const i = player.hand.findIndex(h => sameCard(h, c));
    if (i === -1) throw new Error('card not in hand');
    player.hand.splice(i, 1);
  }
}

function log(state, text) {
  state.log.push(text);
  if (state.log.length > 60) state.log.shift();
}

// ---- play validation -------------------------------------------------------

export function validatePlay(state, playerIdx, cards) {
  if (state.phase !== 'play') return 'It is not the moment to attack.';
  if (playerIdx !== state.current) return 'It is not your turn.';
  if (!cards.length) return 'Choose at least one card.';
  const hand = [...state.players[playerIdx].hand];
  for (const c of cards) {
    const i = hand.findIndex(h => sameCard(h, c));
    if (i === -1) return 'You do not hold that card.';
    hand.splice(i, 1);
  }
  const jesters = cards.filter(c => c.r === 'X').length;
  if (jesters > 0) {
    if (cards.length > 1) return 'The Pamphleteer works alone.';
    return null;
  }
  if (cards.length === 1) return null;
  const companions = cards.filter(c => c.r === 'A').length;
  if (companions > 0) {
    if (cards.length === 2) return null; // Sans-Culotte + any one non-jester card (or two Sans-Culottes)
    return 'A Sans-Culotte may join only one other card.';
  }
  // combo: 2-4 of the same numeric rank, total ≤ 10
  const r = cards[0].r;
  if (typeof r !== 'number') return 'Only numbered cards form a combo.';
  if (!cards.every(c => c.r === r)) return 'Combos must share the same number.';
  if (cards.length > 4) return 'At most four cards in a combo.';
  const total = cards.reduce((s, c) => s + cardValue(c), 0);
  if (total > 10) return 'A combo may total at most 10.';
  return null;
}

// Preview what a staged play will do (used by the client for live projections).
export function previewPlay(state, cards) {
  const value = cards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(cards.map(c => c.s).filter(Boolean))];
  const enemySuit = state.enemy.card.s;
  const cancelled = state.enemy.immunityCancelled;
  const active = s => s !== enemySuit || cancelled;
  const isJester = cards.some(c => c.r === 'X');
  const doubled = suits.includes('C') && active('C');
  return {
    value,
    damage: isJester ? 0 : (doubled ? value * 2 : value),
    doubled,
    heals: suits.includes('D') && active('D') ? Math.min(value, state.discard.length) : 0,
    draws: suits.includes('H') && active('H') ? Math.min(value, state.tavern.length) : 0,
    shieldAdd: suits.includes('S') && active('S') ? value : 0,
    immuneSuits: cancelled ? [] : suits.filter(s => s === enemySuit),
    isJester,
  };
}

// ---- turn actions ----------------------------------------------------------

export function playCards(state, playerIdx, cards) {
  const err = validatePlay(state, playerIdx, cards);
  if (err) throw new Error(err);
  const player = state.players[playerIdx];
  removeFromHand(player, cards);
  player.yielded = false;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;

  if (cards[0].r === 'X') {
    state.playedCombos.push({ cards, value: 0, suits: [] });
    state.enemy.immunityCancelled = true;
    state.phase = 'jesterChoose';
    log(state, `${player.name} unleashes the Pamphleteer — the enemy's immunity is shattered! ${player.name} chooses who acts next.`);
    return state;
  }

  const value = cards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(cards.map(c => c.s))];
  state.playedCombos.push({ cards, value, suits });

  const enemySuit = state.enemy.card.s;
  const active = s => s !== enemySuit || state.enemy.immunityCancelled;

  // Raid before Rally so recovered cards are safely under Le Peuple before
  // recruitment begins.
  if (suits.includes('D') && active('D')) {
    shuffle(state.discard, state._rng);
    const healed = state.discard.splice(0, Math.min(value, state.discard.length));
    state.tavern.unshift(...healed); // under the deck, no peeking
    state._lastHealed = healed.length;
    if (healed.length) log(state, `${player.name} raids la Prison — ${healed.length} of the Fallen return beneath Le Peuple.`);
  }
  if (suits.includes('H') && active('H')) {
    let toDraw = value;
    let i = playerIdx;
    let skips = 0;
    while (toDraw > 0 && state.tavern.length > 0 && skips < state.players.length) {
      const p = state.players[i % state.players.length];
      if (p.hand.length < state.handSize) {
        p.hand.push(state.tavern.pop());
        toDraw--;
        skips = 0;
      } else {
        skips++;
      }
      i++;
    }
    const drawn = value - toDraw;
    state._lastDrawn = drawn;
    if (drawn) log(state, `${player.name} rallies the people — the citoyens recruit ${drawn} card${drawn === 1 ? '' : 's'}.`);
  }

  const healedCount = state._lastHealed ?? 0;
  const drawnCount = state._lastDrawn ?? 0;
  if (healedCount || drawnCount) state.lastEffects = { healed: healedCount, drawn: drawnCount };
  state._lastHealed = state._lastDrawn = 0;

  const doubled = suits.includes('C') && active('C');
  const damage = doubled ? value * 2 : value;
  state.enemy.damage += damage;
  log(state, `${player.name} attacks for ${damage} damage${doubled ? ' (the mob doubles the blow!)' : ''}.`);
  if (suits.includes('S') && active('S')) {
    log(state, `Barricades rise — the enemy's attack is reduced by ${value}.`);
  }

  if (state.enemy.damage >= enemyHealth(state)) {
    defeatEnemy(state, playerIdx);
    return state;
  }
  beginSuffering(state, playerIdx);
  return state;
}

function defeatEnemy(state, playerIdx) {
  const exact = state.enemy.damage === enemyHealth(state);
  const enemyCard = state.enemy.card;
  if (exact) {
    state.tavern.push(enemyCard); // facedown on top — the royal is won to the Revolution
  } else {
    state.discard.push(enemyCard);
  }
  for (const combo of state.playedCombos) state.discard.push(...combo.cards);
  log(state, exact
    ? `${cardName(enemyCard)} falls with surgical precision — won to the Revolution! (top of Le Peuple)`
    : `${cardName(enemyCard)} is sent to the guillotine!`);

  if (state.castle.length === 0) {
    state.phase = 'won';
    state.enemy = null;
    if (state.solo) {
      const medals = ['Gold', 'Silver', 'Bronze'];
      state.result = { medal: medals[state.soloJestersUsed] ?? 'Bronze' };
    }
    state.lastEvent = { type: 'victory', exact, card: enemyCard };
    log(state, 'The last King is dead. Vive la République!');
    return;
  }
  revealEnemy(state);
  state.lastEvent = { type: 'defeatAndReveal', exact, seq: state.revealSeq, card: enemyCard };
  // Slayer skips Step 4 and opens a new turn against the newcomer.
  state.current = playerIdx;
  state.phase = 'play';
  checkTurnStart(state);
}

function beginSuffering(state, playerIdx) {
  const atk = effectiveEnemyAttack(state);
  if (atk === 0) {
    log(state, `The barricades hold — ${state.players[playerIdx].name} suffers nothing.`);
    advanceTurn(state);
    return;
  }
  const player = state.players[playerIdx];
  if (handValue(player) < atk) {
    state.phase = 'lost';
    state.result = { reason: `${player.name} could not withstand ${atk} damage. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
    return;
  }
  state.phase = 'discard';
  state.pendingDamage = atk;
  log(state, `${cardName(state.enemy.card)} strikes ${player.name} for ${atk}!`);
}

export function canYield(state, playerIdx) {
  if (state.phase !== 'play' || playerIdx !== state.current) return false;
  if (state.solo) return !state.players[0].yielded; // may not lie low twice in a row
  const others = state.players.filter((_, i) => i !== playerIdx);
  return !others.every(p => p.yielded);
}

export function yieldTurn(state, playerIdx) {
  if (state.phase !== 'play' || playerIdx !== state.current) throw new Error('It is not your turn.');
  if (!canYield(state, playerIdx)) throw new Error('You cannot lie low — every other citoyen already has.');
  const player = state.players[playerIdx];
  player.yielded = true;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  log(state, `${player.name} lies low.`);
  beginSuffering(state, playerIdx);
  return state;
}

export function validateDiscard(state, playerIdx, cards) {
  if (state.phase !== 'discard') return 'No damage to suffer.';
  if (playerIdx !== state.current) return 'It is not your turn.';
  const hand = [...state.players[playerIdx].hand];
  for (const c of cards) {
    const i = hand.findIndex(h => sameCard(h, c));
    if (i === -1) return 'You do not hold that card.';
    hand.splice(i, 1);
  }
  const total = cards.reduce((s, c) => s + cardValue(c), 0);
  if (total < state.pendingDamage) return `You must discard at least ${state.pendingDamage} in value.`;
  return null;
}

export function discardForDamage(state, playerIdx, cards) {
  const err = validateDiscard(state, playerIdx, cards);
  if (err) throw new Error(err);
  const player = state.players[playerIdx];
  removeFromHand(player, cards);
  state.discard.push(...cards);
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  log(state, `${player.name} sacrifices ${cards.length} card${cards.length === 1 ? '' : 's'} to survive.`);
  state.pendingDamage = 0;
  advanceTurn(state);
  return state;
}

export function surrenderGame(state, playerIdx) {
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('The game is already over.');
  const player = state.players[playerIdx];
  if (!player) throw new Error('Unknown citoyen.');
  state.phase = 'lost';
  state.pendingDamage = 0;
  state.lastEffects = null;
  state.actionSeq++;
  state.result = { reason: `${player.name} surrendered. The Revolution is over.` };
  state.lastEvent = { type: 'loss' };
  log(state, state.result.reason);
  return state;
}

export function chooseNext(state, playerIdx, targetIdx) {
  if (state.phase !== 'jesterChoose') throw new Error('No choice to make.');
  if (playerIdx !== state.current) throw new Error('Only the Pamphleteer’s player chooses.');
  if (targetIdx < 0 || targetIdx >= state.players.length) throw new Error('No such citoyen.');
  state.current = targetIdx;
  state.phase = 'play';
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  log(state, `${state.players[targetIdx].name} takes the floor.`);
  checkTurnStart(state);
  return state;
}

function advanceTurn(state) {
  state.current = (state.current + 1) % state.players.length;
  state.phase = 'play';
  checkTurnStart(state);
}

// Loss if the player to act can neither play a card nor lie low.
function checkTurnStart(state) {
  const p = state.players[state.current];
  if (p.hand.length === 0 && !canYield(state, state.current)) {
    if (state.solo && state.soloJesters > 0) return; // Regroup can still save them
    state.phase = 'lost';
    state.result = { reason: `${p.name} has no cards and cannot lie low. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
  }
}

// ---- solo: Regroup (flip a set-aside Pamphleteer) --------------------------
// Allowed at the start of Step 1 (phase 'play') or before taking damage
// (phase 'discard'). Does NOT cancel enemy immunity.
export function soloRegroup(state) {
  if (!state.solo) throw new Error('Solo only.');
  if (state.soloJesters <= 0) throw new Error('No Pamphleteers remain.');
  if (state.phase !== 'play' && state.phase !== 'discard') throw new Error('Not now.');
  const p = state.players[0];
  state.discard.push(...p.hand);
  p.hand = [];
  drawTo(state, p);
  state.soloJesters--;
  state.soloJestersUsed++;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  log(state, `Regroup! You discard everything and rally ${p.hand.length} fresh cards. (${state.soloJesters} left)`);
  if (state.phase === 'discard' && handValue(p) < state.pendingDamage) {
    state.phase = 'lost';
    state.result = { reason: `Even regrouped, you could not withstand ${state.pendingDamage} damage. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
  } else if (state.phase === 'play') {
    checkTurnStart(state);
  }
  return state;
}

function cardName(c) {
  const suits = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const ranks = { J: 'Jack', Q: 'Queen', K: 'King' };
  return `The ${ranks[c.r] ?? c.r} of ${suits[c.s] ?? ''}`;
}

// ---- serialization ---------------------------------------------------------

// Public view for a given player (or spectatorless full view when playerIdx == null, solo).
export function viewFor(state, playerIdx) {
  return {
    playerCount: state.playerCount,
    handSize: state.handSize,
    solo: state.solo,
    soloJesters: state.soloJesters,
    soloJestersUsed: state.soloJestersUsed,
    players: state.players.map((p, i) => ({
      name: p.name,
      handCount: p.hand.length,
      yielded: p.yielded,
      you: i === playerIdx,
    })),
    you: playerIdx != null ? { index: playerIdx, hand: state.players[playerIdx].hand } : null,
    castleCount: state.castle.length,
    tavernCount: state.tavern.length,
    discardCount: state.discard.length,
    discardTop: state.discard[state.discard.length - 1] ?? null,
    discardPile: state.discard, // face-up public pile
    enemy: state.enemy ? {
      card: state.enemy.card,
      damage: state.enemy.damage,
      health: enemyHealth(state),
      attack: enemyAttack(state),
      shield: currentShield(state),
      effectiveAttack: effectiveEnemyAttack(state),
      immunityCancelled: state.enemy.immunityCancelled,
      revealSeq: state.enemy.revealSeq,
      threatVariant: state.enemy.threatVariant,
    } : null,
    playedCombos: state.playedCombos.map(c => ({ cards: c.cards, value: c.value })),
    current: state.current,
    phase: state.phase,
    pendingDamage: state.pendingDamage,
    actionSeq: state.actionSeq,
    lastEffects: state.lastEffects,
    canYield: playerIdx != null ? canYield(state, playerIdx) : canYield(state, state.current),
    lastEvent: state.lastEvent,
    result: state.result,
  };
}
