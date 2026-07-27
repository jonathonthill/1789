import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, playCards, yieldTurn, discardForDamage, chooseNext, regroup,
  surrenderGame, callAssembly, castVote, syncAssembly,
  validatePlay, validateDiscard, canYield, previewPlay, viewFor,
  currentShield, effectiveEnemyAttack, cardValue, resolveRules,
} from '../shared/engine.js';

const names2 = ['Danton', 'Robespierre'];
const names3 = ['Danton', 'Robespierre', 'Marat'];
const names4 = [...names3, 'Desmoulins'];

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
  for (const [n, jesters, hand] of [[1, 1, 8], [2, 1, 7], [3, 2, 6], [4, 2, 6]]) {
    const s = newGame(names4.slice(0, n), { seed: 1 });
    const all = [...s.tavern, ...s.players.flatMap(p => p.hand)];
    assert.equal(all.filter(c => c.r === 'X').length, jesters, `${n}p jesters`);
    assert.equal(all.filter(c => c.r === 'A').length, 4, `${n}p companions`);
    assert.equal(all.length, 36 + 4 + jesters - 0, `${n}p tavern+hands size`);
    for (const p of s.players) assert.equal(p.hand.length, hand, `${n}p hand size`);
    assert.equal(s.castle.length, 11);
    assert.equal(s.enemy.card.r, 'J', 'first enemy is a Jack');
    // castle order: next 3 are Jacks, then 4 Queens, then 4 Kings (top = end)
    const ranks = [...s.castle].reverse().map(c => c.r);
    assert.deepEqual(ranks, ['J', 'J', 'J', 'Q', 'Q', 'Q', 'Q', 'K', 'K', 'K', 'K']);
    if (n === 1) assert.equal(s.regroupsRemaining, 2);
  }
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

