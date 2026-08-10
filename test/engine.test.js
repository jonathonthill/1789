import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, playCards, yieldTurn, discardForDamage, regroup,
  usePamphleteer, callPamphleteerAssembly,
  surrenderGame, callAssembly, castVote, syncAssembly,
  validatePlay, validateDiscard, canYield, previewPlay, viewFor,
  currentShield, enemyAttack, effectiveEnemyAttack, cardValue, resolveRules,
  serializeGame, restoreGame,
} from '../shared/engine.js';

const names2 = ['Danton', 'Robespierre'];
const names3 = ['Danton', 'Robespierre', 'Marat'];
const names4 = [...names3, 'Desmoulins'];

const TABLE_REGROUP = { regroupScope: 'table', regroups: 2 };

// Force a known hand / enemy for scenario tests.
function rig(state, { hands, enemy, tavernTop, discard } = {}) {
  if (hands) hands.forEach((h, i) => { state.players[i].hand = h.map(c => ({ ...c })); });
  if (enemy) {
    state.enemy.card = { ...enemy };
    state.enemy.damage = 0;
  }
  if (tavernTop) state.tavern.push(...tavernTop.map(c => ({ ...c })));
  if (discard) state.discard = discard.map(c => ({ ...c }));
  return state;
}

test('deck composition per player count', () => {
  for (const [n, hand] of [[1, 5], [2, 5], [3, 4], [4, 4]]) {
    const s = newGame(names4.slice(0, n), { seed: 1 });
    const all = [...s.tavern, ...s.players.flatMap(p => p.hand)];
    assert.equal(all.filter(c => c.r === 'X').length, 0, `${n}p Pamphleteers are not hand cards`);
    assert.equal(s.pamphleteersRemaining, 2, `${n}p Pamphleteers`);
    assert.equal(all.filter(c => c.r === 'A').length, 4, `${n}p companions`);
    assert.equal(all.length, 40, `${n}p tavern+hands size`);
    for (const p of s.players) assert.equal(p.hand.length, hand, `${n}p hand size`);
    assert.equal(s.castle.length, 11);
    assert.equal(s.enemy.card.r, 'J', 'first enemy is a Jack');
    assert.equal(viewFor(s, 0).enemy.health, n === 4 ? 25 : 20, `${n}p Officer endurance`);
    // castle order: next 3 are Jacks, then 4 Queens, then 4 Kings (top = end)
    const ranks = [...s.castle].reverse().map(c => c.r);
    assert.deepEqual(ranks, ['J', 'J', 'J', 'Q', 'Q', 'Q', 'Q', 'K', 'K', 'K', 'K']);
    assert.equal(s.regroupsRemaining, 1);
  }
});

test('a requested starting player leads the first turn', () => {
  const s = newGame(names3, { seed: 1, startingPlayer: 2 });
  assert.equal(s.current, 2);
  assert.match(s.log.at(-1), /Marat leads the first attack/);
  assert.throws(
    () => newGame(names2, { seed: 1, startingPlayer: 2 }),
    /starting player out of range/,
  );
});

test('a serialized solo game resumes with the exact future shuffle sequence', () => {
  const original = newGame(['Danton'], { seed: 1789 });
  original.regroupsRemaining = 2;
  const restored = restoreGame(serializeGame(original));

  regroup(original, 0);
  regroup(restored, 0);

  assert.deepEqual(serializeGame(restored), serializeGame(original));
  assert.throws(() => restoreGame({ playerCount: 1 }), /not valid/);
});

test('legacy solo saves receive the current Pamphleteer pool and transition draw', () => {
  const unused = serializeGame(newGame(['Danton'], { seed: 1790 }));
  delete unused.soloRulesVersion;
  unused.rules.pamphleteers = 1;
  unused.rules.transitionDraw = 0;
  unused.pamphleteersRemaining = 1;
  unused.pamphleteersUsed = 0;
  const restoredUnused = restoreGame(unused);
  assert.equal(restoredUnused.rules.pamphleteers, 2);
  assert.equal(restoredUnused.rules.transitionDraw, 1);
  assert.equal(restoredUnused.pamphleteersRemaining, 2);

  const spent = serializeGame(newGame(['Danton'], { seed: 1791 }));
  delete spent.soloRulesVersion;
  spent.rules.pamphleteers = 2;
  spent.rules.transitionDraw = 0;
  spent.pamphleteersRemaining = 0;
  spent.pamphleteersUsed = 2;
  const restoredSpent = restoreGame(spent);
  assert.equal(restoredSpent.rules.pamphleteers, 2);
  assert.equal(restoredSpent.rules.transitionDraw, 1);
  assert.equal(restoredSpent.pamphleteersRemaining, 0, 'two previously spent tokens stay spent');
  assert.equal(restoredSpent.pamphleteersUsed, 2, 'the previously spent tokens stay spent');

  const versionTwo = serializeGame(newGame(['Danton'], { seed: 1793 }));
  versionTwo.soloRulesVersion = 2;
  versionTwo.rules.pamphleteers = 3;
  versionTwo.pamphleteersRemaining = 2;
  versionTwo.pamphleteersUsed = 1;
  const restoredVersionTwo = restoreGame(versionTwo);
  assert.equal(restoredVersionTwo.rules.pamphleteers, 2);
  assert.equal(restoredVersionTwo.pamphleteersRemaining, 1, 'the obsolete third token is removed');
  assert.equal(restoredVersionTwo.pamphleteersUsed, 1);

  const currentOverride = serializeGame(newGame(['Danton'], {
    seed: 1792,
    rules: { pamphleteers: 2, transitionDraw: 0 },
  }));
  const restoredOverride = restoreGame(currentOverride);
  assert.equal(restoredOverride.rules.pamphleteers, 2, 'current saved overrides remain intact');
  assert.equal(restoredOverride.rules.transitionDraw, 0, 'current transition overrides remain intact');
});

test('combo legality', () => {
  const s = newGame(names2, { seed: 2 });
  rig(s, { hands: [[
    { r: 2, s: 'S' }, { r: 2, s: 'H' }, { r: 2, s: 'D' }, { r: 2, s: 'C' },
    { r: 5, s: 'S' }, { r: 5, s: 'H' }, { r: 5, s: 'D' }, { r: 5, s: 'C' },
    { r: 10, s: 'S' }, { r: 10, s: 'H' }, { r: 10, s: 'D' }, { r: 10, s: 'C' },
    { r: 7, s: 'S' }, { r: 7, s: 'H' }, { r: 7, s: 'D' }, { r: 6, s: 'S' },
  ], []] });
  assert.equal(validatePlay(s, 0, s.players[0].hand.slice(0, 4)), null, 'quad 2s ok');
  assert.equal(validatePlay(s, 0, s.players[0].hand.slice(4, 8)), null, 'quad 5s reaches the cap at 20');
  assert.equal(validatePlay(s, 0, s.players[0].hand.slice(8, 10)), null, 'pair 10s reaches the cap at 20');
  assert.match(validatePlay(s, 0, s.players[0].hand.slice(12, 15)), /at most 20/, 'three 7s exceed the cap');
  assert.match(validatePlay(s, 0, s.players[0].hand.slice(8, 12)), /at most 20/, 'quad 10s exceed the cap');
  assert.ok(validatePlay(s, 0, [{ r: 6, s: 'S' }, { r: 5, s: 'S' }]), 'mixed ranks rejected');
  assert.ok(validatePlay(s, 0, [{ r: 6, s: 'S' }, { r: 6, s: 'S' }]), 'card not held twice rejected');
});

