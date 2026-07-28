// Replays the finalist rulesets at other levels of play, so a recommendation
// comes with an honest idea of how much it depends on who is at the table.
//
//   node scripts/sim/tiers.js --games 20000 --cells results/finalists.json
//
// As well as three uniform tables, this measures mixed ones — a single weaker
// citoyen among good ones, and an evenly split table — because that is what a
// real table of three or four usually is.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const LINEUPS = {
  quiet: 'decent',
  good: 'good',
  sharp: 'strong',
  // Seat tiers cycle round the table, so these only bite from two citoyens up.
  oneWeak: ['decent', 'good', 'good', 'good'],
  halfWeak: ['decent', 'good'],
};

const ARGS = { games: 20000, cells: 'results/finalists.json', out: 'results/tiers.json', weights: 'results/weights.json' };
for (let i = 2; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
ARGS.games = Number(ARGS.games);

const finalists = JSON.parse(readFileSync(resolve(HERE, ARGS.cells), 'utf8'));
const weights = JSON.parse(readFileSync(resolve(HERE, ARGS.weights), 'utf8'));

const cells = [];
for (const [lineup, tier] of Object.entries(LINEUPS)) {
  for (const cell of finalists) {
    // A solo citoyen is the same person whatever the rest of the table would be.
    if (cell.players === 1 && Array.isArray(tier)) continue;
    cells.push({ ...cell, tier, lineup });
  }
}
// Not a lineup but a lever: good citoyens forbidden to duck except on an empty
// hand, which measures what Lay Low as a deliberate tactic is actually worth.
for (const cell of finalists) {
  if (cell.players === 1) continue; // there is no lying low alone
  cells.push({ ...cell, tier: 'good', lineup: 'noLayLow', noTacticalYield: true });
}

console.error(`Replaying ${finalists.length} finalists across ${Object.keys(LINEUPS).length} lineups (${cells.length} cells x ${ARGS.games} games)...`);
const started = Date.now();
let done = 0;
const results = await sweep({
  cells, games: ARGS.games, weights,
  onProgress: () => {
    done++;
    if (done % 5 === 0) process.stderr.write(`\r${done}/${cells.length} cells   `);
  },
});
process.stderr.write('\n');

const out = resolve(HERE, ARGS.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  generated: new Date().toISOString(),
  games: ARGS.games,
  lineups: LINEUPS,
  results,
}, null, 1));
console.error(`Wrote ${results.length} results to ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
