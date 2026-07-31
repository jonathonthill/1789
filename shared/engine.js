// Régicide 1789 — pure rules engine (rulebook-faithful Regicide).
// Runs identically in Node (server-authoritative multiplayer) and the browser (solo).
// Cards: { r, s } where r ∈ 2..10 | 'A' (Les Renforts) | 'J' | 'Q' | 'K' | 'X' (Pamphleteer, s=null)
// Suits: 'S' | 'H' | 'D' | 'C'

export const SUITS = ['S', 'H', 'D', 'C'];

// La Constitution's rules live in one register, shared/rules.js — see there for
// what each one means and which ones the menu currently offers. The turn always
// passes to the next citoyen once a royal falls.
import { HAND_SIZE, DEFAULT_RULES, resolveRules, rulebookFor } from './rules.js';
export { DEFAULT_RULES, resolveRules, rulebookFor };
export { RULE_SPEC, RULE_KEYS, EXPOSED_RULE_KEYS } from './rules.js';

export const ENEMY_STATS = { J: { attack: 10, health: 20 }, Q: { attack: 15, health: 30 }, K: { attack: 20, health: 40 } };

export function cardValue(c) {
  if (c.r === 'X') return 1;
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
  const rules = resolveRules(opts.rules, n);

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
  for (let i = 0; i < rules.pamphleteers; i++) tavern.push({ r: 'X', s: null });
  shuffle(tavern, rng);

  const state = {
    playerCount: n,
    rules,
    handSize: Math.max(1, HAND_SIZE[n] + rules.handSizeDelta),
    solo: n === 1,
    regroupsRemaining: rules.regroups, // one pool, spent by whoever l'Assemblée backs
    regroupsUsed: 0,
    assembly: null,       // open motion: { caller, voters, votes }
    players: playerNames.map(name => ({
      name,
      hand: [],
      laidLow: false,     // has spent their one Lay Low against the royal on the table
    })),
    castle,
    tavern,
    discard: [],
    enemy: null,          // { card, damage, revealSeq, threatVariant, immunityCancelled }
    playedCombos: [],     // [{ cards, value, suits }] against current enemy
    current: 0,
    phase: 'play',        // 'play' | 'discard' | 'won' | 'lost'
    pendingDamage: 0,
    // Set when a blow interrupts something that must still happen once it is
    revealSeq: 0,
    actionSeq: 0,
    lastEffects: null,    // { healed, drawn } from the most recent play, for client animation
    lastPlay: null,       // { playerIdx, cards, healthBefore/After, attackBefore/After } — client animation
    lastSacrifice: null,  // { playerIdx, cards } from the most recent discard-for-damage — client animation
    log: [],
    lastEvent: null,      // { type: 'reveal'|'defeat', ... } for client animation
    result: null,         // on loss: { reason }
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
  // Each citoyen may duck one royal in a fight; a new royal restores the right.
  for (const p of state.players) p.laidLow = false;
}

export function enemyAttack(state) {
  return Math.max(0, ENEMY_STATS[state.enemy.card.r].attack + state.rules.royalStrikeBonus);
}
export function enemyHealth(state) { return ENEMY_STATS[state.enemy.card.r].health; }

// Spades shield is dynamic: vs a Spades enemy, spade plays only count once the
// Pamphleteer has broken immunity — including spades played BEFORE him.
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

function regroupsLeft(state) {
  return state.regroupsRemaining;
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
  if (state.assembly) return 'l’Assemblée is in session.';
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
    if (jesters > 1) return 'Only one Pamphleteer may take the floor.';
    if (cards.length === 1) return null;
    if (!state.rules.pamphleteerCompanion) return 'The Pamphleteer works alone.';
    if (cards.length === 2) return null; // the Pamphleteer and one other voice
    return 'The Pamphleteer may bring only one companion.';
  }
  if (cards.length === 1) return null;
  const companions = cards.filter(c => c.r === 'A').length;
  if (companions > 0) {
    if (cards.length === 2) return null; // Les Renforts + any one card (or two Renforts)
    return 'Les Renforts may join only one other card.';
  }
  // Combo: 2-4 of the same numeric rank, with a combined value of at most 20.
  const r = cards[0].r;
  if (typeof r !== 'number') return 'Only numbered cards form a combo.';
  if (!cards.every(c => c.r === r)) return 'Combos must share the same number.';
  if (cards.length > 4) return 'At most four numbered cards may form a combo.';
  const total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  if (total > 20) return 'A combo may total at most 20.';
  return null;
}

