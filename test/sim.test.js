// The balance simulation is only worth reading if its model of the rules agrees
// with the rules. These check that the bots' arithmetic matches what the engine
// actually does, and that they never see a card they should not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, viewFor, playCards, cardValue } from '../shared/engine.js';
import { enumeratePlays, outcomeOf, damageProfile } from '../scripts/sim/moves.js';
import { choosePayment, optimalPayment, decide, inLastResort } from '../scripts/sim/bot.js';
import { speak, cheapestPayment } from '../scripts/sim/signals.js';
import { playGame } from '../scripts/sim/runner.js';

const names = ['Danton', 'Robespierre', 'Marat'];

function fresh(seed, rules, hands, enemy) {
  const s = newGame(names, { seed, rules });
  hands.forEach((h, i) => { s.players[i].hand = h.map(c => ({ ...c })); });
  if (enemy) { s.enemy.card = { ...enemy }; s.enemy.damage = 0; }
  return s;
}

test('what a bot predicts a play will do is what the engine then does', () => {
  const hand = [
    { r: 10, s: 'S' }, { r: 10, s: 'C' }, { r: 5, s: 'H' }, { r: 5, s: 'D' },
    { r: 'A', s: 'C' }, { r: 7, s: 'H' }, { r: 3, s: 'S' },
  ];
  for (const enemy of [{ r: 'J', s: 'D' }, { r: 'Q', s: 'C' }, { r: 'K', s: 'S' }, { r: 'Q', s: 'H' }]) {
    for (const cards of enumeratePlays(hand)) {
      const s = fresh(11, {}, [hand, [], []], enemy);
      const view = viewFor(s, 0);
      const predicted = outcomeOf(view, cards);
      const before = s.enemy.damage;
      const health = s.enemy.health ?? view.enemy.health;

      const held = cards.map(c => s.players[0].hand.find(h => h.r === c.r && h.s === c.s));
      playCards(s, 0, held);

      const dealt = s.enemy && s.enemy.revealSeq === view.enemy.revealSeq
        ? s.enemy.damage - before
        : health - before; // the royal fell, so at least its remaining health landed
      const killed = !s.enemy || s.enemy.revealSeq !== view.enemy.revealSeq;

      assert.equal(predicted.kills, killed, `kill prediction for ${JSON.stringify(cards)} vs ${enemy.r}${enemy.s}`);
      if (!killed) {
        assert.equal(predicted.damage, dealt, `damage prediction for ${JSON.stringify(cards)} vs ${enemy.r}${enemy.s}`);
      }
    }
  }
});

test('an exact kill is predicted exactly, under either destination', () => {
  for (const exactKillTo of ['hand', 'peuple']) {
    const hand = [{ r: 10, s: 'S' }, { r: 10, s: 'D' }, { r: 4, s: 'H' }];
    const s = fresh(12, { exactKillTo, drawOnVictory: 0 }, [hand, [], []], { r: 'J', s: 'D' });
    const view = viewFor(s, 0);
    const cards = [hand[0], hand[1]];
    const o = outcomeOf(view, cards);
    assert.equal(o.damage, 20);
    assert.ok(o.exact, 'twenty on the nose');
    playCards(s, 0, s.players[0].hand.slice(0, 2));
    const claimed = s.players[0].hand.some(c => c.r === 'J');
    assert.equal(claimed, exactKillTo === 'hand');
  }
});

test('the quick damage read agrees with working every play out in full', () => {
  const hands = [
    [{ r: 8, s: 'C' }, { r: 8, s: 'H' }, { r: 'A', s: 'S' }, { r: 6, s: 'D' }],
    [{ r: 'A', s: 'C' }, { r: 'A', s: 'H' }, { r: 9, s: 'S' }, { r: 9, s: 'C' }, { r: 9, s: 'D' }],
    [{ r: 2, s: 'S' }, { r: 2, s: 'H' }, { r: 2, s: 'D' }, { r: 2, s: 'C' }, { r: 'X', s: null }],
  ];
  for (const enemy of [{ r: 'J', s: 'C' }, { r: 'Q', s: 'S' }, { r: 'K', s: 'H' }]) {
    for (const hand of hands) {
      const s = fresh(13, { pamphleteers: 2 }, [hand, [], []], enemy);
      const view = viewFor(s, 0);
      const slow = { best: 0, canFinish: false, hasExact: false };
      for (const cards of enumeratePlays(hand)) {
        const o = outcomeOf(view, cards);
        if (o.damage > slow.best) slow.best = o.damage;
        if (o.kills) slow.canFinish = true;
        if (o.exact) slow.hasExact = true;
      }
      assert.deepEqual(damageProfile(view, hand), slow, `hand ${JSON.stringify(hand)} vs ${enemy.r}${enemy.s}`);
    }
  }
});

