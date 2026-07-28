// Reads the sweep and works out what it means.
//
//   node scripts/sim/analyze.js candidates --in results/coarse.json --out results/candidates.json
//   node scripts/sim/analyze.js report
//
// Selection follows the brief: the three binary rules are fixed for every table,
// while hand size, Regroups and Pamphleteers may step with the number of
// citoyens — each moving one way only, in whichever direction the data prefers.
// Among rulesets that put every table size inside the target band, the tightest
// spread across table sizes wins.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The target win rate for a table of good players. Retargeting the whole study
// is a matter of changing these two numbers — every ruleset in the grid has
// already been measured, so nothing needs replaying to ask a different question.
export let BAND = [0.45, 0.55];

// Larger tables are allowed to sit a little above the band. Real tables of three
// and four are the ones most likely to mix skill levels, and a mixed table
// underperforms a uniformly good one by a wide margin — so a reference figure at
// the top of the band is not the same promise at four players as at two.
export let SOFT_EXTRA = 0.05;
export let SOFT_CAP = { 1: BAND[1], 2: BAND[1], 3: BAND[1] + SOFT_EXTRA, 4: BAND[1] + SOFT_EXTRA };

export function setBand({ lo, hi, softExtra } = {}) {
  BAND = [lo ?? BAND[0], hi ?? BAND[1]];
  SOFT_EXTRA = softExtra ?? SOFT_EXTRA;
  SOFT_CAP = { 1: BAND[1], 2: BAND[1], 3: BAND[1] + SOFT_EXTRA, 4: BAND[1] + SOFT_EXTRA };
  return { BAND, SOFT_CAP };
}

const boundsFor = n => [BAND[0], SOFT_CAP[n] ?? BAND[1]];
export const PER_SIZE_DIALS = ['handSizeDelta', 'regroups', 'pamphleteers'];
export const GLOBAL_DIALS = ['exactKillTo', 'drawOnVictory', 'pamphleteerImmune'];
const SIZES = [1, 2, 3, 4];

const load = p => JSON.parse(readFileSync(resolve(HERE, p), 'utf8'));
const globalKey = r => GLOBAL_DIALS.map(k => `${k}=${r[k]}`).join(' ');
const perSizeKey = r => PER_SIZE_DIALS.map(k => `${k}=${r[k]}`).join(' ');

// ---- the response surface --------------------------------------------------

// What each dial is worth on its own: the mean win rate over every ruleset that
// sets it that way. Blunt, but it shows the direction and rough size of a lever.
export function mainEffects(results) {
  const dials = [...PER_SIZE_DIALS, ...GLOBAL_DIALS];
  const out = {};
  for (const dial of dials) {
    out[dial] = {};
    for (const n of SIZES) {
      const rows = results.filter(r => r.players === n);
      const byValue = new Map();
      for (const r of rows) {
        const v = String(r.rules[dial]);
        if (!byValue.has(v)) byValue.set(v, []);
        byValue.get(v).push(r.winRate);
      }
      out[dial][n] = [...byValue.entries()]
        .map(([value, rates]) => ({ value, mean: rates.reduce((a, b) => a + b, 0) / rates.length, n: rates.length }))
        .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    }
  }
  return out;
}

export function reachableRange(results) {
  return SIZES.map(n => {
    const rates = results.filter(r => r.players === n).map(r => r.winRate);
    return { players: n, min: Math.min(...rates), max: Math.max(...rates) };
  });
}

// ---- picking a ruleset -----------------------------------------------------

function monotoneOk(values) {
  let up = false;
  let down = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) up = true;
    if (values[i] < values[i - 1]) down = true;
  }
  return !(up && down);
}

function distinctCount(values) {
  return new Set(values).size;
}

