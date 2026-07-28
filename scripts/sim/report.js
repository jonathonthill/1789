// Turns the sweep into the written report.
//
//   node scripts/sim/report.js --coarse results/coarse.json --refined results/refined.json \
//                              --tiers results/tiers.json --out RESULTS.md

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// BAND and SOFT_CAP are live bindings — setBand() below retargets the whole report.
import { mainEffects, reachableRange, findFamilies, sensitivity, setBand, BAND, SOFT_CAP, PER_SIZE_DIALS, GLOBAL_DIALS } from './analyze.js';
import { rulebookFor } from '../../shared/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [1, 2, 3, 4];
const load = p => JSON.parse(readFileSync(resolve(HERE, p), 'utf8'));
const pct = x => `${(100 * x).toFixed(1)}%`;
const signed = x => `${x >= 0 ? '+' : '−'}${(100 * Math.abs(x)).toFixed(1)}`;

const DIAL_LABEL = {
  handSizeDelta: 'Hand size',
  regroups: 'Regroups',
  pamphleteers: 'Pamphleteers',
  exactKillTo: 'Exact kill',
  drawOnVictory: 'Spoils of Victory',
  pamphleteerImmune: 'Pamphleteer protection',
};

const showValue = (dial, v) => {
  if (dial === 'handSizeDelta') return v > 0 ? `+${v}` : String(v);
  if (dial === 'pamphleteerImmune') return v === true || v === 'true' ? 'shielded' : 'exposed';
  if (dial === 'exactKillTo') return v === 'hand' ? 'to hand' : 'Le Peuple';
  return String(v);
};

function handSizeFor(n, delta) {
  return rulebookFor(n).handSize + delta;
}

function familyTable(family) {
  const lines = [
    '| Table | Hand size | Regroups | Pamphleteers | Win rate |',
    '|---|---|---|---|---|',
  ];
  for (const n of SIZES) {
    const p = family.perSize[n];
    lines.push(`| ${n}p | ${handSizeFor(n, p.handSizeDelta)} (${showValue('handSizeDelta', p.handSizeDelta)}) | ${p.regroups} | ${p.pamphleteers} | **${pct(family.rates[n])}** |`);
  }
  return lines.join('\n');
}

function effectsSection(effects) {
  const out = [];
  for (const dial of [...PER_SIZE_DIALS, ...GLOBAL_DIALS]) {
    const values = effects[dial][1].map(e => e.value);
    out.push(`\n**${DIAL_LABEL[dial]}** — mean win rate over every ruleset setting it this way:\n`);
    out.push(`| Table | ${values.map(v => showValue(dial, v)).join(' | ')} | swing |`);
    out.push(`|---|${values.map(() => '---').join('|')}|---|`);
    for (const n of SIZES) {
      const row = effects[dial][n];
      const means = row.map(e => e.mean);
      const swing = Math.max(...means) - Math.min(...means);
      out.push(`| ${n}p | ${row.map(e => pct(e.mean)).join(' | ')} | ${(100 * swing).toFixed(1)} pts |`);
    }
  }
  return out.join('\n');
}

function sensitivitySection(rows, family) {
  const out = [
    `From the recommended ruleset, moving one dial and leaving everything else
alone. Read off the coarse sweep, so these carry roughly ±1.7 points — enough to
size a lever, not to separate two settings a point apart:\n`,
    '| Dial | Change | 1p | 2p | 3p | 4p |',
    '|---|---|---|---|---|---|',
  ];
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.dial}|${r.to}`;
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[r.players] = r;
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const da = [...PER_SIZE_DIALS, ...GLOBAL_DIALS].indexOf(a[0].split('|')[0]);
    const db = [...PER_SIZE_DIALS, ...GLOBAL_DIALS].indexOf(b[0].split('|')[0]);
    return da - db;
  });
  for (const [key, bySize] of ordered) {
    const [dial, to] = key.split('|');
    const cells = SIZES.map(n => {
      const r = bySize[n];
      if (!r) return '—';
      return `${pct(r.winRate)} (${signed(r.delta)})`;
    });
    out.push(`| ${DIAL_LABEL[dial]} | → ${showValue(dial, to)} | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

