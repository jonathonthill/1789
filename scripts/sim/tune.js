// Tuning the 'good' citoyen.
//
// The whole study rests on what "a good player" means, so the reference bot's
// judgement is not left hand-guessed: coordinate descent walks each weight up
// and down and keeps whatever wins more Revolutions.
//
//   node scripts/sim/tune.js --games 2000 --passes 4
//
// The basket deliberately spans table sizes and sits at middling difficulty,
// where play actually decides the outcome. Tuning against a ruleset the bots
// already win 90% of the time would teach them nothing.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_WEIGHTS } from './bot.js';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const BASKET = [
  { players: 1, rules: {} },
  { players: 2, rules: { handSizeDelta: -1 } },
  { players: 3, rules: { handSizeDelta: -1 } },
  { players: 4, rules: { regroups: 0, handSizeDelta: -1 } },
];

const MULTIPLIERS = [0.4, 0.7, 1.4, 2.2];

async function scoreAll(candidates, games) {
  const cells = [];
  candidates.forEach((weights, ci) => {
    BASKET.forEach((b, bi) => cells.push({ ...b, weights, tier: 'good', ci, bi }));
  });
  const results = await sweep({ cells, games, tier: 'good' });
  const totals = candidates.map(() => 0);
  for (const r of results) totals[r.ci] += r.winRate;
  return totals.map(t => t / BASKET.length);
}

export async function tune({ games = 2000, passes = 4 } = {}) {
  let best = { ...BASE_WEIGHTS };
  let bestScore = (await scoreAll([best], games))[0];
  console.error(`start: mean win rate ${(100 * bestScore).toFixed(2)}%`);

  const keys = Object.keys(BASE_WEIGHTS);
  for (let pass = 1; pass <= passes; pass++) {
    let improved = false;
    for (const key of keys) {
      const candidates = MULTIPLIERS.map(m => ({ ...best, [key]: best[key] * m }));
      if (best[key] !== 0) candidates.push({ ...best, [key]: 0 });
      const scores = await scoreAll(candidates, games);
      let bi = -1;
      let bs = bestScore;
      scores.forEach((s, i) => { if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0) {
        best = candidates[bi];
        bestScore = bs;
        improved = true;
        console.error(`  pass ${pass}: ${key} -> ${best[key].toFixed(2)}  (${(100 * bs).toFixed(2)}%)`);
      }
    }
    console.error(`pass ${pass} complete: ${(100 * bestScore).toFixed(2)}%${improved ? '' : ' (no change — settled)'}`);
    if (!improved) break;
  }
  return { weights: best, score: bestScore };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = { games: 2000, passes: 4 };
  for (let i = 2; i < process.argv.length; i += 2) {
    args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
  }
  const started = Date.now();
  const { weights, score } = await tune(args);
  const out = resolve(HERE, 'results/weights.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(weights, null, 1));
  console.error(`\nTuned in ${((Date.now() - started) / 1000).toFixed(0)}s — mean win rate ${(100 * score).toFixed(2)}%`);
  console.error(`Weights written to ${out}`);
}