test('a payment always covers the blow, and the careful one is never dearer', () => {
  const hand = [
    { r: 2, s: 'S' }, { r: 7, s: 'H' }, { r: 'A', s: 'D' }, { r: 9, s: 'C' },
    { r: 4, s: 'S' }, { r: 'X', s: null }, { r: 6, s: 'H' },
  ];
  for (let damage = 1; damage <= 20; damage++) {
    const greedy = choosePayment(hand, damage);
    const optimal = optimalPayment(hand, damage);
    const sum = pile => pile.reduce((s, c) => s + cardValue(c), 0);
    assert.ok(sum(greedy) >= damage, `greedy covers ${damage}`);
    assert.ok(sum(optimal) >= damage, `optimal covers ${damage}`);
    assert.ok(!greedy.some(c => c.r === 'X'), 'the Pamphleteer is never thrown away to pay');
  }
  assert.equal(cheapestPayment(hand, 100), null, 'a blow beyond the hand cannot be paid');
});

test('a bot is handed nothing but its own view, its own hand and what was said', () => {
  const s = fresh(14, {}, [
    [{ r: 5, s: 'H' }, { r: 6, s: 'C' }],
    [{ r: 'K', s: 'S' }],
    [{ r: 9, s: 'D' }],
  ], { r: 'J', s: 'H' });
  const view = viewFor(s, 0);
  assert.equal(view.you.index, 0);
  assert.ok(view.players.every((p, i) => i === 0 || !('hand' in p)), 'no other hand is in the view');

  const talk = s.players.map((p, i) => speak(view, p.hand, i));
  // A remark carries no cards — only what a citoyen would say out loud.
  for (const t of talk) {
    assert.deepEqual(
      Object.keys(t).sort(),
      ['canFinish', 'cannotDefend', 'handCount', 'hasExact', 'laidLow', 'seat', 'strong', 'wantsLayLow', 'wantsRoyalDead'],
    );
  }
  const action = decide(view, s.players[0].hand, talk, { tier: 'good' });
  assert.ok(['play', 'yield', 'regroup'].includes(action.type));
});

test('last resort means exactly that: nothing else on the table avoids losing', () => {
  // A hand that cannot pay the Jack's ten, with no duck left.
  const s = fresh(15, {}, [[{ r: 2, s: 'D' }], [], []], { r: 'J', s: 'S' });
  s.players[0].laidLow = true;
  const view = viewFor(s, 0);
  assert.ok(inLastResort(view, s.players[0].hand), 'a 2 cannot answer a ten');

  const easy = fresh(16, {}, [[{ r: 10, s: 'H' }, { r: 9, s: 'D' }], [], []], { r: 'J', s: 'S' });
  assert.equal(inLastResort(viewFor(easy, 0), easy.players[0].hand), false);
});

test('a game always terminates and reports a consistent result', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const players of [1, 2, 3, 4]) {
      const r = playGame({ players, rules: {}, seed, tier: 'good' });
      assert.ok(r.actions > 0 && r.actions < 4000, `seed ${seed} ${players}p terminates on its own`);
      assert.ok(r.royalsFelled >= 0 && r.royalsFelled <= 12);
      if (r.won) assert.equal(r.royalsFelled, 12, 'a win means every royal fell');
    }
  }
});

test('the tiers differ, and every one of them plays legally', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  const rate = tier => seeds.filter(seed => playGame({ players: 3, rules: {}, seed, tier }).won).length / seeds.length;
  const decent = rate('decent');
  const good = rate('good');
  assert.ok(good > decent, `a table that talks and thinks does better (${good} vs ${decent})`);
});
