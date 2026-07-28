// The synthesis: given everything the study has turned up, what should 1789
// actually ship?
//
//   node scripts/sim/recommend.js --games 4000            # stage one: the table
//   node scripts/sim/recommend.js --solo --games 20000    # stage two: alone
//
// Two stages, because the brief treats them differently. A table of 2-4 wants
// one ruleset whose per-size steps are directional and teachable. A lone citoyen
// is allowed rules of their own — notably a Regroup that refills the hand rather
// than dealing a few cards, which is what the rulebook's flippable Jester does.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_SIZE } from '../../shared/rules.js';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE_SIZES = [2, 3, 4];

// The floor the brief asks for, and the ceiling beyond which a table stops
// feeling like a fight. Larger tables are allowed to sit high inside it.
const FLOOR = 0.38;
const CEILING = 0.62;
const AIM = 0.40;

const GLOBALS = {
  exactKillTo: ['hand', 'peuple'],
  drawOnVictory: [0, 1],
  pamphleteerImmune: [true, false],
  pamphleteerCompanion: [false, true],
};
const PER_SIZE = {
  handSizeDelta: [-1, 0],
  pamphleteers: [1, 2, 3],
  regroups: [1, 2, 3],
  regroupDraw: [1, 2, 3],
};

const ARGS = { games: 4000, weights: 'results/weights.json', tier: 'average', out: 'results/recommend.json' };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'solo') { ARGS.solo = true; i -= 1; continue; }
  ARGS[k] = process.argv[i + 1];
}
ARGS.games = Number(ARGS.games);

const weights = JSON.parse(readFileSync(resolve(HERE, ARGS.weights), 'utf8'));
const handSize = (n, d) => HAND_SIZE[n] + d;

function product(spec) {
  return Object.entries(spec).reduce(
    (acc, [key, values]) => acc.flatMap(row => values.map(v => ({ ...row, [key]: v }))),
    [{}],
  );
}

// A dial steps one way only across the table sizes — in whichever direction the
// data prefers, but never back and forth.
function directional(values) {
  let up = false;
  let down = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) up = true;
    if (values[i] < values[i - 1]) down = true;
  }
  return !(up && down);
}

// ---- stage two: the lone citoyen -------------------------------------------

if (ARGS.solo) {
  const globals = JSON.parse(readFileSync(resolve(HERE, 'results/recommend-globals.json'), 'utf8'));
  const cells = [];
  for (const regroupScope of ['caller', 'callerAndPrison', 'table', 'draw']) {
    for (const regroups of [1, 2, 3]) {
      for (const handSizeDelta of [-1, 0, 1]) {
        for (const pamphleteers of [0, 1, 2, 3]) {
          for (const regroupDraw of (regroupScope === 'draw' ? [1, 2, 3] : [2])) {
            cells.push({
              players: 1, tier: ARGS.tier,
              regroupScope, regroups, handSizeDelta, pamphleteers, regroupDraw,
              rules: { ...globals, regroupScope, regroups, handSizeDelta, pamphleteers, regroupDraw },
            });
          }
        }
      }
    }
  }
  console.error(`Solo: ${cells.length} cells x ${ARGS.games.toLocaleString()} games...`);
  const res = await sweep({ cells, games: ARGS.games, weights });
  const near = res
    .filter(r => r.winRate >= 0.33 && r.winRate <= 0.48)
    .sort((a, b) => Math.abs(a.winRate - AIM) - Math.abs(b.winRate - AIM));
  console.log(`\nSolo settings nearest ${(100 * AIM).toFixed(0)}% (tier: ${ARGS.tier})\n`);
  console.log('| Regroup | count | hand | Pamphleteers | win rate |');
  console.log('|---|---|---|---|---|');
  for (const r of near.slice(0, 15)) {
    const scope = r.regroupScope === 'draw' ? `draw ${r.regroupDraw}` : r.regroupScope;
    console.log(`| ${scope} | ${r.regroups} | ${handSize(1, r.handSizeDelta)} | ${r.pamphleteers} | ${(100 * r.winRate).toFixed(1)}% |`);
  }
  process.exit(0);
}

// ---- stage one: the table ---------------------------------------------------

const cells = [];
for (const g of product(GLOBALS)) {
  for (const players of TABLE_SIZES) {
    for (const p of product(PER_SIZE)) {
      cells.push({
        players, tier: ARGS.tier, ...g, ...p,
        rules: { ...g, ...p, regroupScope: 'draw' },
      });
    }
  }
}