// Preview what a staged play will do (used by the client for live projections).
export function previewPlay(state, cards) {
  const isJester = cards.some(c => c.r === 'X');
  const value = cards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(cards.map(c => c.s).filter(Boolean))];
  const enemySuit = state.enemy.card.s;
  // A Pamphleteer in the play breaks immunity before its partner resolves,
  // so the partner's power counts even against the enemy's own suit.
  const cancelled = state.enemy.immunityCancelled || isJester;
  const active = s => s !== enemySuit || cancelled;
  const doubled = suits.includes('C') && active('C');
  const damage = doubled ? value * 2 : value;
  const exactKill = state.enemy.damage + damage === enemyHealth(state);
  return {
    value,
    damage,
    doubled,
    heals: suits.includes('D') && active('D') ? Math.min(value, state.discard.length) : 0,
    draws: suits.includes('H') && active('H') ? Math.min(value, state.tavern.length) : 0,
    shieldAdd: suits.includes('S') && active('S') ? value : 0,
    immuneSuits: cancelled ? [] : suits.filter(s => s === enemySuit),
    isJester,
    // Warn before committing: an exact kill claims the royal for your own hand.
    exactKill,
  };
}

// ---- turn actions ----------------------------------------------------------

export function playCards(state, playerIdx, cards) {
  const err = validatePlay(state, playerIdx, cards);
  if (err) throw new Error(err);
  const player = state.players[playerIdx];
  // Snapshot before this combo's effects land, so the client can animate the
  // health/strike bars draining from the old value to the new one.
  const healthBefore = Math.max(0, enemyHealth(state) - state.enemy.damage);
  const attackBefore = effectiveEnemyAttack(state);
  removeFromHand(player, cards);
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = { playerIdx, cards, healthBefore, attackBefore, healthAfter: healthBefore, attackAfter: attackBefore };
  state.lastSacrifice = null;

  // The Pamphleteer breaks immunity the moment he takes the floor — before a
  // partner resolves, so the partner's suit power lands even on a matching enemy.
  const jester = cards.some(c => c.r === 'X');
  if (jester) {
    state.enemy.immunityCancelled = true;
    log(state, `${player.name} unleashes the Pamphleteer — the enemy's immunity is broken!`);
  }

  const value = cards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(cards.map(c => c.s).filter(Boolean))];
  state.playedCombos.push({ cards, value, suits });

  const enemySuit = state.enemy.card.s;
  const active = s => s !== enemySuit || state.enemy.immunityCancelled;

  // Step 1: apply the attack. Clubs modifies the blow itself, so its power is
  // accounted for while calculating damage; every other suit resolves below.
  const doubled = suits.includes('C') && active('C');
  const damage = doubled ? value * 2 : value;
  state.enemy.damage += damage;
  log(state, `${player.name} attacks for ${damage} damage${doubled ? ' (the mob doubles the blow!)' : ''}.`);

  // Damage lands before powers do, so we already know whether this is the exact
  // kill that claims the royal for the slayer's hand. The slayer played at least
  // one card to get here, so a slot is free — Rally is the only thing that could
  // fill it, and it draws them one short to keep the royal's place. When exact
  // kills go atop Le Peuple instead, no slot needs holding open.
  const claimsRoyal = state.rules.exactKillTo === 'hand' && state.enemy.damage === enemyHealth(state);

  // Step 2: resolve card powers before deciding whether anyone dies. This is
  // especially important for Rally: cards drawn here must count when checking
  // whether the attacker can withstand a surviving enemy's counterattack.
  let healedCount = 0;
  let drawnCount = 0;

  // Raid before Rally so recovered cards are safely under Le Peuple before
  // recruitment begins.
  if (suits.includes('D') && active('D')) {
    shuffle(state.discard, state._rng);
    const healed = state.discard.splice(0, Math.min(value, state.discard.length));
    state.tavern.unshift(...healed); // under the deck, no peeking
    healedCount = healed.length;
    if (healed.length) log(state, `${player.name} raids la Prison — ${healed.length} prisoner${healed.length === 1 ? '' : 's'} return beneath Le Peuple.`);
  }
  if (suits.includes('H') && active('H')) {
    let toDraw = value;
    let i = playerIdx;
    let skips = 0;
    const capFor = idx => state.handSize - (claimsRoyal && idx === playerIdx ? 1 : 0);
    while (toDraw > 0 && state.tavern.length > 0 && skips < state.players.length) {
      const idx = i % state.players.length;
      const p = state.players[idx];
      if (p.hand.length < capFor(idx)) {
        p.hand.push(state.tavern.pop());
        toDraw--;
        skips = 0;
      } else {
        skips++;
      }
      i++;
    }
    const drawn = value - toDraw;
    drawnCount = drawn;
    if (drawn) log(state, `${player.name} rallies the people — the citoyens recruit ${drawn} card${drawn === 1 ? '' : 's'}.`);
  }

  if (healedCount || drawnCount) state.lastEffects = { healed: healedCount, drawn: drawnCount };
  if (suits.includes('S') && active('S')) {
    log(state, `Barricades rise — the enemy's attack is reduced by ${value}.`);
  }
  state.lastPlay.healthAfter = Math.max(0, enemyHealth(state) - state.enemy.damage);
  state.lastPlay.attackAfter = effectiveEnemyAttack(state);

  // Step 3: only now decide whether the attack defeated the enemy. A lone
  // Pamphleteer returned above; one with a companion can reach this judgment.
  if (state.enemy.damage >= enemyHealth(state)) {
    defeatEnemy(state, playerIdx);
    return state;
  }

  // Step 4: a survivor counterattacks. A protected Pamphleteer's shield covers
  // the whole play, companion and all. beginSuffering reads the attacker's
  // post-Rally hand, so a heart draw can prevent a premature loss.
  if (jester) {
    if (state.rules.pamphleteerImmune) {
      log(state, `The Pamphleteer shields ${player.name} from reprisal.`);
      advanceTurn(state);
      return state;
    }
  }
  beginSuffering(state, playerIdx);
  return state;
}

