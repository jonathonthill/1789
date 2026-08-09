// Measure where games end under the currently shipped rules and tuned policy.
//
//   node scripts/sim/cumulative-losses.js --games 10000

// A loss while facing royal N means N - 1 royals were felled. The cumulative
// rate at N is therefore the share of games lost on or before that royal.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playGame } from './runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = { games: 10000, weights: 'results/weights.json' };
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
args.games = Number(args.games);

const weights = JSON.parse(readFileSync(resolve(HERE, args.weights), 'utf8'));
const results = [];

for (let players = 1; players <= 4; players++) {
  const lossAt = Array(12).fill(0);
  let wins = 0;
  for (let seed = 1; seed <= args.games; seed++) {
    const game = playGame({ players, rules: {}, seed, tier: 'strong', weights });
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

console.log(JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