console.error(`${cells.length} cells x ${ARGS.games.toLocaleString()} games at tier '${ARGS.tier}'...`);
const started = Date.now();
let done = 0;
const results = await sweep({
  cells, games: ARGS.games, weights,
  onProgress: () => { if (++done % 50 === 0) process.stderr.write(`\r${done}/${cells.length}   `); },
});
process.stderr.write('\n');

const globalKey = r => Object.keys(GLOBALS).map(k => `${k}=${r[k]}`).join(' ');
const byGlobal = new Map();
for (const r of results) {
  if (!byGlobal.has(globalKey(r))) byGlobal.set(globalKey(r), new Map());
  const bySize = byGlobal.get(globalKey(r));
  if (!bySize.has(r.players)) bySize.set(r.players, []);
  bySize.get(r.players).push(r);
}

const families = [];
for (const [key, bySize] of byGlobal) {
  const options = TABLE_SIZES.map(n => (bySize.get(n) ?? []).filter(r => r.winRate >= FLOOR && r.winRate <= CEILING));
  if (options.some(o => !o.length)) continue;
  let partials = [[]];
  for (let i = 0; i < TABLE_SIZES.length; i++) {
    const next = [];
    for (const partial of partials) {
      for (const row of options[i]) {
        const combo = [...partial, row];
        // Hand SIZE is what a player reads off the sheet, so that is what must
        // step cleanly — not the delta it is stored as.
        const okHand = directional(combo.map((c, j) => handSize(TABLE_SIZES[j], c.handSizeDelta)));
        const okRest = ['pamphleteers', 'regroups', 'regroupDraw'].every(d => directional(combo.map(c => c[d])));
        if (okHand && okRest) next.push(combo);
      }
    }
    partials = next;
    if (!partials.length) break;
  }
  for (const combo of partials) {
    const rates = combo.map(c => c.winRate);
    const lowest = Math.min(...rates);
    const distinct = ['pamphleteers', 'regroups', 'regroupDraw'].reduce(
      (s, d) => s + new Set(combo.map(c => c[d])).size, 0,
    ) + new Set(combo.map((c, j) => handSize(TABLE_SIZES[j], c.handSizeDelta))).size;
    families.push({ key, combo, rates, lowest, distinct, spread: Math.max(...rates) - lowest });
  }
}

// The brief, in order: hold the floor near the aim; among rulesets that do,
// prefer the one with the fewest distinct numbers to remember, since a table
// has to be taught this. A profile that rises with the number of citoyens is
// preferred over one that falls — bigger tables are the forgiving ones.
const rising = f => (f.rates.every((r, i) => i === 0 || r >= f.rates[i - 1]) ? 0 : 1);
families.sort((a, b) => (
  (Math.abs(a.lowest - AIM) > 0.05 ? 1 : 0) - (Math.abs(b.lowest - AIM) > 0.05 ? 1 : 0)
  || a.distinct - b.distinct
  || rising(a) - rising(b)
  || Math.abs(a.lowest - AIM) - Math.abs(b.lowest - AIM)
));

console.log(`\n${families.length} rulesets hold every table of 2-4 inside ${(100 * FLOOR).toFixed(0)}-${(100 * CEILING).toFixed(0)}% with directional steps.\n`);
console.log('| # | Exact kill | Spoils | Pamphleteer | Companion | Hand (2/3/4) | Pamphleteers | Regroups | Draw | Win rates |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
families.slice(0, 10).forEach((f, i) => {
  const c = f.combo;
  const g = c[0];
  console.log(`| ${i + 1}${i === 0 ? ' ★' : ''} | ${g.exactKillTo} | ${g.drawOnVictory} | ${g.pamphleteerImmune ? 'shielded' : 'exposed'} | ${g.pamphleteerCompanion ? 'yes' : 'no'} `
    + `| ${TABLE_SIZES.map((n, j) => handSize(n, c[j].handSizeDelta)).join('/')} | ${c.map(x => x.pamphleteers).join('/')} `
    + `| ${c.map(x => x.regroups).join('/')} | ${c.map(x => x.regroupDraw).join('/')} `
    + `| ${f.rates.map(r => (100 * r).toFixed(0)).join('/')} |`);
});

if (families[0]) {
  const g = families[0].combo[0];
  const globals = Object.fromEntries(Object.keys(GLOBALS).map(k => [k, g[k]]));
  mkdirSync(resolve(HERE, 'results'), { recursive: true });
  writeFileSync(resolve(HERE, 'results/recommend-globals.json'), JSON.stringify(globals, null, 1));
  console.error(`\nWinning globals written for the solo stage: ${JSON.stringify(globals)}`);
}
console.error(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