function defeatEnemy(state, playerIdx) {
  // An exact kill either wins the royal over to the slayer's own hand or sets
  // them face down atop Le Peuple for whoever draws next.
  const exact = state.enemy.damage === enemyHealth(state);
  const toHand = exact && state.rules.exactKillTo === 'hand';
  const enemyCard = state.enemy.card;
  // The client keeps this public history long enough to animate the committed
  // cards from In Play into La Prison after the royal falls.
  const playedCards = state.playedCombos.flatMap(combo => combo.cards);
  // Won over, the royal takes up arms at once — before the spoils are shared, so
  // the slot Rally held open is filled by them and not by a spoil.
  if (toHand) state.players[playerIdx].hand.push(enemyCard);
  // An overkilled royal is removed from the game. They never enter La Prison,
  // so Raid and Regroup cannot bring them back into circulation.
  for (const combo of state.playedCombos) state.discard.push(...combo.cards);
  log(state, exact
    ? (toHand
      ? `${cardName(enemyCard)} falls with surgical precision — and joins ${state.players[playerIdx].name}'s hand!`
      : `${cardName(enemyCard)} falls with surgical precision — and slips into Le Peuple to fight on.`)
    : `${cardName(enemyCard)} is sent to the guillotine!`);

  if (state.castle.length === 0) {
    // Nothing follows, but every card stays accounted for.
    if (exact && !toHand) state.tavern.push(enemyCard);
    state.phase = 'won';
    state.enemy = null;
    state.lastEvent = { type: 'victory', exact, card: enemyCard, playedCards };
    log(state, 'The last King is dead. Vive la République!');
    return;
  }
  // A royal won over by exact damage is the slayer's spoil, not a bonus on
  // top of it. Other citoyens still receive their normal share. With the
  // standard one-spoil rule this means solo receives only the captured royal.
  const spoils = claimSpoils(state, playerIdx, toHand ? 1 : 0);
  // A royal felled to the last point is laid on Le Peuple only once the spoils
  // have been gathered from it — otherwise the table would simply draw them
  // straight back, and the rule would mean nothing.
  if (exact && !toHand) state.tavern.push(enemyCard);
  revealEnemy(state);
  state.lastEvent = {
    type: 'defeatAndReveal',
    exact,
    seq: state.revealSeq,
    card: enemyCard,
    playedCards,
    spoilsDrawn: spoils.total,
    spoilsByPlayer: spoils.byPlayer,
  };
  // The slayer skips the counterattack and hands on: the newcomer is faced by
  // the next citoyen round the table (alone, that is the slayer again).
  state.current = (playerIdx + 1) % state.players.length;
  state.phase = 'play';
  checkTurnStart(state);
}

