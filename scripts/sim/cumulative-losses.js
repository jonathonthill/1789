// Measure where games end under the currently shipped rules and tuned policy.
//
//   node scripts/sim/cumulative-losses.js --games 10000 --profile mixed

// A loss while facing royal N means N - 1 royals were felled. The cumulative
// rate at N is therefore the share of games lost on or before that royal.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playGame } from './runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = { games: 10000, weights: 'results/weights.json', profile: 'strong' };
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
args.games = Number(args.games);

const weights = JSON.parse(readFileSync(resolve(HERE, args.weights), 'utf8'));
const results = [];

// A deterministic 10,000-slot population keeps the intended mix exact while
// scattering skill levels across deals instead of assigning easy or hard seed
// ranges to one group. The mix mirrors the realistic-table study:
// 15% expert; 45% competent (a quarter with one 5%-error seat); 30% average
// (half with one 10%-error seat); 10% casual.
function profileFor(seed) {
  if (args.profile !== 'mixed') return { tier: 'strong' };
  const slot = (seed * 7919) % 10000;
  if (slot < 1500) return { tier: 'strong' };
  if (slot < 6000) return {
    tier: 'good',
    weakFraction: slot < 2625 ? 1 : 0,
    errorRate: 0.05,
  };
  if (slot < 9000) return {
    tier: 'average',
    weakFraction: slot < 7500 ? 1 : 0,
    errorRate: 0.10,
  };
  return { tier: 'decent' };
}

for (let players = 1; players <= 4; players++) {
  const lossAt = Array(12).fill(0);
  let wins = 0;
  for (let seed = 1; seed <= args.games; seed++) {
    const game = playGame({ players, rules: {}, seed, weights, ...profileFor(seed) });
    if (game.won) wins++;
    else lossAt[Math.min(11, game.royalsFelled)]++;
  }
  let lost = 0;
  const cumulativeLossRate = lossAt.map(count => {
    lost += count;
    return lost / args.games;
  });
  results.push({ players, games: args.games, wins, lossAt, cumulativeLossRate });
  console.error(`${players}p complete`);
}

console.log(JSON.stringify({ generated: new Date().toISOString(), profile: args.profile, results }, null, 2));