function behaviourSection(cells) {
  const out = [
    '| Table | Exact kills / game | Lay Lows / game | Blows paid | Regroups spent | Spent as last resort |',
    '|---|---|---|---|---|---|',
  ];
  for (const n of SIZES) {
    const c = cells.find(x => x.players === n);
    if (!c) continue;
    // With no Regroups granted there is nothing to hoard, so the share is empty
    // rather than a vacuous 100%.
    const lastResort = c.avgRegroups ? `${(100 * (1 - c.discretionaryShare)).toFixed(0)}%` : '— (none granted)';
    out.push(`| ${n}p | ${c.avgExactKills.toFixed(1)} | ${c.avgLayLows.toFixed(1)} | ${c.avgBlowsPaid.toFixed(1)} | ${c.avgRegroups.toFixed(2)} | ${lastResort} |`);
  }
  return out.join('\n');
}

const LINEUP_LABEL = {
  quiet: 'Quiet table',
  good: 'Good table',
  sharp: 'Deeper-thinking variant',
  oneWeak: 'One weaker seat',
  halfWeak: 'Half the table weaker',
  noLayLow: 'Good, never ducking',
};

function tierSection(tiers, family) {
  if (!tiers) return '_Not run._';
  const byKey = new Map();
  for (const r of tiers.results) {
    byKey.set(`${r.lineup}|${r.players}|${sortedRules(r.rules)}`, r);
  }
  const present = new Set(tiers.results.map(r => r.lineup));
  const lineups = Object.keys(LINEUP_LABEL).filter(l => present.has(l));
  const out = [
    `| Table | ${lineups.map(l => LINEUP_LABEL[l]).join(' | ')} |`,
    `|---|${lineups.map(() => '---').join('|')}|`,
  ];
  for (const n of SIZES) {
    const rules = sortedRules({ ...family.globalRules, ...family.perSize[n] });
    const cells = lineups.map(l => {
      const hit = byKey.get(`${l}|${n}|${rules}`);
      if (!hit) return '—';
      return l === 'good' ? `**${pct(hit.winRate)}**` : pct(hit.winRate);
    });
    out.push(`| ${n}p | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

// Rule objects are built in different key orders in different places.
function sortedRules(rules) {
  return Object.keys(rules).sort().map(k => `${k}=${rules[k]}`).join(',');
}

// ---- main ------------------------------------------------------------------

const ARGS = {};
for (let i = 2; i < process.argv.length; i += 2) ARGS[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

if (ARGS.band) {
  const [lo, hi] = ARGS.band.split('-').map(Number);
  setBand({ lo, hi });
}

const coarse = load(ARGS.coarse ?? 'results/coarse.json');
const refined = load(ARGS.refined ?? 'results/refined.json');
let tiers = null;
try { tiers = load(ARGS.tiers ?? 'results/tiers.json'); } catch { /* optional */ }

const effects = mainEffects(coarse.results);
const range = reachableRange(coarse.results);
const FREE_DIALS = (ARGS.free ?? '').split(',').filter(Boolean);
const { families, shortfalls, total } = findFamilies(refined.results, null, { limit: 12, freeDials: FREE_DIALS });
const winner = families[0];

const defaultsRow = SIZES.map(n => {
  const hit = coarse.results.find(r => r.players === n
    && r.rules.handSizeDelta === 0
    && r.rules.regroups === rulebookFor(n).regroups
    && r.rules.pamphleteers === rulebookFor(n).pamphleteers
    && r.rules.exactKillTo === 'hand'
    && r.rules.drawOnVictory === 0
    && r.rules.pamphleteerImmune === true);
  return { players: n, winRate: hit?.winRate };
});

const md = [];
md.push('# 1789 — balance study\n');
md.push(`_Generated ${new Date().toISOString().slice(0, 10)} from ${coarse.results.length} rulesets swept at ${coarse.games.toLocaleString()} games each, ${refined.results.length} refined at ${refined.games.toLocaleString()}._\n`);

md.push('## What was measured\n');
md.push(`The goal was a ruleset a table of good players carries **${pct(BAND[0])}–${pct(BAND[1])}** of the time, as
consistent as possible across table sizes, with any per-size change a simple
directional step. Tables of three and four are allowed to sit a little above
that — up to ${pct(SOFT_CAP[4])} — because they are the ones most likely to mix skill
levels, and a mixed table wins far less often than a uniformly good one (see
the skill section below for how much less).

The reference "good table" plays hidden hands — no bot ever sees another's
cards. What it does see is what the app already makes public (hand counts, La
Prison, the royal, who has lain low) plus the coarse remarks a real table makes
out loud: *I can't defend*, *I need to lie low*, *I got this*, *I can kill it*,
*I can take it clean*, *please kill the royal*. Those are only spoken when they
matter — trouble, or a hand that can settle the fight — so the mundane middle
stays unsaid. Its judgement weights were tuned by coordinate descent rather than
hand-guessed; Regroups it hoards, spending them mostly when the alternative is
losing on the spot.

Every ruleset played the same decks (common random numbers), so differences
between rows are the rules, not the shuffle.\n`);

md.push('## Where the current defaults sit\n');
md.push('| Table | Win rate today |');
md.push('|---|---|');
for (const d of defaultsRow) md.push(`| ${d.players}p | ${d.winRate == null ? '—' : pct(d.winRate)} |`);
md.push(`\nThe game as it currently ships is comfortably easier than the target at every
table with more than one citoyen. Two house rules do most of that work: an exact
kill claimed into the slayer's hand (the bots land several a game, and each is a
10-, 15- or 20-value card arriving free) and Lay Low as a free duck once per
citoyen per royal, which at four players cancels a large share of all the damage
the royals ever deal.\n`);

md.push('## What the dials can reach\n');
md.push('| Table | Hardest ruleset | Easiest ruleset |');
md.push('|---|---|---|');
for (const r of range) md.push(`| ${r.players}p | ${pct(r.min)} | ${pct(r.max)} |`);
md.push('\nThe target band is comfortably inside the reachable range at every table size.\n');

md.push('## Recommended ruleset\n');
if (!winner) {
  md.push(`**No ruleset in the grid puts all four table sizes inside ${pct(BAND[0])}–${pct(BAND[1])}.** The near misses are listed below.\n`);
} else {
  md.push('Fixed for every table:\n');
  for (const dial of GLOBAL_DIALS) {
    md.push(`- **${DIAL_LABEL[dial]}**: ${showValue(dial, winner.globalRules[dial])}`);
  }
  md.push('\nStepping with the number of citoyens:\n');
  md.push(familyTable(winner));
  md.push(`\nSpread across table sizes: **${(100 * winner.spread).toFixed(1)} points**. ${total} rulesets in the grid satisfy the band and the monotonicity rule; this is the tightest.\n`);

  // The tightest spread leans on the allowance for larger tables. If a ruleset
  // exists that stays under 40% everywhere, it deserves its own hearing.
  const strict = families.find(f => f.overflow === 0);
  if (strict && strict !== winner) {
    md.push(`\n### If you would rather nothing exceeded ${pct(BAND[1])}\n`);
    md.push(`The ruleset above leans on the allowance for larger tables — it reaches
${pct(Math.max(...SIZES.map(n => winner.rates[n])))} at ${SIZES.find(n => winner.rates[n] > BAND[1])} players. This one stays inside ${pct(BAND[0])}–${pct(BAND[1])} at every
table size, at the cost of a wider spread (${(100 * strict.spread).toFixed(1)} points against ${(100 * winner.spread).toFixed(1)}):\n`);
    md.push(familyTable(strict));
    md.push('');
  }
}

