// The balance sweep: play every ruleset in the grid, at every table size, and
// write down how often a table of good citoyens carries the Revolution.
//
//   node scripts/sim/sweep.js --games 3000 --out results/coarse.json
//   node scripts/sim/sweep.js --games 30000 --cells results/finalists.json
//
// Every cell plays the same list of seeds, so two rulesets are compared over the
// same decks and the difference between them is the rules, not the luck.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBatch } from './runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const GRID = {
  handSizeDelta: [-1, 0, 1],
  regroups: [0, 1, 2, 3],
  pamphleteers: [0, 1, 2, 3],
  exactKillTo: ['hand', 'peuple'],
  drawOnVictory: [0, 1, 2],
  pamphleteerImmune: [true, false],
};

export const TABLE_SIZES = [1, 2, 3, 4];

// Every cell worth playing. With no Pamphleteer in Le Peuple his protection can
// never come up, so those rulesets are only played once.
export function buildCells() {
  const cells = [];
  for (const players of TABLE_SIZES) {
    for (const handSizeDelta of GRID.handSizeDelta) {
      for (const regroups of GRID.regroups) {
        for (const pamphleteers of GRID.pamphleteers) {
          for (const exactKillTo of GRID.exactKillTo) {
            for (const drawOnVictory of GRID.drawOnVictory) {
              for (const pamphleteerImmune of GRID.pamphleteerImmune) {
                if (pamphleteers === 0 && pamphleteerImmune === false) continue;
                cells.push({
                  players,
                  rules: { handSizeDelta, regroups, pamphleteers, exactKillTo, drawOnVictory, pamphleteerImmune },
                });
              }
            }
          }
        }
      }
    }
  }
  return cells;
}

export function cellKey(cell) {
  const r = cell.rules;
  return [cell.players, r.handSizeDelta, r.regroups, r.pamphleteers, r.exactKillTo, r.drawOnVictory, r.pamphleteerImmune].join('|');
}

function parseArgs(argv) {
  const args = { games: 3000, out: 'results/coarse.json', tier: 'good', cells: null, weights: null };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  args.games = Number(args.games);
  return args;
}

// ---- worker ----------------------------------------------------------------

if (!isMainThread) {
  const { cells, games, tier, weights } = workerData;
  const seeds = Array.from({ length: games }, (_, i) => i + 1);
  const out = [];
  for (const cell of cells) {
    const stats = runBatch({
      players: cell.players,
      rules: cell.rules,
      seeds,
      tier: cell.tier ?? tier,
      weights: cell.weights ?? weights ?? undefined,
      noTacticalYield: cell.noTacticalYield ?? false,
      weakFraction: cell.weakFraction ?? 0,
      errorRate: cell.errorRate ?? 0,
    });
    out.push({ ...cell, tier: cell.tier ?? tier, ...stats });
    parentPort.postMessage({ tick: 1 });
  }
  parentPort.postMessage({ done: out });
}

// ---- main ------------------------------------------------------------------

export function sweep({ cells, games, tier = 'good', weights = null, onProgress }) {
  const workers = Math.max(1, Math.min(cpus().length, 8));
  const chunks = Array.from({ length: workers }, () => []);
  // Deal cells round-robin so every worker gets a mix of table sizes; a 4-player
  // game costs more than a solo one and this keeps the finish times together.
  cells.forEach((cell, i) => chunks[i % workers].push(cell));

  return Promise.all(chunks.map(chunk => new Promise((res, rej) => {
    if (!chunk.length) return res([]);
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { cells: chunk, games, tier, weights },
    });
    worker.on('message', msg => {
      if (msg.tick && onProgress) onProgress(msg.tick);
      if (msg.done) { res(msg.done); worker.terminate(); }
    });
    worker.on('error', rej);
  }))).then(parts => parts.flat());
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const cells = args.cells
    ? JSON.parse(readFileSync(resolve(HERE, args.cells), 'utf8'))
    : buildCells();
  const weights = args.weights
    ? JSON.parse(readFileSync(resolve(HERE, args.weights), 'utf8'))
    : null;

  const started = Date.now();
  let done = 0;
  const report = () => {
    const pct = (100 * done / cells.length).toFixed(0);
    const elapsed = (Date.now() - started) / 1000;
    const eta = done ? (elapsed / done) * (cells.length - done) : 0;
    process.stderr.write(`\r${done}/${cells.length} cells (${pct}%)  ${elapsed.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left   `);
  };

  console.error(`Sweeping ${cells.length} cells x ${args.games} games at tier '${args.tier}'...`);
  const results = await sweep({
    cells, games: args.games, tier: args.tier, weights,
    onProgress: () => { done++; if (done % 10 === 0) report(); },
  });
  report();
  process.stderr.write('\n');

  const outPath = resolve(HERE, args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    games: args.games,
    tier: args.tier,
    weights,
    results,
  }, null, 1));
  console.error(`Wrote ${results.length} results to ${outPath} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
