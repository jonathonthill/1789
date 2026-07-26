// Régicide 1789 — pure rules engine (rulebook-faithful Regicide).
// Runs identically in Node (server-authoritative multiplayer) and the browser (solo).
// Cards: { r, s } where r ∈ 2..10 | 'A' (Sans-Culotte) | 'J' | 'Q' | 'K' | 'X' (Pamphleteer, s=null)
// Suits: 'S' | 'H' | 'D' | 'C'

export const SUITS = ['S', 'H', 'D', 'C'];

const HAND_SIZE = { 1: 8, 2: 7, 3: 6, 4: 6 };
const JESTERS = { 1: 1, 2: 1, 3: 2, 4: 2 };
// Rulebook Regroups, expressed as one pool shared by the table: solo sets two
// Pamphleteers aside, a two-player table sets one aside each, larger tables none.
const REGROUPS = { 1: 2, 2: 2, 3: 0, 4: 0 };
export const ENEMY_STATS = { J: { attack: 10, health: 20 }, Q: { attack: 15, health: 30 }, K: { attack: 20, health: 40 } };

// ---- La Constitution (house rules) -----------------------------------------
// A null count means "whatever the rulebook says for this table size", which is
// what lets the host fill the menu in before knowing how many citoyens will join.
export const DEFAULT_RULES = {
  afterKill: 'slayer',          // 'slayer' | 'next' | 'choose'
  regroups: null,               // 0..4, shared by the whole table
  pamphleteers: null,           // 0..4 shuffled into Le Peuple
  pamphleteerCompanion: false,  // may the Pamphleteer take one partner?
  exactKillToHand: false,       // exact kill: to the slayer's hand, else top of Le Peuple
  handSizeDelta: 0,             // -1 | 0 | 1
};

const AFTER_KILL = ['slayer', 'next', 'choose'];

function clampInt(v, lo, hi, fallback) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Fold a partial (and possibly hostile — this runs on the server too) rules
// object into concrete numbers for a table of n.
export function resolveRules(rules, n) {
  const r = { ...DEFAULT_RULES, ...(rules ?? {}) };
  // Alone, "the next citoyen" and "the slayer chooses" both resolve to yourself.
  const afterKill = n === 1 ? 'slayer' : r.afterKill;
  return {
    afterKill: AFTER_KILL.includes(afterKill) ? afterKill : DEFAULT_RULES.afterKill,
    regroups: r.regroups == null ? REGROUPS[n] : clampInt(r.regroups, 0, 4, REGROUPS[n]),
    pamphleteers: r.pamphleteers == null ? JESTERS[n] : clampInt(r.pamphleteers, 0, 4, JESTERS[n]),
    pamphleteerCompanion: !!r.pamphleteerCompanion,
    exactKillToHand: !!r.exactKillToHand,
    handSizeDelta: clampInt(r.handSizeDelta, -1, 1, 0),
  };
}

