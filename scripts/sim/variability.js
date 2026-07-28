// What one off-form citoyen costs the table.
//
//   node scripts/sim/variability.js --games 40000
//
// The ruleset is held fixed at the candidate below. What varies is how often a
// game seats someone playing below their own standard, and how badly. The weaker
// citoyen is NOT a novice: same policy, same reading of the table, same grasp of
// what the cards do. An error rate is simply how often they reach for a lesser
// move than the one available — and, paying a blow, throw in cards as they come
// rather than choosing which to keep.
//
// Whether a game seats one and where they sit is drawn per game from the seed,
// so every column plays the same decks as every other.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_SIZE } from '../../shared/rules.js';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [1, 2, 3, 4];

// Two exposed Pamphleteers who may bring a companion, exact kills won into the
// hand, one card of spoils per fallen royal.
const FIXED = {
  pamphleteers: 2,
  pamphleteerImmune: false,
  pamphleteerCompanion: true,
  exactKillTo: 'hand',
  drawOnVictory: 1,
};
const HANDS = { 1: 8, 2: 7, 3: 5, 4: 5 };
const REGROUPS = { 1: 2, 2: 1, 3: 1, 4: 1 };

const WEAK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const ERROR_RATES = [0.05, 0.1, 0.2];
const BASE_TIER = 'average';

const ARGS = { games: 40000, weights: 'results/weights.json' };
for (let i = 2; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
ARGS.games = Number(ARGS.games);

const weights = JSON.parse(readFileSync(resolve(HERE, ARGS.weights), 'utf8'));

const rulesFor = players => ({
  ...FIXED,
  regroups: REGROUPS[players],
  handSizeDelta: HANDS[players] - HAND_SIZE[players],
});

const cells = [];
for (const players of SIZES) {
  for (const weakFraction of WEAK_FRACTIONS) {
    // With nobody off form the error rate is moot — play that column once.
    for (const errorRate of (weakFraction === 0 ? [0] : ERROR_RATES)) {
      cells.push({ players, weakFraction, errorRate, tier: BASE_TIER, rules: rulesFor(players) });
    }
  }
}

console.error(`${cells.length} cells x ${ARGS.games.toLocaleString()} games...`);
const started = Date.now();
let done = 0;
const results = await sweep({
  cells,
  games: ARGS.games,
  weights,
  onProgress: () => { if (++done % 5 === 0) process.stderr.write(`\r${done}/${cells.length}   `); },
});
process.stderr.write('\n');

const pct = x => `${(100 * x).toFixed(1)}%`;
const find = (players, weakFraction, errorRate) => results.find(r => (
  r.players === players && r.weakFraction === weakFraction && r.errorRate === errorRate
));

console.log('# 1789 — what player variability costs\n');
console.log(`_${ARGS.games.toLocaleString()} games per cell (±0.5 points). Tables of **${BASE_TIER}** citoyens._\n`);
console.log('Fixed: two exposed Pamphleteers, each free to bring a companion; exact kills');
console.log(`won into the hand; one card of spoils per royal; hands of ${SIZES.map(n => HANDS[n]).join('/')};`);
console.log(`Regroups ${SIZES.map(n => REGROUPS[n]).join('/')}.\n`);

for (const players of SIZES) {
  console.log(`\n## ${players} player${players === 1 ? '' : 's'}\n`);
  console.log(`| Games with someone off form | ${ERROR_RATES.map(e => `${100 * e}% error rate`).join(' | ')} |`);
  console.log(`|---|${ERROR_RATES.map(() => '---').join('|')}|`);
  const clean = find(players, 0, 0);
  console.log(`| never | ${ERROR_RATES.map(() => `${pct(clean.winRate)}`).join(' | ')} |`);
  for (const f of WEAK_FRACTIONS.filter(x => x > 0)) {
    const row = ERROR_RATES.map(e => {
      const hit = find(players, f, e);
      if (!hit) return '—';
      return `${pct(hit.winRate)} (${(100 * (hit.winRate - clean.winRate)).toFixed(1)})`;
    });
    console.log(`| ${100 * f}% of games | ${row.join(' | ')} |`);
  }
}

console.error(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