test('companion pairing rules', () => {
  const s = newGame(names2, { seed: 3 });
  rig(s, { hands: [[
    { r: 'A', s: 'C' }, { r: 'A', s: 'D' }, { r: 8, s: 'D' },
    { r: 2, s: 'S' }, { r: 2, s: 'H' },
    { r: 5, s: 'S' }, { r: 5, s: 'H' }, { r: 5, s: 'D' }, { r: 5, s: 'C' },
    { r: 7, s: 'S' }, { r: 7, s: 'H' }, { r: 7, s: 'D' }, { r: 6, s: 'S' },
  ], []] });
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 8, s: 'D' }]), null, 'A + card ok');
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 'A', s: 'D' }]), null, 'A + A ok');
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }]), null, 'A alone ok');
  assert.match(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 2, s: 'S' }, { r: 2, s: 'H' }]), /only one other card/, 'A cannot join a combo');
  assert.match(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 5, s: 'S' }, { r: 5, s: 'H' }, { r: 5, s: 'D' }, { r: 5, s: 'C' }]), /only one other card/, 'A cannot be a fifth combo card');
  assert.match(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 7, s: 'S' }, { r: 7, s: 'H' }, { r: 7, s: 'D' }]), /only one other card/, 'A cannot join an over-cap combo');
  assert.match(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 'A', s: 'D' }, { r: 5, s: 'S' }]), /only one other card/, 'two As cannot join another card');
  assert.match(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 5, s: 'S' }, { r: 6, s: 'S' }]), /only one other card/, 'A cannot make mixed ranks legal');
});

test('Les Renforts is worth one and combines its suit power with its partner', () => {
  assert.equal(cardValue({ r: 'A', s: 'H' }), 1);
  const s = newGame(names3, { seed: 4 });
  rig(s, {
    hands: [[{ r: 8, s: 'H' }, { r: 'A', s: 'C' }, { r: 9, s: 'S' }], [{ r: 3, s: 'H' }], []],
    enemy: { r: 'J', s: 'D' },
  });
  const before = s.players.reduce((n, p) => n + p.hand.length, 0) - 2; // minus played
  playCards(s, 0, [{ r: 8, s: 'H' }, { r: 'A', s: 'C' }]);
  assert.equal(s.enemy.damage, 18, 'the Ace adds its value and clubs power');
  const after = s.players.reduce((n, p) => n + p.hand.length, 0);
  assert.equal(after - before, 9, 'both powers use the full value of the play');
});

test('Rally resolves before counterattack survivability is checked', () => {
  const s = newGame(names2, { seed: 41 });
  rig(s, {
    hands: [
      [{ r: 2, s: 'H' }, { r: 2, s: 'C' }],
      [
        { r: 3, s: 'S' }, { r: 4, s: 'S' }, { r: 5, s: 'S' },
        { r: 6, s: 'S' }, { r: 7, s: 'S' }, { r: 8, s: 'S' }, { r: 9, s: 'S' },
      ],
    ],
    enemy: { r: 'J', s: 'S' },
    tavernTop: [{ r: 3, s: 'D' }, { r: 10, s: 'C' }],
  });

  playCards(s, 0, [{ r: 2, s: 'H' }]);

  assert.equal(s.phase, 'discard', 'the post-Rally hand survives and may resist');
  assert.equal(s.pendingDamage, 10);
  assert.deepEqual(s.lastEffects, { healed: 0, drawn: 2 });
  assert.equal(s.players[0].hand.reduce((sum, card) => sum + cardValue(card), 0), 15);
  assert.match(s.log.at(-3), /attacks for 2 damage/, 'attack resolves first');
  assert.match(s.log.at(-2), /rallies the people/, 'card power resolves second');
  assert.match(s.log.at(-1), /strikes Danton for 10/, 'counterattack resolves last');
});

test('Raid shuffles prisoners into Le Peuple before Rally recruits', () => {
  const s = newGame(names2, { seed: 5 });
  rig(s, {
    hands: [[{ r: 5, s: 'H' }, { r: 5, s: 'D' }], [{ r: 2, s: 'C' }]],
    enemy: { r: 'J', s: 'C' },
    discard: [{ r: 9, s: 'C' }, { r: 9, s: 'D' }, { r: 9, s: 'H' }],
  });
  const tavernBefore = s.tavern.length;
  playCards(s, 0, [{ r: 5, s: 'H' }, { r: 5, s: 'D' }]); // pair of 5s: return 10 (capped 3), recruit 10
  assert.equal(s.discard.length, 0, 'the prisoners fully returned');
  // Three return, all of Le Peuple is shuffled, then Rally recruits from it.
  assert.equal(s.enemy.damage, 10);
  assert.ok(s.tavern.length <= tavernBefore + 3, 'Le Peuple gained returned cards then supplied recruits');
  assert.equal(s.phase, 'discard', 'Jack of Clubs strikes back for 10');
  assert.equal(s.pendingDamage, 10);
});

test('Raid reshuffles all of Le Peuple after transferring the freed prisoners', () => {
  const s = newGame(['Danton'], { seed: 505 });
  const peupleBefore = Array.from({ length: 9 }, (_, i) => ({ r: i + 2, s: 'S' }));
  rig(s, {
    hands: [[{ r: 2, s: 'D' }, { r: 10, s: 'C' }]],
    enemy: { r: 'J', s: 'C' },
    discard: [{ r: 7, s: 'H' }, { r: 8, s: 'H' }, { r: 9, s: 'H' }],
  });
  s.tavern = peupleBefore.map(card => ({ ...card }));

  playCards(s, 0, [{ r: 2, s: 'D' }]);

  assert.equal(s.discard.length, 1, 'the Raid transfers exactly its value');
  assert.equal(s.tavern.length, peupleBefore.length + 2, 'the freed cards join Le Peuple');
  assert.equal(s.tavern.filter(card => card.s === 'H').length, 2, 'two shuffled prisoners were freed');
  assert.notDeepEqual(
    s.tavern.filter(card => card.s === 'S').map(card => card.r),
    peupleBefore.map(card => card.r),
    'the existing cards in Le Peuple are reshuffled too',
  );
});