// What the rulebook would give this table — the menu renders these as "Rulebook (n)".
export function rulebookFor(n) {
  return { regroups: REGROUPS[n] ?? 0, pamphleteers: JESTERS[n] ?? 0, handSize: HAND_SIZE[n] ?? 6 };
}

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
      yielded: false,
    })),
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
    if (cards.length > 2) return 'The Pamphleteer may take only one partner.';
    return null;
  }
  if (cards.length === 1) return null;
  const companions = cards.filter(c => c.r === 'A').length;
  if (companions > 0) {
    if (cards.length === 2) return null; // Sans-Culotte + any one card (or two Sans-Culottes)
    return 'A Sans-Culotte may join only one other card.';
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
  const attackCards = cards.filter(c => c.r !== 'X');
  const value = attackCards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(attackCards.map(c => c.s).filter(Boolean))];
  const enemySuit = state.enemy.card.s;
  // A Pamphleteer in the play shatters immunity before its partner resolves,
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
    exactKill,
    // Warn before committing: an exact kill claims the royal for your own hand.
    toHand: exactKill && state.rules.exactKillToHand,
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
  player.yielded = false;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = { playerIdx, cards, healthBefore, attackBefore, healthAfter: healthBefore, attackAfter: attackBefore };
  state.lastSacrifice = null;

  // The Pamphleteer shatters immunity the moment he takes the floor — before a
  // partner resolves, so the partner's suit power lands even on a matching enemy.
  const jester = cards.some(c => c.r === 'X');
  const attackCards = cards.filter(c => c.r !== 'X');
  if (jester) state.enemy.immunityCancelled = true;

  if (jester && attackCards.length === 0) {
    state.playedCombos.push({ cards, value: 0, suits: [] });
    log(state, `${player.name} unleashes the Pamphleteer — the enemy's immunity is shattered!`);
    giveFloorToChooser(state, playerIdx);
    return state;
  }

  const value = attackCards.reduce((s, c) => s + cardValue(c), 0);
  const suits = [...new Set(attackCards.map(c => c.s))];
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
  // fill it, and it draws them one short to keep the royal's place.
  const claimsRoyal = state.rules.exactKillToHand && state.enemy.damage === enemyHealth(state);

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

  // Step 3: only now decide whether the attack defeated the enemy.
  if (state.enemy.damage >= enemyHealth(state)) {
    defeatEnemy(state, playerIdx, jester);
    return state;
  }

  // Step 4: a survivor counterattacks — unless the Pamphleteer is on the floor,
  // whose protection covers the whole play. beginSuffering reads the attacker's
  // post-Rally hand, so a heart draw can prevent a premature loss.
  if (jester) {
    log(state, `The Pamphleteer shields ${player.name} from reprisal.`);
    giveFloorToChooser(state, playerIdx);
    return state;
  }
  beginSuffering(state, playerIdx);
  return state;
}

// The Pamphleteer hands the floor to a citoyen of the player's choosing — but
// alone there is nobody to choose between, so the turn simply carries on
// rather than stopping to ask.
function giveFloorToChooser(state, playerIdx) {
  state.current = playerIdx;
  if (state.solo) {
    state.phase = 'play';
    checkTurnStart(state);
    return;
  }
  state.phase = 'jesterChoose';
  log(state, `${state.players[playerIdx].name} chooses who acts next.`);
}