// Deal a share of Le Peuple round the table, never past anyone's hand limit,
// starting from one citoyen so a Peuple too thin to pay everyone still spreads
// what is left rather than emptying by seat.
function shareDraw(state, fromIdx, share, credits = 0, byPlayer = null) {
  let drawn = 0;
  for (let round = 0; round < share; round++) {
    for (let k = 0; k < state.players.length && state.tavern.length > 0; k++) {
      const idx = (fromIdx + k) % state.players.length;
      // A captured royal has already paid this many rounds of the slayer's
      // spoil. The credit applies only to them; it does not reduce anyone
      // else's draw.
      if (idx === fromIdx && round < credits) continue;
      const q = state.players[idx];
      if (q.hand.length < state.handSize) {
        q.hand.push(state.tavern.pop());
        drawn++;
        if (byPlayer) byPlayer[idx]++;
      }
    }
  }
  return drawn;
}

// Les Dépouilles: a fallen royal leaves the streets richer.
function claimSpoils(state, playerIdx, slayerCredits = 0) {
  const byPlayer = state.players.map(() => 0);
  const drawn = shareDraw(state, playerIdx, state.rules.drawOnVictory, slayerCredits, byPlayer);
  if (drawn) log(state, `The spoils are shared — the citoyens take up ${drawn} card${drawn === 1 ? '' : 's'}.`);
  return { total: drawn, byPlayer };
}

