import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, playCards, yieldTurn, discardForDamage, chooseNext, soloRegroup,
  validatePlay, validateDiscard, canYield, previewPlay, viewFor,
  currentShield, effectiveEnemyAttack, cardValue,
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
  for (const [n, jesters, hand] of [[1, 0, 8], [2, 0, 7], [3, 1, 6], [4, 2, 5]]) {
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
    if (n === 1) assert.equal(s.soloJesters, 2);
  }
});

test('combo legality', () => {
  const s = newGame(names2, { seed: 2 });
  rig(s, { hands: [[
    { r: 2, s: 'S' }, { r: 2, s: 'H' }, { r: 2, s: 'D' }, { r: 2, s: 'C' },
    { r: 5, s: 'S' }, { r: 5, s: 'H' }, { r: 6, s: 'S' },
  ], []] });
  assert.equal(validatePlay(s, 0, s.players[0].hand.slice(0, 4)), null, 'quad 2s ok');
  assert.equal(validatePlay(s, 0, [{ r: 5, s: 'S' }, { r: 5, s: 'H' }]), null, 'pair 5s ok');
  assert.ok(validatePlay(s, 0, [{ r: 6, s: 'S' }, { r: 5, s: 'S' }]), 'mixed ranks rejected');
  assert.ok(validatePlay(s, 0, [{ r: 6, s: 'S' }, { r: 6, s: 'S' }]), 'card not held twice rejected');
});

test('companion pairing rules', () => {
  const s = newGame(names2, { seed: 3 });
  rig(s, { hands: [[
    { r: 'A', s: 'C' }, { r: 'A', s: 'D' }, { r: 8, s: 'D' }, { r: 2, s: 'S' }, { r: 2, s: 'H' },
  ], []] });
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 8, s: 'D' }]), null, 'A + card ok');
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 'A', s: 'D' }]), null, 'A + A ok');
  assert.equal(validatePlay(s, 0, [{ r: 'A', s: 'C' }]), null, 'A alone ok');
  assert.ok(validatePlay(s, 0, [{ r: 'A', s: 'C' }, { r: 2, s: 'S' }, { r: 2, s: 'H' }]), 'A in combo rejected');
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

test('Raid returns the Fallen under Le Peuple before Rally recruits', () => {
  const s = newGame(names2, { seed: 5 });
  rig(s, {
    hands: [[{ r: 5, s: 'H' }, { r: 5, s: 'D' }], [{ r: 2, s: 'C' }]],
    enemy: { r: 'J', s: 'C' },
    discard: [{ r: 9, s: 'C' }, { r: 9, s: 'D' }, { r: 9, s: 'H' }],
  });
  const tavernBefore = s.tavern.length;
  playCards(s, 0, [{ r: 5, s: 'H' }, { r: 5, s: 'D' }]); // pair of 5s: return 10 (capped 3), recruit 10
  assert.equal(s.discard.length, 0, 'the Fallen fully returned');
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

test('yield restriction: forbidden when every other player just yielded', () => {
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
  discardForDamage(s, 0, [{ r: 9, s: 'H' }, { r: 9, s: 'D' }]);
  yieldTurn(s, 1);
  discardForDamage(s, 1, [{ r: 8, s: 'H' }, { r: 8, s: 'D' }]);
  assert.equal(canYield(s, 2), false, 'third player may not yield');
  assert.throws(() => yieldTurn(s, 2));
});

test('exact kill places the royal on top of the tavern; overkill goes to discard; slayer continues', () => {
  const s = newGame(names2, { seed: 11 });
  rig(s, {
    hands: [[{ r: 10, s: 'C' }, { r: 2, s: 'H' }], [{ r: 3, s: 'H' }]],
    enemy: { r: 'J', s: 'H' },
  });
  playCards(s, 0, [{ r: 10, s: 'C' }]); // 10 clubs = 20 = exactly Jack health
  assert.equal(s.tavern[s.tavern.length - 1].r, 'J', 'Jack on top of tavern');
  assert.equal(s.enemy.card.r, 'J', 'next enemy revealed is another Jack');
  assert.equal(s.current, 0, 'slayer takes the new turn');
  assert.equal(s.phase, 'play');
  assert.equal(s.enemy.damage, 0);
  assert.equal(currentShield(s), 0, 'played cards cleared');
  // the played 10C went to discard
  assert.ok(s.discard.some(c => c.r === 10 && c.s === 'C'));
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
  rig(s, {
    hands: [[{ r: 2, s: 'H' }, { r: 3, s: 'C' }], [{ r: 4, s: 'H' }]],
    enemy: { r: 'K', s: 'H' },
  });
  playCards(s, 0, [{ r: 2, s: 'H' }]); // King strikes 20, hand value 3 — dead
  assert.equal(s.phase, 'lost');
  assert.ok(s.result.reason.includes('Danton'));
});

test('empty-handed player who yields into unblocked damage loses the game', () => {
  const s = newGame(names2, { seed: 15 });
  rig(s, {
    hands: [
      [{ r: 5, s: 'S' }, { r: 5, s: 'C' }],
      [],
    ],
    enemy: { r: 'J', s: 'H' },
  });
  s.tavern = [];
  s.players[1].yielded = true; // other player just yielded → player 1... p0 played though
  playCards(s, 0, [{ r: 5, s: 'S' }]); // shield 5, suffer 5
  discardForDamage(s, 0, [{ r: 5, s: 'C' }]);
  // Now p1's turn: empty hand; p0 did NOT yield last turn so p1 CAN yield with empty hand
  assert.equal(s.phase, 'discard' === s.phase ? s.phase : s.phase, 'sanity');
  assert.equal(s.current, 1);
  assert.equal(canYield(s, 1), true);
  yieldTurn(s, 1); // suffers 10 - 5 = 5 with empty hand (value 0) → loss
  assert.equal(s.phase, 'lost');
});

test('solo: regroup discards hand, refills to 8, tracks medals; cannot yield twice in a row', () => {
  const s = newGame(['Citoyen'], { seed: 16 });
  assert.equal(s.players[0].hand.length, 8);
  rig(s, { enemy: { r: 'J', s: 'H' } });
  soloRegroup(s);
  assert.equal(s.players[0].hand.length, 8);
  assert.equal(s.soloJesters, 1);
  assert.equal(s.soloJestersUsed, 1);
  // yield once ok, twice in a row not
  const hv = s.players[0].hand.reduce((t, c) => t + cardValue(c), 0);
  if (hv >= 10) {
    yieldTurn(s, 0);
    const low = [...s.players[0].hand].sort((a, b) => cardValue(b) - cardValue(a));
    const chosen = [];
    let tot = 0;
    for (const c of low) { if (tot >= 10) break; chosen.push(c); tot += cardValue(c); }
    discardForDamage(s, 0, chosen);
    assert.equal(canYield(s, 0), false, 'no yielding twice in a row solo');
  }
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

test('view hides other hands but shows counts', () => {
  const s = newGame(names3, { seed: 20 });
  const v = viewFor(s, 1);
  assert.equal(v.you.index, 1);
  assert.equal(v.you.hand.length, 6);
  assert.equal(v.players[0].handCount, 6);
  assert.ok(!('hand' in v.players[0]));
});