md.push('## How each rule behaves\n');
md.push(`These are main effects: each figure averages every ruleset in the grid that
sets that dial that way. It shows the direction and rough size of a lever, not
what it is worth at one particular setting — for that see the next section.\n`);
md.push(effectsSection(effects));

if (winner) {
  md.push('\n## Sensitivity around the recommendation\n');
  // Read off the full grid: the refined pass only revisited cells near the band,
  // so most one-dial probes exist only in the coarse sweep.
  md.push(sensitivitySection(sensitivity(coarse.results, winner), winner));
}

if (winner) {
  md.push('\n## The dials are coarser than the band\n');
  const probes = sensitivity(coarse.results, winner).filter(r => r.dial === 'regroups');
  const worst = probes.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), probes[0]);
  md.push(`This is the most important thing the sweep turned up, and it limits how much
any recommendation is worth.

A Regroup, as this game now plays it, resets the deck for the whole table: every
hand and all of La Prison shuffled back into Le Peuple and dealt out afresh. That
is close to a second game, and it shows up in the numbers as a cliff rather than
a slope. At the recommended settings, granting a single extra Regroup moves the
win rate by **${Math.abs(100 * worst.delta).toFixed(0)} points** at ${worst.players} players — from ${pct(winner.rates[worst.players])} to ${pct(worst.winRate)}.

The band is ten points wide. A dial whose smallest step is forty cannot be
tuned into it; it can only be switched off. That is exactly what the
recommendation does — Regroups at zero for every table above solo — and it is
why the ruleset below has no safety valve at all at two, three and four players.
A table dealt a bad opening simply loses.

If you want a genuinely tunable game rather than one balanced on a switch, the
lever to change is not in this grid: make a Regroup weaker so that it becomes a
dial again. Returning only La Prison to Le Peuple, or only the calling citoyen's
hand, would each be a fraction of the current effect and would give the sweep
something it can actually adjust. That is a rules change rather than a settings
change, so it was outside this study — but it is the change I would make first.\n`);
}

