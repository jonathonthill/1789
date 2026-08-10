import test from 'node:test';
import assert from 'node:assert/strict';
import { encouragingLossMessage, resultScreenContent } from '../public/js/results.js';

const defeats = (captured, guillotined) => [
  ...Array.from({ length: captured }, (_, i) => ({ card: { r: 'J', s: String(i) }, outcome: 'captured' })),
  ...Array.from({ length: guillotined }, (_, i) => ({ card: { r: 'Q', s: String(i) }, outcome: 'guillotined' })),
];

test('loss encouragement strengthens across the four progress bands', () => {
  assert.match(encouragingLossMessage(0), /rise again/i);
  assert.match(encouragingLossMessage(4), /shaken/i);
  assert.match(encouragingLossMessage(8), /Republic is close/i);
  assert.match(encouragingLossMessage(11), /One royal remained/i);
});

test('result summaries show the requested shared statistics', () => {
  const loss = resultScreenContent({
    phase: 'lost', defeatedRoyals: defeats(3, 5), result: { reason: 'A final blow landed.' },
  });
  assert.deepEqual(loss.stats.map(stat => [stat.label, stat.value]), [
    ['Royals defeated', 8], ['Won over', 3], ['Guillotined', 5],
  ]);
  assert.match(loss.message, /Republic is close/i);
  assert.equal(loss.reason, 'A final blow landed.');

  const win = resultScreenContent({
    phase: 'won', defeatedRoyals: defeats(5, 7), pamphleteersUsed: 2, regroupsUsed: 1,
  });
  assert.deepEqual(win.stats.map(stat => [stat.label, stat.value]), [
    ['Won over', 5], ['Guillotined', 7], ['Pamphleteers played', 2], ['Retreats played', 1],
  ]);
});
