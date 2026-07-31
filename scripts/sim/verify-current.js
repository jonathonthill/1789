// Verify the tuned strong-player policy against the rules currently shipped.
//
//   node scripts/sim/verify-current.js --games 40000

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = { games: 40000, weights: 'results/weights.json' };
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
args.games = Number(args.games);

const weights = JSON.parse(readFileSync(resolve(HERE, args.weights), 'utf8'));
const cells = [1, 2, 3, 4].map(players => ({
  players,
  rules: {},
  tier: 'strong',
}));

console.error(`${cells.length} current-rules cells x ${args.games.toLocaleString()} games...`);
const results = await sweep({ cells, games: args.games, tier: 'strong', weights });

console.log('| Players | Wins | Win rate | Royals felled | Exact kills |');
console.log('|---:|---:|---:|---:|---:|');
for (const r of results.sort((a, b) => a.players - b.players)) {
  console.log(`| ${r.players} | ${r.wins.toLocaleString()} | ${(100 * r.winRate).toFixed(1)}% | ${r.avgRoyals.toFixed(2)} | ${r.avgExactKills.toFixed(2)} |`);
}