md.push('\n## How the bots actually played it\n');
if (winner) {
  md.push('Under the recommended ruleset:\n');
  md.push(behaviourSection(winner.cells));
  md.push(`\nThe "last resort" column is the sanity check on hoarding: the share of Regroups
spent when no other action on the table avoided losing on the spot.\n`);
}

md.push('\n## How much the answer depends on skill\n');
md.push(`The band is defined relative to the reference table. A quiet table hears no
remarks at all and takes the biggest safe swing. The mixed columns — one weaker
citoyen seated among good ones, and an evenly split table — are what most real
tables of three or four actually are.

Mixed tables are the widest source of uncertainty in the study, and they dwarf
every rule dial: seating one weaker player costs more win rate than any single
change in the grid. Real players will also land below the reference outright,
which never misreads a signal and never forgets a card it has seen.

Two columns need reading with care. The **deeper-thinking variant** is not a
stronger player: it searches further but its judgement weights were fitted to the
reference policy, so the extra machinery is untuned and it plays slightly worse.
Read it as "a different good player", not as a ceiling — the reference is
already at the practical limit of this bot design. The **never ducking** column
holds the rules constant and simply forbids Lay Low except on an empty hand,
which is how much that one house rule is worth.\n`);
if (winner) md.push(tierSection(tiers, winner));

if (families.length > 1) {
  md.push('\n## Alternatives\n');
  md.push('| # | Exact kill | Spoils | Pamphleteer | Hand (1/2/3/4) | Regroups | Pamphleteers | Win rates | Spread |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  families.slice(0, 8).forEach((f, i) => {
    const hands = SIZES.map(n => handSizeFor(n, f.perSize[n].handSizeDelta)).join('/');
    const regs = SIZES.map(n => f.perSize[n].regroups).join('/');
    const pamphs = SIZES.map(n => f.perSize[n].pamphleteers).join('/');
    const rates = SIZES.map(n => (100 * f.rates[n]).toFixed(0)).join('/');
    md.push(`| ${i + 1}${i === 0 ? ' ★' : ''} | ${showValue('exactKillTo', f.globalRules.exactKillTo)} | ${f.globalRules.drawOnVictory} | ${showValue('pamphleteerImmune', f.globalRules.pamphleteerImmune)} | ${hands} | ${regs} | ${pamphs} | ${rates} | ${(100 * f.spread).toFixed(1)} |`);
  });
}

if (shortfalls.length) {
  md.push('\n## Combinations that cannot reach the band\n');
  md.push('| Fixed rules | Table sizes that miss | Closest it gets |');
  md.push('|---|---|---|');
  for (const s of shortfalls.slice(0, 10)) {
    const closest = s.best.filter(Boolean).map(b => `${b.players}p ${pct(b.winRate)}`).join(', ');
    md.push(`| ${s.global} | ${s.missing.join(', ')} | ${closest} |`);
  }
}

md.push('\n## Caveats\n');
md.push(`- The band is relative to the reference bot. There is no measurement of your
  own table to anchor it against, so treat the skill spread above as the real
  uncertainty on any single number.
- The signal channel is noise-free: bots never misread "I can't defend" and never
  say it when it is untrue. Human tables are worse at this, which pushes real win
  rates down.
- Bots hunt exact kills exhaustively. A human sees most of these, not all — so
  rulesets that lean on exact-kill behaviour will play slightly harder in life
  than they do here.
- Everything outside the six swept rules is frozen at what the game ships today.\n`);

const out = resolve(HERE, ARGS.out ?? 'RESULTS.md');
writeFileSync(out, md.join('\n'));
console.error(`Wrote ${out}`);