function beginSuffering(state, playerIdx) {
  const atk = effectiveEnemyAttack(state);
  if (atk === 0) {
    log(state, `The barricades hold — ${state.players[playerIdx].name} suffers nothing.`);
    resumeAfterDamage(state, playerIdx);
    return;
  }
  const player = state.players[playerIdx];
  if (handValue(player) < atk && regroupsLeft(state) === 0) {
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

// Lying low is a true duck: no attack, and the royal finds nobody to strike.
// It is rationed instead of paid for — once per citoyen per royal. That keeps
// it available to whoever is handed a fresh royal on an empty hand (the one
// player a counterattack-paying Lay Low could never actually save), while
// still costing the table a turn of damage it did not deal.
export function canYield(state, playerIdx) {
  if (state.phase !== 'play' || playerIdx !== state.current) return false;
  // Lying low only ever helps by passing the turn to someone else — with no
  // other citoyen to pass to, solo play gets nothing from it at all.
  if (state.solo) return false;
  return !state.players[playerIdx].laidLow;
}

export function yieldTurn(state, playerIdx) {
  if (state.assembly) throw new Error('l’Assemblée is in session.');
  if (state.phase !== 'play' || playerIdx !== state.current) throw new Error('It is not your turn.');
  if (state.solo) throw new Error('You cannot lie low — there is no fellow citoyen to act in your place.');
  if (!canYield(state, playerIdx)) throw new Error('You have already lain low against this royal.');
  const player = state.players[playerIdx];
  player.laidLow = true;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
  log(state, `${player.name} lies low — ${cardName(state.enemy.card)} finds nobody to strike.`);
  advanceTurn(state);
  return state;
}


export function validateDiscard(state, playerIdx, cards) {
  if (state.assembly) return 'l’Assemblée is in session.';
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
  state.lastPlay = null;
  state.lastSacrifice = { playerIdx, cards };
  log(state, `${player.name} sacrifices ${cards.length} card${cards.length === 1 ? '' : 's'} to survive.`);
  state.pendingDamage = 0;
  resumeAfterDamage(state, playerIdx);
  return state;
}

// A blow paid, the turn carries clockwise to the next citoyen.
function resumeAfterDamage(state) {
  advanceTurn(state);
}

export function surrenderGame(state, playerIdx) {
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('The game is already over.');
  const player = state.players[playerIdx];
  if (!player) throw new Error('Unknown citoyen.');
  state.phase = 'lost';
  state.pendingDamage = 0;
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
  state.actionSeq++;
  state.result = { reason: `${player.name} surrendered. The Revolution is over.` };
  state.lastEvent = { type: 'loss' };
  log(state, state.result.reason);
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
    if (regroupsLeft(state) > 0) return; // a Regroup can still save them
    state.phase = 'lost';
    state.result = { reason: `${p.name} has no cards and cannot lie low. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
  }
}

// ---- Regroup ---------------------------------------------------------------
// The table shares one pool of Regroups. Alone you simply spend one; at a table
// l'Assemblée must carry the motion first (see below). A Regroup resets the
// deck for EVERYONE — every card that is not committed in play returns to Le
// Peuple to be shuffled and dealt afresh — and does NOT cancel enemy immunity.
export function canRegroup(state, playerIdx) {
  return playerIdx === state.current
    && !state.assembly
    && regroupsLeft(state) > 0
    && (state.phase === 'play' || state.phase === 'discard');
}

export function regroup(state, playerIdx = state.current) {
  if (!state.solo) throw new Error('A Regroup needs l’Assemblée’s consent.');
  if (playerIdx !== state.current) throw new Error('It is not your turn.');
  if (regroupsLeft(state) <= 0) throw new Error('No Regroups remain.');
  if (state.phase !== 'play' && state.phase !== 'discard') throw new Error('Not now.');
  return applyRegroup(state, playerIdx);
}

// Everything except the cards committed against the current royal goes back
// into Le Peuple: every citoyen's hand and all of La Prison. Le Régime and the
// royal on the table are untouched.
function applyRegroup(state, playerIdx) {
  const p = state.players[playerIdx];
  const scope = state.rules.regroupScope;
  // At its narrowest a Regroup resets nothing at all: the table simply takes a
  // few cards from Le Peuple. No shuffle, La Prison untouched — a top-up rather
  // than a fresh start, and a far smaller step than any reshuffle.
  if (scope === 'draw') {
    const drawn = shareDraw(state, playerIdx, state.rules.regroupDraw);
    finishRegroup(state, p, `${p.name} calls the citoyens together — ${drawn} card${drawn === 1 ? '' : 's'} come up from Le Peuple`);
    return state;
  }
  // La Prison empties back into Le Peuple for every scope but the narrowest,
  // where a Regroup reaches no further than the caller's own hand.
  if (scope !== 'caller') {
    state.tavern.push(...state.discard);
    state.discard = [];
  }
  // Whose hands go back. Only those who gave a hand up draw a fresh one.
  const rejoining = scope === 'table' ? state.players : [p];
  for (const q of rejoining) {
    state.tavern.push(...q.hand);
    q.hand = [];
  }
  shuffle(state.tavern, state._rng);
  // Dealt round by round from the citoyen who called it, so a deck too short to
  // fill every hand still spreads what is left evenly rather than by seat.
  for (let round = 0; round < state.handSize; round++) {
    for (let k = 0; k < state.players.length && state.tavern.length > 0; k++) {
      const q = state.players[(playerIdx + k) % state.players.length];
      if (!rejoining.includes(q)) continue;
      if (q.hand.length < state.handSize) q.hand.push(state.tavern.pop());
    }
  }
  const scopeTold = {
    caller: `${p.name}'s hand returns to Le Peuple, shuffled, and is dealt afresh`,
    callerAndPrison: `${p.name}'s hand and all of La Prison return to Le Peuple, shuffled, and a fresh hand is dealt`,
    table: state.solo
      ? 'Every card outside the fight returns to Le Peuple, shuffled'
      : `${p.name} calls the table in: every hand and all of La Prison return to Le Peuple, shuffled, and fresh hands are dealt all round`,
  }[scope];
  finishRegroup(state, p, scopeTold);
  return state;
}

// Spend the Regroup and see whether it was enough. Shared by every scope, so a
// narrow Regroup and a wide one are accounted for and checked identically.
function finishRegroup(state, p, told) {
  state.regroupsRemaining--;
  state.regroupsUsed++;
  state.actionSeq++;
  state.lastEvent = { type: 'regroup', seq: state.actionSeq };
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
  log(state, `Regroup! ${told}. (${regroupsLeft(state)} left)`);
  if (state.phase === 'discard' && handValue(p) < state.pendingDamage) {
    state.phase = 'lost';
    state.result = { reason: `Even regrouped, you could not withstand ${state.pendingDamage} damage. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
  } else if (state.phase === 'play') {
    checkTurnStart(state);
  }
}

// ---- l'Assemblée (the regroup vote) ----------------------------------------
// Only the citoyen holding the floor may move for a Regroup — including while
// suffering a blow, which is exactly when it saves a game. Moving the motion is
// the caller's own Yea; every other connected citoyen answers Yea or Nay, and
// the motion carries on a strict majority of the connected table.

export function canCallAssembly(state, playerIdx) {
  return !state.solo && canRegroup(state, playerIdx);
}

// eligible: indices of the connected citoyens. The server owns that knowledge;
// tests and solo may omit it to mean "everyone at the table".
export function callAssembly(state, playerIdx, eligible = null) {
  if (state.solo) throw new Error('There is no Assemblée to convene alone.');
  if (state.assembly) throw new Error('l’Assemblée is already in session.');
  if (playerIdx !== state.current) throw new Error('Only the citoyen holding the floor may move.');
  if (regroupsLeft(state) <= 0) throw new Error('No Regroups remain.');
  if (state.phase !== 'play' && state.phase !== 'discard') throw new Error('Not now.');
  const seats = eligible ?? state.players.map((_, i) => i);
  state.assembly = {
    caller: playerIdx,
    voters: seats.filter(i => i !== playerIdx && i >= 0 && i < state.players.length),
    votes: {},
  };
  state.actionSeq++;
  state.lastEvent = null;
  log(state, `${state.players[playerIdx].name} convenes l’Assemblée — a motion to Regroup.`);
  return resolveAssembly(state);
}

export function castVote(state, playerIdx, aye) {
  const a = state.assembly;
  if (!a) throw new Error('l’Assemblée is not in session.');
  if (playerIdx === a.caller) throw new Error('Moving the motion is your own Yea.');
  if (!a.voters.includes(playerIdx)) throw new Error('You have no vote in this motion.');
  a.votes[playerIdx] = !!aye;
  state.actionSeq++;
  return resolveAssembly(state);
}

// Connections change mid-vote. A citoyen who drops leaves the floor entirely —
// they are struck from both the tally and its denominator, or the motion would
// hang on a sleeping phone. If the mover themselves drops, the motion dies.
export function syncAssembly(state, connected) {
  const a = state.assembly;
  if (!a) return state;
  if (!connected.includes(a.caller)) {
    state.assembly = null;
    state.actionSeq++;
    log(state, 'l’Assemblée disperses — the mover has left the floor.');
    return state;
  }
  a.voters = connected.filter(i => i !== a.caller && i >= 0 && i < state.players.length);
  for (const key of Object.keys(a.votes)) {
    if (!a.voters.includes(Number(key))) delete a.votes[key];
  }
  return resolveAssembly(state);
}

function resolveAssembly(state) {
  const a = state.assembly;
  if (!a) return state;
  if (a.voters.some(i => a.votes[i] === undefined)) return state; // still on the floor
  const ayes = 1 + a.voters.filter(i => a.votes[i]).length;
  const seated = a.voters.length + 1;
  const caller = a.caller;
  state.assembly = null;
  state.actionSeq++;
  if (ayes * 2 > seated) {
    log(state, `The motion carries, ${ayes}–${seated - ayes}.`);
    return applyRegroup(state, caller);
  }
  log(state, `The motion falls, ${ayes}–${seated - ayes}. Nothing is spent.`);
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
    rules: state.rules,
    regroupsRemaining: state.regroupsRemaining,
    regroupsUsed: state.regroupsUsed,
    assembly: state.assembly ? {
      caller: state.assembly.caller,
      voters: state.assembly.voters,
      votes: state.assembly.votes,
      youMayVote: playerIdx != null
        && playerIdx !== state.assembly.caller
        && state.assembly.voters.includes(playerIdx)
        && state.assembly.votes[playerIdx] === undefined,
    } : null,
    players: state.players.map((p, i) => ({
      name: p.name,
      handCount: p.hand.length,
      laidLow: p.laidLow,
      you: i === playerIdx,
    })),
    you: playerIdx != null ? {
      index: playerIdx,
      hand: state.players[playerIdx].hand,
    } : null,
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
    lastPlay: state.lastPlay,
    lastSacrifice: state.lastSacrifice,
    canYield: playerIdx != null ? canYield(state, playerIdx) : canYield(state, state.current),
    canRegroup: canRegroup(state, playerIdx ?? state.current),
    lastEvent: state.lastEvent,
    result: state.result,
  };
}