// viaPamphleteer: the killing play included a Pamphleteer, whose choice of the
// next citoyen outranks whatever La Constitution says about the slayer's right.
function defeatEnemy(state, playerIdx, viaPamphleteer = false) {
  const exact = state.enemy.damage === enemyHealth(state);
  const toHand = exact && state.rules.exactKillToHand;
  const enemyCard = state.enemy.card;
  // The client keeps this public history long enough to animate the committed
  // cards from In Play into La Prison after the royal falls.
  const playedCards = state.playedCombos.flatMap(combo => combo.cards);
  if (toHand) {
    state.players[playerIdx].hand.push(enemyCard); // won over, and takes up arms at once
  } else if (exact) {
    state.tavern.push(enemyCard); // facedown on top — the royal is won over to the Revolution
  } else {
    state.discard.push(enemyCard);
  }
  for (const combo of state.playedCombos) state.discard.push(...combo.cards);
  if (toHand) {
    log(state, `${cardName(enemyCard)} falls with surgical precision — and joins ${state.players[playerIdx].name}'s hand!`);
  } else {
    log(state, exact
      ? `${cardName(enemyCard)} falls with surgical precision — won over to the Revolution! (top of Le Peuple)`
      : `${cardName(enemyCard)} is sent to the guillotine!`);
  }

  if (state.castle.length === 0) {
    state.phase = 'won';
    state.enemy = null;
    state.lastEvent = { type: 'victory', exact, toHand, card: enemyCard, playedCards };
    log(state, 'The last King is dead. Vive la République!');
    return;
  }
  revealEnemy(state);
  state.lastEvent = { type: 'defeatAndReveal', exact, toHand, seq: state.revealSeq, card: enemyCard, playedCards };
  // The slayer skips Step 4 either way; La Constitution decides who faces the newcomer.
  if ((viaPamphleteer || state.rules.afterKill === 'choose') && !state.solo) {
    state.current = playerIdx;
    state.phase = 'jesterChoose';
    log(state, `${state.players[playerIdx].name} chooses who faces the newcomer.`);
    return;
  }
  state.current = state.rules.afterKill === 'next'
    ? (playerIdx + 1) % state.players.length
    : playerIdx;
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

export function canYield(state, playerIdx) {
  if (state.phase !== 'play' || playerIdx !== state.current) return false;
  // Lying low only ever helps by passing the turn to someone else — with no
  // other citoyen to pass to, solo play gets nothing from it but a free hit.
  if (state.solo) return false;
  const others = state.players.filter((_, i) => i !== playerIdx);
  return !others.every(p => p.yielded);
}

export function yieldTurn(state, playerIdx) {
  if (state.assembly) throw new Error('l’Assemblée is in session.');
  if (state.phase !== 'play' || playerIdx !== state.current) throw new Error('It is not your turn.');
  if (!canYield(state, playerIdx)) throw new Error('You cannot lie low — every other citoyen already has.');
  const player = state.players[playerIdx];
  player.yielded = true;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
  log(state, `${player.name} lies low.`);
  beginSuffering(state, playerIdx);
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
  state.lastPlay = null;
  state.lastSacrifice = null;
  state.actionSeq++;
  state.result = { reason: `${player.name} surrendered. The Revolution is over.` };
  state.lastEvent = { type: 'loss' };
  log(state, state.result.reason);
  return state;
}

export function chooseNext(state, playerIdx, targetIdx) {
  if (state.assembly) throw new Error('l’Assemblée is in session.');
  if (state.phase !== 'jesterChoose') throw new Error('No choice to make.');
  if (playerIdx !== state.current) throw new Error('Only the Pamphleteer’s player chooses.');
  if (targetIdx < 0 || targetIdx >= state.players.length) throw new Error('No such citoyen.');
  state.current = targetIdx;
  state.phase = 'play';
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
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
    if (regroupsLeft(state) > 0) return; // a Regroup can still save them
    state.phase = 'lost';
    state.result = { reason: `${p.name} has no cards and cannot lie low. The Revolution is crushed.` };
    state.lastEvent = { type: 'loss' };
    log(state, state.result.reason);
  }
}

// ---- Regroup ---------------------------------------------------------------
// The table shares one pool of Regroups. Alone you simply spend one; at a table
// l'Assemblée must carry the motion first (see below). Only the acting player's
// hand changes, and a Regroup does NOT cancel enemy immunity.
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

function applyRegroup(state, playerIdx) {
  const p = state.players[playerIdx];
  state.discard.push(...p.hand);
  p.hand = [];
  drawTo(state, p);
  state.regroupsRemaining--;
  state.regroupsUsed++;
  state.lastEvent = null;
  state.actionSeq++;
  state.lastEffects = null;
  state.lastPlay = null;
  state.lastSacrifice = null;
  const remaining = regroupsLeft(state);
  log(state, `Regroup! ${p.name} discards their hand and rallies ${p.hand.length} fresh card${p.hand.length === 1 ? '' : 's'}. (${remaining} left)`);
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

// ---- l'Assemblée (the regroup vote) ----------------------------------------
// Only the citoyen holding the floor may move for a Regroup — including while
// suffering a blow, which is exactly when it saves a game. Moving the motion is
// the caller's own aye; every other connected citoyen answers Pour or Contre,
// and the motion carries on a strict majority of the connected table.

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
  if (playerIdx === a.caller) throw new Error('Moving the motion is your own aye.');
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
      yielded: p.yielded,
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