test('Rally recruits cards; companion adds value and both suit powers apply (8H + A-of-clubs = 18 dmg, 9 draws)', () => {
  const s = newGame(names2, { seed: 4 });
  rig(s, {
    hands: [[{ r: 8, s: 'H' }, { r: 'A', s: 'C' }, { r: 9, s: 'S' }], [{ r: 3, s: 'H' }]],
    enemy: { r: 'J', s: 'D' },
  });
  const before = s.players[0].hand.length + s.players[1].hand.length - 2; // minus played
  playCards(s, 0, [{ r: 8, s: 'H' }, { r: 'A', s: 'C' }]);
  assert.equal(s.enemy.damage, 18, 'clubs doubles the combined value 9');
  const after = s.players[0].hand.length + s.players[1].hand.length;
  assert.equal(after - before, Math.min(9, 9), 'drew up to 9 (capped by hand size/tavern)');
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

test('Raid returns prisoners under Le Peuple before Rally recruits', () => {
  const s = newGame(names2, { seed: 5 });
  rig(s, {
    hands: [[{ r: 5, s: 'H' }, { r: 5, s: 'D' }], [{ r: 2, s: 'C' }]],
    enemy: { r: 'J', s: 'C' },
    discard: [{ r: 9, s: 'C' }, { r: 9, s: 'D' }, { r: 9, s: 'H' }],
  });
  const tavernBefore = s.tavern.length;
  playCards(s, 0, [{ r: 5, s: 'H' }, { r: 5, s: 'D' }]); // pair of 5s: return 10 (capped 3), recruit 10
  assert.equal(s.discard.length, 0, 'the prisoners fully returned');
  // returned 3 in, then recruits came off the top; the 3 returned went UNDER (start of array)
  assert.equal(s.enemy.damage, 10);
  assert.ok(s.tavern.length <= tavernBefore + 3, 'Le Peuple gained returned cards then supplied recruits');
  assert.equal(s.phase, 'discard', 'Jack of Clubs strikes back for 10');
  assert.equal(s.pendingDamage, 10);
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
      [{ r: 'X', s: null }, { r: 3, s: 'D' }],
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

test('Pamphleteer cancels immunity and lets the player choose who goes next (even self)', () => {
  const s = newGame(names3, { seed: 9 });
  rig(s, {
    hands: [
      [{ r: 'X', s: null }, { r: 6, s: 'S' }, { r: 5, s: 'H' }],
      [{ r: 2, s: 'C' }],
      [{ r: 3, s: 'C' }],
    ],
    enemy: { r: 'J', s: 'S' },
  });
  playCards(s, 0, [{ r: 'X', s: null }]);
  assert.equal(s.phase, 'jesterChoose');
  assert.equal(s.enemy.immunityCancelled, true);
  chooseNext(s, 0, 0); // chooses self
  assert.equal(s.current, 0);
  playCards(s, 0, [{ r: 6, s: 'S' }]);
  assert.equal(currentShield(s), 6, 'immunity cancelled — shield works vs Spades Jack');
  assert.equal(s.pendingDamage, 4);
});

test('lying low skips the strike as well as the attack, once per citoyen per royal', () => {
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

test('an attack does not restore a spent Lay Low; the next royal does', () => {
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

  // Fell the Jack: the royal who steps up faces a table with its ducks restored.
  s.players[1].hand.push({ r: 9, s: 'C' });
  s.enemy.damage = 11;
  playCards(s, 1, [{ r: 9, s: 'C' }]);        // 9 clubs doubled = 18 → overkill
  assert.equal(s.enemy.card.r, 'J', 'a fresh royal is on the table');
  assert.ok(s.players.every(p => !p.laidLow), 'every citoyen may lie low again');
  assert.equal(canYield(s, 0), true);
});

test('exact kill claims the royal for the slayer’s hand; overkill goes to discard; the turn passes on', () => {
  const s = newGame(names2, { seed: 11 });
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
  const hearts = newGame(names2, { seed: 111 });
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

  const diamonds = newGame(names2, { seed: 112 });
  rig(diamonds, {
    hands: [[{ r: 10, s: 'D' }], []],
    enemy: { r: 'J', s: 'S' },
    discard: [{ r: 2, s: 'C' }, { r: 3, s: 'H' }, { r: 4, s: 'S' }],
  });
  diamonds.enemy.damage = 10;
  const tavernBefore = diamonds.tavern.length;
  playCards(diamonds, 0, [{ r: 10, s: 'D' }]);
  assert.deepEqual(diamonds.lastEffects, { healed: 3, drawn: 0 });
  assert.equal(diamonds.tavern.length, tavernBefore + 3, 'three prisoners return beneath Le Peuple');
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

test('solo: regroup resets the deck, refills to 8, spends the pool; Lay Low is never available', () => {
  const s = newGame(['Citoyen'], { seed: 16 });
  assert.equal(s.players[0].hand.length, 8);
  rig(s, { enemy: { r: 'J', s: 'H' }, discard: [{ r: 4, s: 'H' }, { r: 5, s: 'H' }] });
  const outsideTheFight = s.tavern.length + s.discard.length + s.players[0].hand.length;
  regroup(s, 0);
  assert.equal(s.players[0].hand.length, 8);
  assert.equal(s.discard.length, 0, 'La Prison empties back into Le Peuple');
  assert.equal(s.tavern.length + 8, outsideTheFight, 'and nothing is lost in the reshuffle');
  assert.equal(s.regroupsRemaining, 1);
  assert.equal(s.regroupsUsed, 1);
  assert.throws(() => callAssembly(s, 0), /no Assemblée to convene alone/i);
  // Lying low only ever helps by passing the turn to someone else, so solo never offers it.
  assert.equal(canYield(s, 0), false, 'solo can never lie low — there is no one else to pass the turn to');
  assert.throws(() => yieldTurn(s, 0), /cannot lie low/);
});

test('two-player: l’Assemblée carries a Regroup, which resets the deck for the whole table', () => {
  const s = newGame(names2, { seed: 42 });
  const partnerHand = [{ r: 9, s: 'H' }, { r: 8, s: 'D' }];
  rig(s, {
    hands: [[{ r: 2, s: 'C' }], partnerHand],
    enemy: { r: 'J', s: 'H' },
    discard: [{ r: 4, s: 'H' }, { r: 5, s: 'H' }],
  });
  s.tavern = Array.from({ length: 20 }, (_, i) => ({ r: 2 + (i % 9), s: 'S' }));
  const pool = 2 + 20 + 0 + 2; // La Prison, Le Peuple, and both hands (the 2♣ is in play)

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
  assert.equal(s.players[0].hand.length, 7, 'the mover refills to the two-player hand limit');
  assert.equal(s.players[1].hand.length, 7, 'and so does everyone else');
  assert.equal(s.discard.length, 0, 'La Prison is emptied back into Le Peuple');
  assert.equal(s.tavern.length + 14, pool, 'every card outside the fight was reshuffled and dealt from');
  assert.ok(
    [...s.tavern, ...s.players.flatMap(p => p.hand)].some(c => c.r === 4 && c.s === 'H'),
    'a prisoner is back in circulation rather than stranded in La Prison',
  );
  assert.equal(s.regroupsRemaining, 1, 'one spent from the shared pool of two');
  assert.equal(s.regroupsUsed, 1);
});

test('a Regroup leaves the cards already committed against the royal in play', () => {
  const s = newGame(names2, { seed: 142 });
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

test('jester rejected in combos; jester value 0 as discard', () => {
  const s = newGame(names3, { seed: 17 });
  rig(s, {
    hands: [[{ r: 'X', s: null }, { r: 5, s: 'H' }], [{ r: 2, s: 'C' }], [{ r: 2, s: 'D' }]],
    enemy: { r: 'J', s: 'H' },
  });
  assert.ok(validatePlay(s, 0, [{ r: 'X', s: null }, { r: 5, s: 'H' }]), 'jester must be alone');
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
  assert.equal(p.damage, 14, 'doubling once immunity cancelled');
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
    } else if (s.phase === 'jesterChoose') {
      chooseNext(s, s.current, (s.current + 1) % s.playerCount);
    }
  }
  assert.ok(['won', 'lost'].includes(s.phase), 'game terminates');
  const v = viewFor(s, 0);
  assert.ok(!('log' in v), 'the private game journal is not exposed for lookup');
});

// ---- La Constitution (house rules) -----------------------------------------

test('rules resolve from partial and hostile input, and default to the rulebook', () => {
  assert.deepEqual(resolveRules(null, 3), { regroups: 1, pamphleteers: 2, handSizeDelta: 0 });
  const wild = resolveRules({ regroups: 99, pamphleteers: -5, handSizeDelta: 7 }, 2);
  assert.equal(wild.regroups, 3);
  assert.equal(wild.pamphleteers, 0);
  assert.equal(wild.handSizeDelta, 1);
  assert.equal(resolveRules({ handSizeDelta: '-1' }, 2).handSizeDelta, -1, 'numeric strings survive the form');
  // Retired options are not rules any more, whatever a stale client sends.
  assert.deepEqual(
    resolveRules({ afterKill: 'choose', exactKillToHand: false, pamphleteerCompanion: true }, 2),
    { regroups: 2, pamphleteers: 1, handSizeDelta: 0 },
  );
});

test('hand size shifts by one from the per-count default', () => {
  assert.equal(newGame(names4, { seed: 50, rules: { handSizeDelta: -1 } }).handSize, 5);
  assert.equal(newGame(names4, { seed: 50, rules: { handSizeDelta: 1 } }).handSize, 7);
  const s = newGame(names2, { seed: 50, rules: { handSizeDelta: 1 } });
  for (const p of s.players) assert.equal(p.hand.length, 8, 'opening hands honour the new limit');
});

test('the Pamphleteer count sets what is shuffled into Le Peuple; at zero immunity never lifts', () => {
  for (const n of [0, 1, 2, 3]) {
    const s = newGame(names3, { seed: 51, rules: { pamphleteers: n } });
    const all = [...s.tavern, ...s.players.flatMap(p => p.hand)];
    assert.equal(all.filter(c => c.r === 'X').length, n, `${n} Pamphleteers in play`);
  }
  const none = newGame(names2, { seed: 52, rules: { pamphleteers: 0 } });
  rig(none, { hands: [[{ r: 6, s: 'S' }], [{ r: 2, s: 'C' }]], enemy: { r: 'J', s: 'S' } });
  playCards(none, 0, [{ r: 6, s: 'S' }]);
  assert.equal(currentShield(none), 0, 'no Pamphleteer can ever shatter a Spade royal’s immunity');
});

test('after a kill the next citoyen always faces the newcomer', () => {
  const s = newGame(names3, { seed: 53 });
  rig(s, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  s.enemy.damage = 19;
  playCards(s, 0, [{ r: 2, s: 'C' }]); // 2 clubs doubled = 4 → overkill
  assert.equal(s.current, 1, 'the turn passes on');
  assert.equal(s.phase, 'play');
  // Not even a stale client can buy the slayer another turn.
  const stale = newGame(names3, { seed: 53, rules: { afterKill: 'slayer' } });
  rig(stale, {
    hands: [[{ r: 2, s: 'C' }], [{ r: 3, s: 'C' }], [{ r: 4, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  stale.enemy.damage = 19;
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
    const s = newGame(names2, { seed: 54 });
    rig(s, { hands: [[{ r: 10, s: 'H' }], []], enemy: { r: 'J', s: 'S' } });
    s.players[1].hand = Array.from({ length: s.handSize }, (_, i) => ({ r: 2 + i, s: 'C' }));
    s.tavern = Array.from({ length: 12 }, (_, i) => ({ r: 2 + (i % 9), s: 'D' }));
    s.enemy.damage = 10; // 10 hearts lands the last 10 exactly
    return s;
  };

  const toHand = setup();
  assert.equal(toHand.handSize, 7);
  playCards(toHand, 0, [{ r: 10, s: 'H' }]);
  assert.equal(toHand.players[0].hand.length, 7, 'Rally stops at six so the royal fits');
  assert.deepEqual(toHand.players[0].hand.at(-1), { r: 'J', s: 'S' }, 'the royal joins the hand');
  assert.ok(!toHand.tavern.some(c => c.r === 'J'), 'and not the deck');

  // An overkill is not an exact kill, so no slot is held back.
  const over = setup();
  over.enemy.damage = 11;
  playCards(over, 0, [{ r: 10, s: 'H' }]);
  assert.equal(over.players[0].hand.length, 7, 'a full hand from Rally');
  assert.deepEqual(over.discard.at(-1), { r: 10, s: 'H' });
  assert.ok(over.discard.some(c => c.r === 'J'), 'the royal is guillotined');
});

test('solo never stops to ask who acts next — there is nobody to choose between', () => {
  const solo = newGame(['Citoyen'], { seed: 58 });
  rig(solo, { hands: [[{ r: 'X', s: null }, { r: 5, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  solo.tavern = Array.from({ length: 12 }, () => ({ r: 4, s: 'D' }));
  playCards(solo, 0, [{ r: 'X', s: null }]);
  assert.equal(solo.phase, 'play', 'the turn simply carries on');
  assert.equal(solo.current, 0);
  assert.equal(solo.enemy.immunityCancelled, true, 'immunity still falls');

  // And a table of two still gets the choice.
  const table = newGame(names2, { seed: 58 });
  rig(table, { hands: [[{ r: 'X', s: null }], [{ r: 2, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  playCards(table, 0, [{ r: 'X', s: null }]);
  assert.equal(table.phase, 'jesterChoose');
});

test('the Pamphleteer always works alone — no partner, and never two at once', () => {
  const s = newGame(names2, { seed: 57 });
  rig(s, {
    hands: [[{ r: 'X', s: null }, { r: 'X', s: null }, { r: 5, s: 'C' }], [{ r: 2, s: 'C' }]],
    enemy: { r: 'J', s: 'H' },
  });
  assert.equal(validatePlay(s, 0, [{ r: 'X', s: null }]), null, 'alone is the only legal Pamphleteer play');
  assert.match(validatePlay(s, 0, [{ r: 'X', s: null }, { r: 5, s: 'C' }]), /works alone/);
  assert.match(validatePlay(s, 0, [{ r: 'X', s: null }, { r: 'X', s: null }]), /Only one Pamphleteer/);
  // Not even a hostile client can talk the engine into it — there is no rule left to set.
  const open = newGame(names2, { seed: 57, rules: { pamphleteerCompanion: true } });
  rig(open, { hands: [[{ r: 'X', s: null }, { r: 5, s: 'C' }], [{ r: 2, s: 'C' }]], enemy: { r: 'J', s: 'H' } });
  assert.match(validatePlay(open, 0, [{ r: 'X', s: null }, { r: 5, s: 'C' }]), /works alone/);
});

test('view hides other hands but shows counts', () => {
  const s = newGame(names3, { seed: 20 });
  const v = viewFor(s, 1);
  assert.equal(v.you.index, 1);
  assert.equal(v.you.hand.length, 6);
  assert.equal(v.players[0].handCount, 6);
  assert.ok(!('hand' in v.players[0]));
});

test('a citoyen may surrender the game', () => {
  const s = newGame(names2, { seed: 21 });
  surrenderGame(s, 1);
  assert.equal(s.phase, 'lost');
  assert.match(s.result.reason, /Robespierre surrendered/);
  assert.equal(s.lastEvent.type, 'loss');
});