// Every ruleset family that lands all four table sizes in the band, ranked.
// `freeDials` names dials allowed to zigzag with table size instead of stepping
// one way only. Near a 50% target the monotonicity rule, not the win rates, is
// what rules most of the grid out — so which dials must behave is a question
// worth being able to ask.
export function findFamilies(results, band = null, { limit = 40, freeDials = [] } = {}) {
  const bounds = n => (band ? band : boundsFor(n));
  const mustStep = PER_SIZE_DIALS.filter(d => !freeDials.includes(d));
  const byGlobal = new Map();
  for (const r of results) {
    const g = globalKey(r.rules);
    if (!byGlobal.has(g)) byGlobal.set(g, new Map());
    const bySize = byGlobal.get(g);
    if (!bySize.has(r.players)) bySize.set(r.players, []);
    bySize.get(r.players).push(r);
  }

  const families = [];
  const shortfalls = [];

  for (const [g, bySize] of byGlobal) {
    const inBand = SIZES.map(n => {
      const [lo, hi] = bounds(n);
      return (bySize.get(n) ?? []).filter(r => r.winRate >= lo && r.winRate <= hi);
    });
    const empty = SIZES.filter((n, i) => inBand[i].length === 0);
    if (empty.length) {
      // Record how close this global combo could get, for the near-miss report.
      const target = (BAND[0] + BAND[1]) / 2;
      const best = SIZES.map((n, i) => {
        const rows = bySize.get(n) ?? [];
        return rows.reduce((a, b) => (
          Math.abs(b.winRate - target) < Math.abs(a.winRate - target) ? b : a
        ), rows[0]);
      });
      shortfalls.push({ global: g, missing: empty, best });
      continue;
    }

    // Walk the sizes in order, keeping only partial assignments that could still
    // stay monotone. The band filter usually leaves few enough that this is fast.
    let partials = [[]];
    for (let i = 0; i < SIZES.length; i++) {
      const next = [];
      for (const partial of partials) {
        for (const row of inBand[i]) {
          const combo = [...partial, row];
          const ok = mustStep.every(d => monotoneOk(combo.map(c => c.rules[d])));
          if (ok) next.push(combo);
        }
      }
      partials = next;
      if (!partials.length) break;
    }

    for (const combo of partials) {
      const rates = combo.map(c => c.winRate);
      const spread = Math.max(...rates) - Math.min(...rates);
      const distinct = PER_SIZE_DIALS.reduce((s, d) => s + distinctCount(combo.map(c => c.rules[d])), 0);
      const mid = (BAND[0] + BAND[1]) / 2;
      const centre = rates.reduce((s, r) => s + Math.abs(r - mid), 0) / rates.length;
      // How far the family leans on the allowance given to larger tables.
      const overflow = rates.reduce((s, r) => s + Math.max(0, r - BAND[1]), 0);
      families.push({
        overflow,
        global: g,
        globalRules: Object.fromEntries(GLOBAL_DIALS.map(k => [k, combo[0].rules[k]])),
        perSize: Object.fromEntries(SIZES.map((n, i) => [n, Object.fromEntries(PER_SIZE_DIALS.map(d => [d, combo[i].rules[d]]))])),
        rates: Object.fromEntries(SIZES.map((n, i) => [n, rates[i]])),
        cells: combo,
        spread, distinct, centre,
      });
    }
  }

  // Consistency first: the game should feel the same however many citoyens turn
  // up. Spread is bucketed so differences inside the noise floor do not outrank
  // a genuinely simpler table. Then how far the ruleset leans on the allowance
  // given to larger tables, then fewest distinct dial values.
  families.sort((a, b) => (
    Math.round(a.spread * 200) - Math.round(b.spread * 200)
    || Math.round(a.overflow * 100) - Math.round(b.overflow * 100)
    || a.distinct - b.distinct
    || a.centre - b.centre
  ));
  return { families: families.slice(0, limit), shortfalls, total: families.length };
}

// One dial at a time, from a chosen ruleset: what does moving it actually cost?
// Baselines are read from the same sweep as the probes, so a delta never mixes
// two different sample sizes.
export function sensitivity(results, family) {
  const byKey = new Map(results.map(r => [`${r.players}|${perSizeKey(r.rules)}|${globalKey(r.rules)}`, r]));
  const out = [];
  for (const n of SIZES) {
    const base = { ...family.globalRules, ...family.perSize[n] };
    const baseline = byKey.get(`${n}|${perSizeKey(base)}|${globalKey(base)}`)?.winRate ?? family.rates[n];
    for (const dial of [...PER_SIZE_DIALS, ...GLOBAL_DIALS]) {
      const values = new Set(results.filter(r => r.players === n).map(r => r.rules[dial]));
      for (const v of values) {
        if (v === base[dial]) continue;
        const probe = { ...base, [dial]: v };
        const hit = byKey.get(`${n}|${perSizeKey(probe)}|${globalKey(probe)}`);
        if (hit) out.push({ players: n, dial, from: base[dial], to: v, winRate: hit.winRate, delta: hit.winRate - baseline });
      }
    }
  }
  return out;
}

// ---- commands --------------------------------------------------------------

function cmdCandidates(args) {
  const data = load(args.in ?? 'results/coarse.json');
  const lo = Number(args.lo ?? 0.22);
  const hi = Number(args.hi ?? 0.48);
  const cells = data.results
    .filter(r => r.winRate >= lo && r.winRate <= hi)
    .map(r => ({ players: r.players, rules: r.rules }));
  const out = resolve(HERE, args.out ?? 'results/candidates.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cells, null, 1));
  console.error(`${cells.length} of ${data.results.length} cells fall in [${lo}, ${hi}] — written to ${out}`);
}

// Cells belonging to the top families, for the skill-tier re-runs.
function cmdFinalists(args) {
  const data = load(args.in ?? 'results/refined.json');
  const { families } = findFamilies(data.results, null, { limit: Number(args.top ?? 5), freeDials: (args.free ?? '').split(',').filter(Boolean) });
  const seen = new Set();
  const cells = [];
  for (const f of families) {
    for (const c of f.cells) {
      const k = `${c.players}|${perSizeKey(c.rules)}|${globalKey(c.rules)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push({ players: c.players, rules: c.rules });
    }
  }
  const out = resolve(HERE, args.out ?? 'results/finalists.json');
  writeFileSync(out, JSON.stringify(cells, null, 1));
  console.error(`${families.length} families -> ${cells.length} distinct cells written to ${out}`);
}

const ARGS = {};
for (let i = 3; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (ARGS.band) {
    const [lo, hi] = ARGS.band.split('-').map(Number);
    setBand({ lo, hi });
  }
  if (cmd === 'candidates') cmdCandidates(ARGS);
  else if (cmd === 'finalists') cmdFinalists(ARGS);
  else {
    console.error('usage: analyze.js candidates|finalists [--in x] [--out y]');
    process.exit(1);
  }
}
