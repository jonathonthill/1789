// Asks one narrow question of the engine instead of sweeping the whole grid:
// hold most rules fixed, vary the two or three still in play, and print what
// each remaining combination is worth to tables of differing strength.
//
//   node scripts/sim/scenario.js --games 40000
//
// Edit FIXED / VARYING below to ask a different question. Hand size is written
// as the number of cards each table size actually holds, which is easier to
// check against a rules sheet than a delta.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_SIZE } from '../../shared/rules.js';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [1, 2, 3, 4];

// Two exposed Pamphleteers, exact kills won into the hand, one card of spoils
// per fallen royal, and hands of 8/7/6/5.
const FIXED = {
  pamphleteers: 2,
  pamphleteerImmune: false,
  exactKillTo: 'hand',
  drawOnVictory: 1,
};
const HANDS = { 1: 8, 2: 7, 3: 6, 4: 5 };

const VARYING = {
  pamphleteerCompanion: [false, true],
  regroups: [0, 1, 2],
};

// A table of average citoyens is the headline; the rest give it context.
const LINEUPS = {
  quiet: 'decent',
  average: 'average',
  good: 'good',
  oneWeakAmongAverage: ['decent', 'average', 'average', 'average'],
};

const ARGS = { games: 40000, weights: 'results/weights.json' };
for (let i = 2; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
ARGS.games = Number(ARGS.games);

const weights = JSON.parse(readFileSync(resolve(HERE, ARGS.weights), 'utf8'));

const cells = [];
for (const [lineup, tier] of Object.entries(LINEUPS)) {
  for (const players of SIZES) {
    if (players === 1 && Array.isArray(tier)) continue;
    for (const companion of VARYING.pamphleteerCompanion) {
      for (const regroups of VARYING.regroups) {
        cells.push({
          players,
          lineup,
          tier,
          companion,
          rules: {
            ...FIXED,
            regroups,
            pamphleteerCompanion: companion,
            handSizeDelta: HANDS[players] - HAND_SIZE[players],
          },
        });
      }
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
  onProgress: () => { if (++done % 8 === 0) process.stderr.write(`\r${done}/${cells.length}   `); },
});
process.stderr.write('\n');

const pct = x => `${(100 * x).toFixed(1)}%`;
const find = (lineup, companion, regroups, players) => results.find(r => (
  r.lineup === lineup && r.companion === companion && r.rules.regroups === regroups && r.players === players
));

for (const lineup of Object.keys(LINEUPS)) {
  console.log(`\n### ${lineup}\n`);
  console.log('| Pamphleteer | Regroups | 1p | 2p | 3p | 4p |');
  console.log('|---|---|---|---|---|---|');
  for (const companion of VARYING.pamphleteerCompanion) {
    for (const regroups of VARYING.regroups) {
      const row = SIZES.map(n => {
        const hit = find(lineup, companion, regroups, n);
        return hit ? pct(hit.winRate) : '—';
      });
      console.log(`| ${companion ? 'with a companion' : 'alone'} | ${regroups} | ${row.join(' | ')} |`);
    }
  }
}

console.error(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