test('spades shield reduces enemy attack cumulatively; zero damage skips discard', () => {
  const s = newGame(names2, { seed: 6 });
  rig(s, {
    hands: [[{ r: 7, s: 'S' }, { r: 4, s: 'S' }], [{ r: 6, s: 'S' }, { r: 2, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 7, s: 'S' }]);
  assert.equal(currentShield(s), 7);
  assert.equal(s.pendingDamage, 3, 'Jack attacks 10 - 7 = 3');
  discardForDamage(s, 0, [{ r: 4, s: 'S' }]);
  playCards(s, 1, [{ r: 6, s: 'S' }]);
  assert.equal(currentShield(s), 13);
  assert.equal(effectiveEnemyAttack(s), 0);
  assert.equal(s.phase, 'play', 'no damage — straight to next turn');
  assert.equal(s.current, 0);
});

test('enemy immunity: spades give no shield vs Jack of Spades until Pamphleteer, then prior spades count', () => {
  const s = newGame(names3, { seed: 7 });
  rig(s, {
    hands: [
      [{ r: 8, s: 'S' }, { r: 5, s: 'H' }, { r: 4, s: 'C' }, { r: 9, s: 'D' }],
      [{ r: 3, s: 'D' }],
      [{ r: 2, s: 'C' }, { r: 9, s: 'H' }],
    ],
    enemy: { r: 'J', s: 'S' },
  });
  playCards(s, 0, [{ r: 8, s: 'S' }]);
  assert.equal(currentShield(s), 0, 'immune — no shield');
  assert.equal(s.pendingDamage, 10, 'full 10 damage');
  assert.throws(() => discardForDamage(s, 0, [{ r: 5, s: 'H' }, { r: 4, s: 'C' }]), /at least 10/, '9 < 10 rejected');
});

test('discard must meet the pending damage', () => {
  const s = newGame(names2, { seed: 8 });
  rig(s, {
    hands: [[{ r: 3, s: 'H' }, { r: 4, s: 'C' }, { r: 9, s: 'D' }], [{ r: 2, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 3, s: 'H' }]);
  assert.equal(s.pendingDamage, 10);
  assert.ok(validateDiscard(s, 0, [{ r: 4, s: 'C' }]), '4 < 10 rejected');
  assert.equal(validateDiscard(s, 0, [{ r: 4, s: 'C' }, { r: 9, s: 'D' }]), null, '13 >= 10 ok');
  discardForDamage(s, 0, [{ r: 4, s: 'C' }, { r: 9, s: 'D' }]);
  assert.equal(s.current, 1);
});

test('lastPlay snapshots the enemy before/after a hit for client animation, and clears on the next action', () => {
  const s = newGame(names2, { seed: 9 });
  rig(s, {
    hands: [[{ r: 6, s: 'C' }, { r: 10, s: 'S' }], []],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 6, s: 'C' }]);
  assert.equal(s.lastPlay.playerIdx, 0);
  assert.deepEqual(s.lastPlay.cards, [{ r: 6, s: 'C' }]);
  assert.equal(s.lastPlay.healthBefore, 20);
  assert.equal(s.lastPlay.healthAfter, 8, 'clubs double the 6 damage to 12');
  assert.equal(s.lastPlay.attackBefore, 10);
  assert.equal(s.lastPlay.attackAfter, 10, 'no spades played — strike unchanged');

  assert.equal(s.phase, 'discard');
  discardForDamage(s, 0, [{ r: 10, s: 'S' }]);
  assert.equal(s.lastPlay, null, 'a non-play action clears the play snapshot');
  assert.deepEqual(s.lastSacrifice, { playerIdx: 0, cards: [{ r: 10, s: 'S' }] });

  // and a play clears the sacrifice snapshot right back
  assert.equal(s.current, 1);
  rig(s, { hands: [[], [{ r: 2, s: 'H' }]] });
  playCards(s, 1, [{ r: 2, s: 'H' }]);
  assert.equal(s.lastSacrifice, null, 'a play action clears the sacrifice snapshot');
});

test('a sacrifice that immediately dooms the next citoyen still leaves lastSacrifice set, for client animation', () => {
  const s = newGame(names2, { seed: 12 });
  rig(s, {
    hands: [[{ r: 2, s: 'D' }, { r: 10, s: 'S' }], []], // player 1 already holds nothing
    enemy: { r: 'J', s: 'H' },
  });
  s.regroupsRemaining = 0;       // no safety net when their turn comes up
  s.players[1].laidLow = true;   // and they have already ducked this royal
  playCards(s, 0, [{ r: 2, s: 'D' }]); // survives, so player 0 takes the strike
  assert.equal(s.phase, 'discard');
  assert.equal(s.pendingDamage, 10);
  discardForDamage(s, 0, [{ r: 10, s: 'S' }]);
  assert.equal(s.phase, 'lost', 'player 1 has no cards and cannot lie low');
  assert.deepEqual(s.lastSacrifice, { playerIdx: 0, cards: [{ r: 10, s: 'S' }] },
    'the snapshot survives the loss so the client can still animate the sacrifice before the loss screen');
});

test('a shared Pamphleteer breaks immunity for zero damage and leaves the turn intact', () => {
  const s = newGame(['Danton'], { seed: 9 });
  rig(s, {
    hands: [[{ r: 6, s: 'S' }, { r: 5, s: 'H' }]],
    enemy: { r: 'J', s: 'S' },
  });
  usePamphleteer(s, 0);
  assert.equal(s.phase, 'play');
  assert.equal(s.enemy.immunityCancelled, true);
  assert.equal(s.enemy.damage, 0);
  assert.equal(s.current, 0);
  assert.equal(s.pamphleteersRemaining, 1, 'alone, one of the two Pamphleteers is spent');
  playCards(s, 0, [{ r: 6, s: 'S' }]);
  assert.equal(currentShield(s), 6, 'immunity broken — shield works vs Spades Jack');
  assert.equal(s.pendingDamage, 4);
});

test('lying low skips the strike as well as the attack, once per citoyen per tier', () => {
  const s = newGame(names3, { seed: 10 });
  rig(s, {
    hands: [
      [{ r: 2, s: 'H' }, { r: 9, s: 'H' }, { r: 9, s: 'D' }],
      [{ r: 3, s: 'H' }, { r: 8, s: 'H' }, { r: 8, s: 'D' }],
      [{ r: 4, s: 'H' }, { r: 7, s: 'H' }, { r: 7, s: 'D' }],
    ],
    enemy: { r: 'J', s: 'S' },
  });
  yieldTurn(s, 0);
  assert.equal(s.phase, 'play', 'the royal finds nobody to strike');
  assert.equal(s.current, 1, 'and the turn simply passes on');
  assert.equal(s.players[0].hand.length, 3, 'nothing was paid for it');
  assert.equal(s.discard.length, 0);

  yieldTurn(s, 1);
  yieldTurn(s, 2);
  assert.equal(s.current, 0, 'the whole table may duck a royal once');
  assert.equal(canYield(s, 0), false, 'but no citoyen twice');
  assert.throws(() => yieldTurn(s, 0), /already lain low/);
});

test('Lay Low refreshes at Queens and Kings, not at every royal', () => {
  const s = newGame(names2, { seed: 110 });
  rig(s, {
    hands: [[{ r: 2, s: 'H' }, { r: 10, s: 'C' }], [{ r: 3, s: 'H' }, { r: 4, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  yieldTurn(s, 0);
  yieldTurn(s, 1);
  assert.equal(canYield(s, 0), false);

  playCards(s, 0, [{ r: 2, s: 'H' }]);        // 2 damage, then suffer 10
  discardForDamage(s, 0, [{ r: 10, s: 'C' }]);
  assert.equal(canYield(s, 1), false, 'attacking is not how the right comes back');

  // Fell a Jack: another Officer does not restore Lay Low.
  s.players[1].hand.push({ r: 9, s: 'C' });
  s.enemy.damage = 11;
  playCards(s, 1, [{ r: 9, s: 'C' }]);        // 9 clubs doubled = 18 → overkill
  assert.equal(s.enemy.card.r, 'J', 'a fresh royal is on the table');
  assert.ok(s.players.every(p => p.laidLow), 'the spent right remains spent within Officers');

  // Make this the fourth Officer; entering Queens restores the right.
  s.castle = [{ r: 'K', s: 'S' }, { r: 'Q', s: 'D' }];
  s.players[0].hand = [{ r: 10, s: 'C' }];
  s.current = 0;
  s.enemy.damage = 1;
  playCards(s, 0, [{ r: 10, s: 'C' }]);
  assert.equal(s.enemy.card.r, 'Q');
  assert.ok(s.players.every(p => !p.laidLow), 'entering Queens restores Lay Low');
  assert.equal(canYield(s, 1), true);
});

test('exact kill claims the royal for the slayer’s hand; overkill removes it; the turn passes on', () => {
  const s = newGame(names2, { seed: 11, rules: { drawOnVictory: 0 } });
  rig(s, {
    hands: [[{ r: 10, s: 'C' }, { r: 2, s: 'H' }], [{ r: 3, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 10, s: 'C' }]); // 10 clubs = 20 = exactly Jack health
  assert.equal(s.players[0].hand.at(-1).r, 'J', 'Jack joins the slayer’s hand');
  assert.ok(!s.tavern.some(c => c.r === 'J'), 'and not the deck');
  assert.equal(s.enemy.card.r, 'J', 'next enemy revealed is another Jack');
  assert.equal(s.current, 1, 'the next citoyen faces the newcomer');
  assert.equal(s.phase, 'play');
  assert.equal(s.enemy.damage, 0);
  assert.equal(currentShield(s), 0, 'played cards cleared');
  assert.deepEqual(s.lastEvent.playedCards, [{ r: 10, s: 'C' }], 'defeat event retains the public In Play cards for the client animation');
  // the played 10C went to discard
  assert.ok(s.discard.some(c => c.r === 10 && c.s === 'C'));
});

test('Heart and Diamond powers resolve on a killing blow before the royal is defeated', () => {
  const hearts = newGame(names2, { seed: 111, rules: { drawOnVictory: 0, handSizeDelta: 1 } });
  rig(hearts, {
    hands: [[{ r: 10, s: 'H' }], []],
    enemy: { r: 'J', s: 'S' },
  });
  hearts.enemy.damage = 10;
  const handsBefore = hearts.players.reduce((sum, player) => sum + player.hand.length, 0);
  playCards(hearts, 0, [{ r: 10, s: 'H' }]);
  const handsAfter = hearts.players.reduce((sum, player) => sum + player.hand.length, 0);
  // Ten recruited, and the won-over royal on top of them — Rally held the
  // slayer one short of their limit so the royal would have a slot to land in.
  assert.equal(handsAfter - (handsBefore - 1), 11, 'Rally recruits before the killing blow resolves');
  assert.deepEqual(hearts.lastEffects, { healed: 0, drawn: 10 });
  assert.deepEqual(hearts.players[0].hand.at(-1), { r: 'J', s: 'S' }, 'exactly defeated royal joins the hand after Rally');

  const diamonds = newGame(names2, { seed: 112, rules: { drawOnVictory: 0 } });
  rig(diamonds, {
    hands: [[{ r: 10, s: 'D' }], []],
    enemy: { r: 'J', s: 'S' },
    discard: [{ r: 2, s: 'C' }, { r: 3, s: 'H' }, { r: 4, s: 'S' }],
  });
  diamonds.enemy.damage = 10;
  const tavernBefore = diamonds.tavern.length;
  playCards(diamonds, 0, [{ r: 10, s: 'D' }]);
  assert.deepEqual(diamonds.lastEffects, { healed: 3, drawn: 0 });
  assert.equal(diamonds.tavern.length, tavernBefore + 3, 'three prisoners return to the reshuffled Le Peuple');
  assert.deepEqual(diamonds.players[0].hand.at(-1), { r: 'J', s: 'S' }, 'the royal is claimed after the Raid resolves');
  assert.deepEqual(diamonds.discard, [{ r: 10, s: 'D' }], 'the killing card is discarded only after Raid');
});

test('a captured royal in hand attacks at 10/15/20 with live suit power', () => {
  const s = newGame(names2, { seed: 12 });
  rig(s, {
    hands: [[{ r: 'Q', s: 'S' }, { r: 2, s: 'H' }], [{ r: 3, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 'Q', s: 'S' }]);
  assert.equal(s.enemy.damage, 15);
  assert.equal(currentShield(s), 15, 'queen’s spades power shields 15');
  assert.equal(s.phase, 'play', '15 shield vs 10 attack — no suffering');
});

test('loss when a player cannot satisfy damage', () => {
  const s = newGame(names2, { seed: 13 });
  s.regroupsRemaining = 0;
  rig(s, {
    hands: [[{ r: 2, s: 'H' }, { r: 3, s: 'C' }], [{ r: 4, s: 'H' }]],
    enemy: { r: 'K', s: 'H' },
  });
  playCards(s, 0, [{ r: 2, s: 'H' }]); // King strikes 20, hand value 3 — dead
  assert.equal(s.phase, 'lost');
  assert.ok(s.result.reason.includes('Danton'));
});

test('an empty hand is saved by lying low, and lost once that duck is spent', () => {
  const s = newGame(names2, { seed: 15 });
  rig(s, {
    hands: [
      [{ r: 5, s: 'S' }, { r: 5, s: 'C' }],
      [],
    ],
    enemy: { r: 'J', s: 'H' },
  });
  s.tavern = [];          // nothing to refill with
  s.regroupsRemaining = 0; // and no Regroup to fall back on
  playCards(s, 0, [{ r: 5, s: 'S' }]); // shield 5, suffer 5
  discardForDamage(s, 0, [{ r: 5, s: 'C' }]);

  assert.equal(s.current, 1);
  assert.equal(s.phase, 'play', 'an empty hand is not yet a loss — the duck is still there');
  assert.equal(canYield(s, 1), true);
  yieldTurn(s, 1);
  assert.equal(s.phase, 'play', 'and it costs them nothing');

  // Both citoyens are now empty-handed; each may duck exactly once.
  assert.equal(s.current, 0);
  yieldTurn(s, 0);
  assert.equal(s.phase, 'lost', 'back to a citoyen with no cards and no duck left');
});

test('solo: regroup resets the deck, refills to 5, spends the pool; Lay Low is never available', () => {
  const s = newGame(['Citoyen'], { seed: 16, rules: TABLE_REGROUP });
  assert.equal(s.players[0].hand.length, 5);
  rig(s, { enemy: { r: 'J', s: 'H' }, discard: [{ r: 4, s: 'H' }, { r: 5, s: 'H' }] });
  const redealPool = s.tavern.length + s.players[0].hand.length;
  regroup(s, 0);
  assert.equal(s.players[0].hand.length, 5);
  assert.equal(s.discard.length, 2, 'La Prison stays put');
  assert.equal(s.tavern.length + 5, redealPool, 'every returned hand card remains in the redeal pool');
  assert.equal(s.regroupsRemaining, 1);
  assert.equal(s.regroupsUsed, 1);
  assert.deepEqual(
    { type: s.lastEvent.type, playerIdx: s.lastEvent.playerIdx, viaAssembly: s.lastEvent.viaAssembly },
    { type: 'regroup', playerIdx: 0, viaAssembly: false },
    'the client can animate the solo La Retraite card once',
  );
  assert.throws(() => callAssembly(s, 0), /no Assemblée to convene alone/i);
  // Lying low only ever helps by passing the turn to someone else, so solo never offers it.
  assert.equal(canYield(s, 0), false, 'solo can never lie low — there is no one else to pass the turn to');
  assert.throws(() => yieldTurn(s, 0), /cannot lie low/);
});

test('two-player: l’Assemblée carries a Regroup, which resets the deck for the whole table', () => {
  const s = newGame(names2, { seed: 42, rules: { regroups: 2 } });
  const partnerHand = [{ r: 9, s: 'H' }, { r: 8, s: 'D' }];
  rig(s, {
    hands: [[{ r: 2, s: 'C' }], partnerHand],
    enemy: { r: 'J', s: 'H' },
    discard: [{ r: 4, s: 'H' }, { r: 5, s: 'H' }],
  });
  s.tavern = Array.from({ length: 20 }, (_, i) => ({ r: 2 + (i % 9), s: 'S' }));
  const pool = 20 + 0 + 2; // Le Peuple and both hands (La Prison and the 2♣ in play stay put)

  playCards(s, 0, [{ r: 2, s: 'C' }]); // 4 damage, the Jack lives — and strikes back
  assert.equal(s.phase, 'discard', 'a Regroup may still rescue an otherwise fatal hand');
  assert.throws(() => regroup(s, 0), /needs l’Assemblée’s consent/, 'no unilateral Regroup at a table');

  callAssembly(s, 0);
  assert.equal(s.assembly.caller, 0);
  assert.deepEqual(s.assembly.voters, [1]);
  assert.equal(viewFor(s, 1).assembly.youMayVote, true);
  assert.equal(viewFor(s, 0).assembly.youMayVote, false, 'the mover does not vote on their own motion');
  assert.throws(() => yieldTurn(s, 0), /Assemblée is in session/, 'the board is frozen while the floor debates');
  castVote(s, 1, true);

  assert.equal(s.assembly, null);
  assert.equal(s.players[0].hand.length, 5, 'the mover refills to the two-player hand limit');
  assert.equal(s.players[1].hand.length, 5, 'and so does everyone else');
  assert.equal(s.discard.length, 2, 'La Prison stays put');
  assert.equal(s.tavern.length + 10, pool, 'every hand card and Peuple card remains accounted for');
  assert.deepEqual(s.discard, [{ r: 4, s: 'H' }, { r: 5, s: 'H' }]);
  assert.equal(s.regroupsRemaining, 1, 'one spent from the shared pool of two');
  assert.equal(s.regroupsUsed, 1);
  assert.deepEqual(
    { type: s.lastEvent.type, playerIdx: s.lastEvent.playerIdx, viaAssembly: s.lastEvent.viaAssembly },
    { type: 'regroup', playerIdx: 0, viaAssembly: true },
    'a carried motion identifies the special card and mover for animation',
  );
});

test('a Regroup leaves the cards already committed against the royal in play', () => {
  const s = newGame(names2, { seed: 142, rules: TABLE_REGROUP });
  rig(s, {
    hands: [[{ r: 10, s: 'S' }], [{ r: 9, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 10, s: 'S' }]); // a barricade of 10 blocks the Jack entirely
  assert.equal(s.current, 1, 'no blow to suffer, so the turn simply passes');
  callAssembly(s, 1);
  castVote(s, 0, true);

  assert.deepEqual(s.playedCombos.flatMap(c => c.cards), [{ r: 10, s: 'S' }], 'In Play is untouched');
  assert.equal(currentShield(s), 10, 'and the barricade it built still stands');
  assert.equal(s.enemy.damage, 10, 'the fight itself carries on where it left off');
});

test('a rejected motion spends nothing', () => {
  const s = newGame(names3, { seed: 43 });
  rig(s, { hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  s.regroupsRemaining = 2;
  const handBefore = [...s.players[0].hand];

  callAssembly(s, 0);
  castVote(s, 1, false);
  assert.ok(s.assembly, 'every connected citoyen answers before the tally');
  castVote(s, 2, false);

  assert.equal(s.assembly, null);
  assert.equal(s.regroupsRemaining, 2, 'a fallen motion costs nothing');
  assert.equal(s.regroupsUsed, 0);
  assert.deepEqual(s.players[0].hand, handBefore);
});

test('a resolved motion leaves its finished tally on the view', () => {
  // The deciding vote and the resolution land in the same action, so no view
  // ever carries an assembly holding it. Without lastAssemblyResult the client
  // could not show the floor how its own vote finished.
  const s = newGame(names3, { seed: 43 });
  rig(s, { hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  s.regroupsRemaining = 2;
  assert.equal(viewFor(s, 0).lastAssemblyResult, null, 'nothing to report before a motion');

  callAssembly(s, 0);
  castVote(s, 1, true);
  castVote(s, 2, false);

  const res = viewFor(s, 2).lastAssemblyResult;
  assert.equal(s.assembly, null);
  assert.equal(res.kind, 'regroup');
  assert.equal(res.caller, 0);
  assert.equal(res.carried, true, '2–1 carries');
  assert.equal(res.ayes, 2);
  assert.equal(res.seated, 3);
  assert.deepEqual(res.votes, { 1: true, 2: false }, 'the deciding vote survives the resolution');
  assert.deepEqual(viewFor(s, 0).lastAssemblyResult, res, 'every seat is told the same tally');

  // The client identifies a motion solely by seq, so two must never collide.
  callAssembly(s, 0);
  castVote(s, 1, true);
  castVote(s, 2, true);
  assert.notEqual(viewFor(s, 2).lastAssemblyResult.seq, res.seq, 'a second motion is distinguishable');

  // A fallen motion is reported just as fully as one that carries.
  const fell = newGame(names3, { seed: 43 });
  rig(fell, { hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  fell.regroupsRemaining = 2;
  callAssembly(fell, 0);
  castVote(fell, 1, false);
  castVote(fell, 2, false);
  const lost = viewFor(fell, 1).lastAssemblyResult;
  assert.equal(lost.carried, false);
  assert.equal(lost.ayes, 1, 'the mover is still their own aye');
  assert.deepEqual(lost.votes, { 1: false, 2: false });
});

test('the mover is an automatic aye and needs a strict majority of the connected table', () => {
  // 3 at the table: mover plus one aye carries it (2 of 3).
  const three = newGame(names3, { seed: 44 });
  rig(three, { hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  three.regroupsRemaining = 1;
  callAssembly(three, 0);
  castVote(three, 1, true);
  castVote(three, 2, false);
  assert.equal(three.regroupsUsed, 1, '2–1 carries');

  // 4 at the table: mover plus one is only 2 of 4, which is not a majority.
  const four = newGame(names4, { seed: 45 });
  rig(four, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }], [{ r: 5, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  four.regroupsRemaining = 1;
  callAssembly(four, 0);
  castVote(four, 1, true);
  castVote(four, 2, false);
  castVote(four, 3, false);
  assert.equal(four.regroupsUsed, 0, '2–2 is a tie and the motion falls');
});

test('a citoyen who drops mid-vote leaves the floor entirely, and a lost mover dissolves the motion', () => {
  const s = newGame(names4, { seed: 46 });
  rig(s, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }], [{ r: 5, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  s.regroupsRemaining = 2;

  callAssembly(s, 0, [0, 1, 2, 3]);
  castVote(s, 1, true);
  // Seats 2 and 3 drop: the motion must not hang waiting on them. Mover plus one
  // aye out of a two-seat floor carries.
  syncAssembly(s, [0, 1]);
  assert.equal(s.assembly, null);
  assert.equal(s.regroupsUsed, 1);

  callAssembly(s, 0, [0, 1, 2]);
  syncAssembly(s, [1, 2]); // the mover themselves drops
  assert.equal(s.assembly, null, 'the motion dies with its mover');
  assert.equal(s.regroupsUsed, 1, 'and spends nothing');
});

test('Pamphleteers are zero-value shared resources and cannot be played from a hand', () => {
  const s = newGame(names3, { seed: 17 });
  rig(s, {
    hands: [[{ r: 'X', s: null }, { r: 5, s: 'H' }], [{ r: 2, s: 'C' }], [{ r: 2, s: 'D' }]],
    enemy: { r: 'J', s: 'H' },
  });
  assert.match(validatePlay(s, 0, [{ r: 'X', s: null }]), /shared resource/);
  assert.match(validatePlay(s, 0, [{ r: 'X', s: null }, { r: 5, s: 'H' }]), /shared resource/);
  assert.equal(cardValue({ r: 'X', s: null }), 0);
});

test('preview matches immunity context', () => {
  const s = newGame(names2, { seed: 18 });
  rig(s, {
    hands: [[{ r: 7, s: 'C' }], [{ r: 2, s: 'H' }]],
    enemy: { r: 'J', s: 'C' },
  });
  let p = previewPlay(s, [{ r: 7, s: 'C' }]);
  assert.equal(p.damage, 7, 'no doubling vs clubs enemy');
  assert.deepEqual(p.immuneSuits, ['C']);
  s.enemy.immunityCancelled = true;
  p = previewPlay(s, [{ r: 7, s: 'C' }]);
  assert.equal(p.damage, 14, 'doubling once immunity is broken');
});

test('full game is winnable end-to-end (scripted exact plays)', () => {
  const s = newGame(names2, { seed: 19 });
  // brute-force play: always throw the biggest legal single card, discard greedily.
  let guard = 500;
  while (s.phase !== 'won' && s.phase !== 'lost' && guard-- > 0) {
    if (s.phase === 'play') {
      const p = s.players[s.current];
      const nonJester = p.hand.filter(c => c.r !== 'X');
      if (nonJester.length === 0) {
        if (canYield(s, s.current)) { yieldTurn(s, s.current); continue; }
        if (p.hand.length) { playCards(s, s.current, [p.hand[0]]); continue; }
        break;
      }
      const best = nonJester.sort((a, b) => cardValue(b) - cardValue(a))[0];
      playCards(s, s.current, [best]);
    } else if (s.phase === 'discard') {
      const p = s.players[s.current];
      const totalHand = p.hand.reduce((sum, card) => sum + cardValue(card), 0);
      if (totalHand < s.pendingDamage && viewFor(s, s.current).regroupsRemaining > 0) {
        callAssembly(s, s.current);
        castVote(s, (s.current + 1) % s.playerCount, true);
        continue;
      }
      const sorted = [...p.hand].sort((a, b) => cardValue(b) - cardValue(a));
      const chosen = []; let tot = 0;
      for (const c of sorted) { if (tot >= s.pendingDamage) break; chosen.push(c); tot += cardValue(c); }
      discardForDamage(s, s.current, chosen);
    }
  }
  assert.ok(['won', 'lost'].includes(s.phase), 'game terminates');
  const v = viewFor(s, 0);
  assert.ok(!('log' in v), 'the private game journal is not exposed for lookup');
});

// ---- La Constitution (house rules) -----------------------------------------

test('rules resolve from partial and hostile input; difficulty sets royal power', () => {
  const medium = {
    difficulty: 'medium', drawOnVictory: 0, transitionDraw: 1, regroups: 1, regroupOnTransition: 0,
    regroupTierReset: 1, regroupDraw: 2,
    royalStrikeBonus: 0, royalHealthBonus: 0, regroupScope: 'table', handSizeDelta: 0, pamphleteers: 2,
    exactKillTo: 'hand', pamphleteerImmune: true, pamphleteerCompanion: false,
  };
  assert.deepEqual(resolveRules(null, 3), { ...medium, regroupDraw: 3 });
  assert.deepEqual(
    resolveRules(null, 1),
    { ...medium, drawOnVictory: 2, regroupDraw: 3 },
    'alone gets two Pamphleteers, per-royal Spoils, a transition draw, and a Regroup that refreshes',
  );
  assert.deepEqual(
    resolveRules(null, 2),
    medium,
    'two citoyens retain the table-wide Regroup with its legacy draw setting',
  );
  assert.deepEqual(
    resolveRules(null, 4),
    { ...medium, regroupDraw: 3, royalHealthBonus: 5 },
    'four citoyens have one Regroup and tougher royals',
  );

  // Difficulty changes royal power without moving the Regroup rules.
  assert.deepEqual(
    resolveRules({ difficulty: 'hard' }, 3),
    { ...medium, difficulty: 'hard', regroupDraw: 3, royalStrikeBonus: 2 },
  );
  assert.deepEqual(
    resolveRules({ difficulty: 'easy' }, 3),
    { ...medium, difficulty: 'easy', regroupDraw: 3, royalStrikeBonus: -2 },
  );
  // The study may still name the underlying value directly.
  assert.equal(resolveRules({ difficulty: 'easy', royalStrikeBonus: 4 }, 3).royalStrikeBonus, 4);
  const hardGame = newGame(names2, { seed: 501, rules: { difficulty: 'hard' } });
  const easyGame = newGame(names2, { seed: 501, rules: { difficulty: 'easy' } });
  assert.equal(enemyAttack(hardGame), 12, 'Hard adds two to an Officer’s strike');
  assert.equal(enemyAttack(easyGame), 8, 'Easy removes two from an Officer’s strike');

  const wild = resolveRules({ regroups: 99, pamphleteers: -5, handSizeDelta: 7 }, 2);
  assert.equal(wild.regroups, 3);
  assert.equal(wild.pamphleteers, 0);
  assert.equal(wild.handSizeDelta, 1);
  assert.equal(resolveRules({ handSizeDelta: '-1' }, 2).handSizeDelta, -1, 'numeric strings survive the form');

  // Rules the register does not recognise are dropped, whatever a stale client sends.
  assert.deepEqual(resolveRules({ afterKill: 'choose', jesterCancels: 'never' }, 3), { ...medium, regroupDraw: 3 });
  // A named rule only accepts its own vocabulary.
  assert.equal(resolveRules({ exactKillTo: 'guillotine' }, 2).exactKillTo, 'hand');
  assert.equal(resolveRules({ pamphleteerImmune: 'no' }, 2).pamphleteerImmune, true);
  assert.equal(resolveRules({ difficulty: 'impossible' }, 2).difficulty, 'medium');
  assert.equal(resolveRules({ regroupDraw: 9 }, 2).regroupDraw, 4, 'a draw beyond four is pointless and clamps');
});

test('an exact kill can be sent atop Le Peuple instead of into the slayer’s hand', () => {
  const rigExact = rules => {
    const s = newGame(names2, { seed: 60, rules: { drawOnVictory: 0, ...rules } });
    // A Jack of ♦ has 20 health. Two 10s take it exactly — and against a ♦ royal
    // neither the spade nor the diamond power fires, so nothing else moves.
    rig(s, { hands: [[{ r: 10, s: 'D' }, { r: 10, s: 'S' }, { r: 3, s: 'H' }], []], enemy: { r: 'J', s: 'D' } });
    return s;
  };
  const toHand = rigExact({ exactKillTo: 'hand' });
  const before = toHand.tavern.length;
  playCards(toHand, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'D' }]);
  assert.ok(toHand.players[0].hand.some(c => c.r === 'J' && c.s === 'D'), 'the royal joins the hand');
  assert.equal(toHand.tavern.length, before, 'Le Peuple is untouched');

  const toPeuple = rigExact({ exactKillTo: 'peuple' });
  const beforeP = toPeuple.tavern.length;
  playCards(toPeuple, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'D' }]);
  assert.ok(!toPeuple.players[0].hand.some(c => c.r === 'J'), 'the slayer keeps nothing');
  assert.equal(toPeuple.tavern.length, beforeP + 1);
  assert.deepEqual(toPeuple.tavern[toPeuple.tavern.length - 1], { r: 'J', s: 'D' }, 'face down on top, drawn next');
  assert.ok(!toPeuple.discard.some(c => c.r === 'J'), 'and not to La Prison');
});

test('the spoils are gathered before a royal is laid on Le Peuple, not after', () => {
  // Otherwise the table draws the royal straight back and the rule means nothing.
  const s = newGame(names3, { seed: 74, rules: { exactKillTo: 'peuple', drawOnVictory: 2, royalHealthBonus: 0 } });
  rig(s, {
    hands: [[{ r: 10, s: 'S' }, { r: 10, s: 'D' }], [], []],
    enemy: { r: 'J', s: 'D' },
  });
  playCards(s, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'D' }]);
  assert.deepEqual(s.tavern.at(-1), { r: 'J', s: 'D' }, 'the royal sits on top, waiting');
  for (const p of s.players) {
    assert.ok(!p.hand.some(c => c.r === 'J'), 'and nobody drew it as a spoil');
  }
});

test('Rally holds a slot for the claimed royal only when the hand is where it goes', () => {
  // 20 damage exactly on a Jack, dealt with hearts so Rally draws in the same play.
  const build = rules => {
    const s = newGame(names2, { seed: 61, rules: { drawOnVictory: 0, ...rules } });
    rig(s, { hands: [[{ r: 10, s: 'H' }, { r: 10, s: 'S' }], []], enemy: { r: 'J', s: 'C' } });
    return s;
  };
  const toHand = build({ exactKillTo: 'hand' });
  playCards(toHand, 0, [{ r: 10, s: 'H' }, { r: 10, s: 'S' }]);
  assert.equal(toHand.players[0].hand.length, toHand.handSize, 'Rally drew one short to leave the royal room');
  assert.ok(toHand.players[0].hand.some(c => c.r === 'J'));

  const toPeuple = build({ exactKillTo: 'peuple' });
  playCards(toPeuple, 0, [{ r: 10, s: 'H' }, { r: 10, s: 'S' }]);
  assert.equal(toPeuple.players[0].hand.length, toPeuple.handSize, 'no slot to hold open, so Rally fills the hand');
});

test('the Spoils of Victory deal every citoyen a share, never past the hand limit', () => {
  const s = newGame(names3, { seed: 62, rules: { drawOnVictory: 2 } });
  // The mob doubles two 10s into 40 — an overkill, so the royal leaves play
  // and nothing but the spoils moves through Le Peuple.
  rig(s, {
    hands: [[{ r: 10, s: 'S' }, { r: 10, s: 'C' }], [{ r: 4, s: 'S' }], []],
    enemy: { r: 'J', s: 'D' },
  });
  const peuple = s.tavern.length;
  playCards(s, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'C' }]);
  assert.equal(s.players[0].hand.length, 2, 'the slayer spent two and drew two back');
  assert.equal(s.players[1].hand.length, 3);
  assert.equal(s.players[2].hand.length, 2);
  assert.equal(s.tavern.length, peuple - 6);
  assert.equal(s.lastEvent.spoilsDrawn, 6);
  assert.deepEqual(s.lastEvent.spoilsByPlayer, [2, 2, 2]);
  assert.ok(!s.discard.some(c => c.r === 'J'), 'the overkilled royal is removed, not imprisoned');

  const full = newGame(names2, { seed: 63, rules: { drawOnVictory: 2 } });
  rig(full, { hands: [[{ r: 10, s: 'S' }, { r: 10, s: 'C' }], []], enemy: { r: 'J', s: 'D' } });
  full.players[1].hand = Array.from({ length: full.handSize }, () => ({ r: 2, s: 'S' }));
  const before = full.tavern.length;
  playCards(full, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'C' }]);
  assert.equal(full.players[1].hand.length, full.handSize, 'a full hand draws nothing');
  assert.equal(full.tavern.length, before - 2, 'only the emptied slayer draws');
});

test('tier transitions raise the hand limit before rewards and deal each table its transition card', () => {
  const solo = newGame(['Citoyen'], { seed: 168 });
  solo.regroupsRemaining = 0; // the opening Regroup has already been spent
  rig(solo, {
    hands: [[{ r: 2, s: 'C' }, { r: 3, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  solo.castle = [{ r: 'K', s: 'S' }, { r: 'Q', s: 'D' }];
  solo.enemy.damage = 19;
  playCards(solo, 0, [{ r: 2, s: 'C' }]);
  assert.equal(solo.handSize, 6);
  assert.equal(solo.regroupsRemaining, 1, 'entering Queens hands the spent Regroup back');
  assert.equal(solo.lastEvent.transition.regroupsGained, 1);
  assert.equal(solo.lastEvent.transition.drawn, 1, 'alone, the tier draws one extra card');
  assert.equal(solo.lastEvent.spoilsDrawn, 2, 'the per-royal Spoils remain two cards');
  assert.equal(solo.players[0].hand.length, 4, 'one card kept back, plus two Spoils and the transition card');

  // The Regroup refreshes rather than accumulates: an untouched pool is left
  // where it is, so nothing is banked for the Kings by holding on to it.
  rig(solo, { hands: [[{ r: 2, s: 'C' }]], enemy: { r: 'Q', s: 'H' } });
  solo.castle = [{ r: 'K', s: 'S' }];
  solo.enemy.damage = 29;
  playCards(solo, 0, [{ r: 2, s: 'C' }]);
  assert.equal(solo.handSize, 7);
  assert.equal(solo.regroupsRemaining, 1, 'an unspent Regroup does not bank into Kings');
  assert.equal(solo.lastEvent.transition.regroupsGained, 0);

  const two = newGame(names2, { seed: 166 });
  two.regroupsRemaining = 0;
  rig(two, {
    hands: [[{ r: 2, s: 'C' }, { r: 3, s: 'H' }], [{ r: 4, s: 'S' }]],
    enemy: { r: 'J', s: 'H' },
  });
  two.castle = [{ r: 'K', s: 'S' }, { r: 'Q', s: 'D' }];
  two.enemy.damage = 19;
  playCards(two, 0, [{ r: 2, s: 'C' }]);
  assert.equal(two.handSize, 6, 'the Queen limit is active before rewards');
  assert.equal(two.regroupsRemaining, 1, 'the shared Regroup is restored for Queens');
  assert.equal(two.lastEvent.transition.regroupsGained, 1);
  assert.deepEqual(two.lastEvent.spoilsByPlayer, [0, 0]);
  assert.deepEqual(two.lastEvent.transition.byPlayer, [1, 1]);
  assert.deepEqual(two.players.map(p => p.hand.length), [2, 2]);

  const three = newGame(names3, { seed: 167 });
  rig(three, {
    hands: [[{ r: 2, s: 'C' }, { r: 3, s: 'H' }], [{ r: 4, s: 'S' }], [{ r: 5, s: 'D' }]],
    enemy: { r: 'J', s: 'H' },
  });
  three.castle = [{ r: 'K', s: 'S' }, { r: 'Q', s: 'D' }];
  three.enemy.damage = 24;
  playCards(three, 0, [{ r: 2, s: 'C' }]);
  assert.equal(three.handSize, 5);
  assert.deepEqual(three.lastEvent.spoilsByPlayer, [0, 0, 0]);
  assert.equal(three.lastEvent.transition.drawn, 3, 'larger tables receive one tier Spoil each');
  assert.deepEqual(three.players.map(p => p.hand.length), [2, 2, 2]);
});

test('an exact-kill royal is the slayer’s spoil, not an extra card', () => {
  const s = newGame(names3, { seed: 164, rules: { drawOnVictory: 1, royalHealthBonus: 0 } });
  rig(s, {
    hands: [[{ r: 10, s: 'S' }, { r: 10, s: 'D' }], [], []],
    enemy: { r: 'J', s: 'D' },
  });
  const before = s.tavern.length;
  playCards(s, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'D' }]);
  assert.ok(s.players[0].hand.some(c => c.r === 'J' && c.s === 'D'), 'the royal pays the slayer’s share');
  assert.equal(s.players[0].hand.length, 1, 'the slayer draws no extra spoil');
  assert.equal(s.players[1].hand.length, 1, 'the next citoyen still receives a spoil');
  assert.equal(s.players[2].hand.length, 1, 'the last citoyen still receives a spoil');
  assert.equal(s.tavern.length, before - 2, 'only the other two shares come from Le Peuple');
  assert.equal(s.lastEvent.spoilsDrawn, 2);
  assert.deepEqual(s.lastEvent.spoilsByPlayer, [0, 1, 1], 'the client can animate each real spoil after the guillotine');

  const solo = newGame(['Citoyen'], { seed: 165, rules: { drawOnVictory: 1 } });
  rig(solo, { hands: [[{ r: 10, s: 'S' }, { r: 10, s: 'D' }]], enemy: { r: 'J', s: 'D' } });
  const soloBefore = solo.tavern.length;
  playCards(solo, 0, [{ r: 10, s: 'S' }, { r: 10, s: 'D' }]);
  assert.equal(solo.players[0].hand.length, 1, 'solo receives the royal and nothing else');
  assert.equal(solo.tavern.length, soloBefore, 'solo takes no extra card from Le Peuple');
  assert.equal(solo.lastEvent.spoilsDrawn, 0);
  assert.deepEqual(solo.lastEvent.spoilsByPlayer, [0]);
});

test('multiplayer Pamphleteers require a strict-majority vote and spend nothing when rejected', () => {
  const carried = newGame(names3, { seed: 64 });
  rig(carried, { hands: [[{ r: 8, s: 'C' }], [], []], enemy: { r: 'J', s: 'C' } });
  callPamphleteerAssembly(carried, 0);
  assert.equal(carried.assembly.kind, 'pamphleteer');
  castVote(carried, 1, true);
  castVote(carried, 2, false);
  assert.equal(carried.pamphleteersRemaining, 1, '2–1 carries and spends one');
  assert.equal(carried.enemy.immunityCancelled, true);
  assert.equal(carried.current, 0, 'the mover still has the turn');
  assert.equal(carried.enemy.damage, 0, 'the Pamphleteer deals no damage');
  assert.deepEqual(
    { type: carried.lastEvent.type, playerIdx: carried.lastEvent.playerIdx, viaAssembly: carried.lastEvent.viaAssembly },
    { type: 'pamphleteer', playerIdx: 0, viaAssembly: true },
  );
  playCards(carried, 0, [{ r: 8, s: 'C' }]);
  assert.equal(carried.enemy.damage, 16, 'the subsequent attack uses the broken immunity');

  const rejected = newGame(names4, { seed: 65 });
  callPamphleteerAssembly(rejected, 0);
  castVote(rejected, 1, true);
  castVote(rejected, 2, false);
  castVote(rejected, 3, false);
  assert.equal(rejected.pamphleteersRemaining, 2, 'a 2–2 tie falls and spends nothing');
  assert.equal(rejected.enemy.immunityCancelled, false);
});

test('a Regroup reaches only as far as its scope allows', () => {
  const build = regroupScope => {
    const s = newGame(names3, { seed: 70, rules: { regroupScope, regroups: 2 } });
    rig(s, {
      hands: [[{ r: 2, s: 'S' }], [{ r: 3, s: 'H' }, { r: 4, s: 'H' }], [{ r: 5, s: 'D' }]],
      enemy: { r: 'J', s: 'C' },
      discard: [{ r: 9, s: 'S' }, { r: 9, s: 'H' }, { r: 9, s: 'D' }],
    });
    return s;
  };

  const caller = build('caller');
  const peupleBefore = caller.tavern.length;
  callAssembly(caller, 0);
  castVote(caller, 1, true);
  castVote(caller, 2, true);
  assert.equal(caller.players[0].hand.length, caller.handSize, 'the caller draws a fresh hand');
  assert.deepEqual(caller.players[1].hand, [{ r: 3, s: 'H' }, { r: 4, s: 'H' }], 'nobody else is touched');
  assert.deepEqual(caller.players[2].hand, [{ r: 5, s: 'D' }]);
  assert.equal(caller.discard.length, 3, 'La Prison keeps its prisoners');
  // One card went back to Le Peuple, then a full hand came out of it.
  assert.equal(caller.tavern.length, peupleBefore + 1 - caller.handSize);

  const withPrison = build('callerAndPrison');
  callAssembly(withPrison, 0);
  castVote(withPrison, 1, true);
  castVote(withPrison, 2, true);
  assert.equal(withPrison.players[0].hand.length, withPrison.handSize);
  assert.equal(withPrison.players[1].hand.length, 2, 'still nobody else');
  assert.equal(withPrison.discard.length, 0, 'but La Prison empties into Le Peuple');

  const table = build('table');
  callAssembly(table, 0);
  castVote(table, 1, true);
  castVote(table, 2, true);
  assert.equal(table.discard.length, 3, 'the table-wide rule leaves La Prison untouched');
  for (const q of table.players) assert.equal(q.hand.length, table.handSize, 'the whole table draws afresh');
});

test('at its narrowest a Regroup shuffles nothing — the table simply draws', () => {
  const s = newGame(names3, { seed: 72, rules: { regroupScope: 'draw', regroupDraw: 2, regroups: 2 } });
  rig(s, {
    hands: [[{ r: 2, s: 'S' }], [{ r: 3, s: 'H' }], []],
    enemy: { r: 'J', s: 'C' },
    discard: [{ r: 9, s: 'S' }, { r: 9, s: 'H' }],
  });
  const peuple = s.tavern.length;
  callAssembly(s, 0);
  castVote(s, 1, true);
  castVote(s, 2, true);
  assert.equal(s.players[0].hand.length, 3, 'kept the card they held and took two more');
  assert.ok(s.players[0].hand.some(c => c.r === 2 && c.s === 'S'), 'nothing was shuffled away');
  assert.equal(s.players[1].hand.length, 3);
  assert.equal(s.players[2].hand.length, 2);
  assert.equal(s.tavern.length, peuple - 6);
  assert.equal(s.discard.length, 2, 'La Prison is untouched');
  assert.equal(s.regroupsRemaining, 1, 'and it still costs one from the pool');
});

test('a shared draw never carries a hand past its limit', () => {
  const s = newGame(names2, { seed: 73, rules: { regroupScope: 'draw', regroupDraw: 3, regroups: 1 } });
  s.players[0].hand = [{ r: 2, s: 'S' }];
  s.players[1].hand = Array.from({ length: s.handSize }, () => ({ r: 4, s: 'H' }));
  const peuple = s.tavern.length;
  callAssembly(s, 0);
  castVote(s, 1, true);
  assert.equal(s.players[0].hand.length, 4, 'the empty hand fills');
  assert.equal(s.players[1].hand.length, s.handSize, 'the full hand takes nothing');
  assert.equal(s.tavern.length, peuple - 3);
});

test('a narrow Regroup can fail to save a citoyen that a wide one would', () => {
  // Le Peuple is empty and every card worth having sits in La Prison. Reaching
  // only for your own hand shuffles one card and draws it straight back.
  const build = regroupScope => {
    const s = newGame(names2, { seed: 71, rules: { regroupScope, regroups: 2 } });
    s.tavern = [];
    s.players[0].hand = [{ r: 2, s: 'S' }];
    s.players[1].hand = [{ r: 3, s: 'H' }];
    s.discard = [{ r: 10, s: 'S' }, { r: 10, s: 'H' }, { r: 10, s: 'D' }];
    s.enemy.card = { r: 'J', s: 'C' };
    s.enemy.damage = 0;
    s.phase = 'discard';
    s.pendingDamage = 10;
    s.current = 0;
    return s;
  };

  const narrow = build('caller');
  callAssembly(narrow, 0);
  castVote(narrow, 1, true);
  assert.equal(narrow.phase, 'lost', 'one card back and one card out saves nobody');

  const wide = build('callerAndPrison');
  callAssembly(wide, 0);
  castVote(wide, 1, true);
  assert.equal(wide.phase, 'discard', 'the prisoners returning give a hand worth paying with');
  assert.ok(wide.players[0].hand.length > 1);
});

test('hand size shifts by one from the per-count default', () => {
  assert.equal(newGame(names4, { seed: 50, rules: { handSizeDelta: -1 } }).handSize, 3);
  assert.equal(newGame(names4, { seed: 50, rules: { handSizeDelta: 1 } }).handSize, 5);
  const s = newGame(names2, { seed: 50, rules: { handSizeDelta: 1 } });
  for (const p of s.players) assert.equal(p.hand.length, 6, 'opening hands honour the new limit');
});

test('the Pamphleteer count sets the shared pool; at zero immunity never lifts', () => {
  for (const n of [0, 1, 2, 3]) {
    const s = newGame(names3, { seed: 51, rules: { pamphleteers: n } });
    const all = [...s.tavern, ...s.players.flatMap(p => p.hand)];
    assert.equal(all.filter(c => c.r === 'X').length, 0, 'Pamphleteers never enter Le Peuple');
    assert.equal(s.pamphleteersRemaining, n, `${n} shared Pamphleteers`);
  }
  const none = newGame(names2, { seed: 52, rules: { pamphleteers: 0 } });
  rig(none, { hands: [[{ r: 6, s: 'S' }], [{ r: 2, s: 'C' }]], enemy: { r: 'J', s: 'S' } });
  playCards(none, 0, [{ r: 6, s: 'S' }]);
  assert.equal(currentShield(none), 0, 'no Pamphleteer can ever break a Spade royal’s immunity');
});

test('after a kill the next citoyen always faces the newcomer', () => {
  const s = newGame(names3, { seed: 53 });
  rig(s, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  s.enemy.damage = 24;
  playCards(s, 0, [{ r: 2, s: 'C' }]); // 2 clubs doubled = 4 → overkill
  assert.equal(s.current, 1, 'the turn passes on');
  assert.equal(s.phase, 'play');
  // Not even a stale client can buy the slayer another turn.
  const stale = newGame(names3, { seed: 53, rules: { afterKill: 'slayer' } });
  rig(stale, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  stale.enemy.damage = 24;
  playCards(stale, 0, [{ r: 2, s: 'C' }]);
  assert.equal(stale.current, 1);

  // Alone, "the next citoyen" comes back round to you.
  const solo = newGame(['Citoyen'], { seed: 53 });
  rig(solo, { hands: [[{ r: 2, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  solo.enemy.damage = 19;
  playCards(solo, 0, [{ r: 2, s: 'C' }]);
  assert.equal(solo.current, 0);
  assert.equal(solo.phase, 'play');
});

test('an exact kill always claims the royal for the slayer’s hand, and Rally draws one short to keep its place', () => {
  const setup = () => {
    const s = newGame(names2, { seed: 54, rules: { drawOnVictory: 0 } });
    rig(s, { hands: [[{ r: 10, s: 'H' }], []], enemy: { r: 'J', s: 'S' } });
    s.players[1].hand = Array.from({ length: s.handSize }, (_, i) => ({ r: 2 + i, s: 'C' }));
    s.tavern = Array.from({ length: 12 }, (_, i) => ({ r: 2 + (i % 9), s: 'D' }));
    s.enemy.damage = 10; // 10 hearts lands the last 10 exactly
    return s;
  };

  const toHand = setup();
  assert.equal(toHand.handSize, 5);
  playCards(toHand, 0, [{ r: 10, s: 'H' }]);
  assert.equal(toHand.players[0].hand.length, 5, 'Rally stops at four so the royal fits');
  assert.deepEqual(toHand.players[0].hand.at(-1), { r: 'J', s: 'S' }, 'the royal joins the hand');
  assert.ok(!toHand.tavern.some(c => c.r === 'J'), 'and not the deck');

  // An overkill is not an exact kill, so no slot is held back.
  const over = setup();
  over.enemy.damage = 11;
  playCards(over, 0, [{ r: 10, s: 'H' }]);
  assert.equal(over.players[0].hand.length, 5, 'a full hand from Rally');
  assert.deepEqual(over.discard.at(-1), { r: 10, s: 'H' });
  assert.ok(!over.discard.some(c => c.r === 'J'), 'the guillotined royal is removed from circulation');
});

test('a Pamphleteer cannot be wasted after immunity is already broken', () => {
  const s = newGame(['Citoyen'], { seed: 58, rules: { pamphleteers: 2 } });
  usePamphleteer(s, 0);
  assert.equal(s.pamphleteersRemaining, 1);
  assert.throws(() => usePamphleteer(s, 0), /cannot take the floor/);
  assert.equal(s.pamphleteersRemaining, 1);
});

test('view hides other hands but shows counts', () => {
  const s = newGame(names3, { seed: 20 });
  const v = viewFor(s, 1);
  assert.equal(v.you.index, 1);
  assert.equal(v.you.hand.length, 4);
  assert.equal(v.players[0].handCount, 4);
  assert.ok(!('hand' in v.players[0]));
});

test('a citoyen may surrender the game', () => {
  const s = newGame(names2, { seed: 21 });
  surrenderGame(s, 1);
  assert.equal(s.phase, 'lost');
  assert.match(s.result.reason, /Robespierre surrendered/);
  assert.equal(s.lastEvent.type, 'loss');
});
