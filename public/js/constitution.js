// La Constitution — the house-rules menu the host adopts before the Revolution.
// One descriptor table drives the menu, the lobby badges and the help sheet, so
// a rule is only ever named in one place.
import { DEFAULT_RULES, RULE_SPEC, resolveRules, rulebookFor } from '/shared/engine.js';

const STORE_KEY = 'r1789_rules';

// `null` on a count means "whatever the rulebook says for this table size" —
// which is what lets the host fill the menu in before anyone has joined.
const counts = extra => [{ value: null, label: 'Défaut' }, ...extra.map(n => ({ value: n, label: String(n) }))];

// Every rule the register knows how to describe. Which of them the menu
// actually offers is decided by `exposed` in shared/rules.js — a rule can be
// carried here indefinitely, tuned in simulation, and switched on for the table
// by a single word there.
const ALL_SETTINGS = [
  {
    key: 'difficulty',
    label: 'Difficulté',
    hint: 'Each step changes every royal counterattack by 2.',
    slider: true,
    options: [
      { value: 'easy', label: 'Easy' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Hard' },
    ],
  },
  {
    key: 'drawOnVictory',
    label: 'Spoils of Victory',
    hint: 'Every citoyen draws a card when a royal falls, never past their hand limit. Taking the spoils away is the single hardest change on this page — harder than anything the Difficulté slider does.',
    slider: true,
    options: [
      { value: 0, label: 'No' },
      { value: 1, label: 'Yes' },
    ],
  },
  {
    key: 'regroups',
    label: 'La Retraite cards',
    hint: 'A pool shared by the whole table. At a table, l’Assemblée must carry the motion before one is spent.',
    slider: true,
    options: counts([0, 1, 2, 3]),
  },
  {
    key: 'pamphleteers',
    label: 'Pamphleteers',
    hint: 'How many shared, single-use Pamphleteers wait beside the table. At zero, no royal ever loses its suit immunity.',
    slider: true,
    options: counts([0, 1, 2, 3]),
  },
  {
    key: 'handSizeDelta',
    label: 'Hand size',
    hint: 'Shifts every citoyen’s limit up or down from the default for the table size.',
    slider: true,
    options: [
      { value: -1, label: '−1' },
      { value: 0, label: 'Défaut' },
      { value: 1, label: '+1' },
    ],
  },
  {
    key: 'exactKillTo',
    label: 'Exact kill',
    hint: 'Where a royal felled to the last point goes: won over to the slayer’s own hand, or face down atop Le Peuple.',
    slider: true,
    options: [
      { value: 'hand', label: 'To hand' },
      { value: 'peuple', label: 'Le Peuple' },
    ],
  },
  {
    key: 'pamphleteerImmune',
    label: 'The Pamphleteer’s protection',
    hint: 'Legacy setting retained for saved Constitutions; shared Pamphleteers now provoke no reprisal.',
    slider: true,
    options: [
      { value: true, label: 'Shielded' },
      { value: false, label: 'Exposed' },
    ],
  },
];

export const SETTINGS = ALL_SETTINGS.filter(s => RULE_SPEC[s.key]?.exposed);

export function settingHelp(setting) {
  if (setting.key !== 'difficulty') return `<p class="rule-hint">${setting.hint}</p>`;
  return `
    <p class="rule-hint power-hint">${setting.hint}</p>
    <table class="royal-power-table">
      <thead><tr><th scope="col">Royal</th><th scope="col">Easy</th><th scope="col">Medium</th><th scope="col">Hard</th></tr></thead>
      <tbody>
        <tr><th scope="row">Officer</th><td>8</td><td>10</td><td>12</td></tr>
        <tr><th scope="row">Queen</th><td>13</td><td>15</td><td>17</td></tr>
        <tr><th scope="row">King</th><td>18</td><td>20</td><td>22</td></tr>
      </tbody>
    </table>`;
}

// Which engine table each "Défaut" option actually reads from. Only rules whose
// default follows the size of the table belong here; the rest say what they mean
// on the option itself.
const RULEBOOK_KEYS = { pamphleteers: 'pamphleteers', handSizeDelta: 'handSize' };

// Spell out what "Défaut" means at every table size, collapsing table sizes
// that share a value into one run (1–2 → 2, 3–4 → 0). Derived from the engine
// rather than written out, so the hint can never drift from the tables it
// describes. Returns null for settings whose default value is a fixed option
// already marked as such.
export function rulebookRuns(settingKey) {
  const key = RULEBOOK_KEYS[settingKey];
  if (!key) return null;
  const runs = [];
  for (let n = 1; n <= 4; n++) {
    const value = rulebookFor(n)[key];
    const last = runs[runs.length - 1];
    if (last && last.value === value) last.to = n;
    else runs.push({ value, from: n, to: n });
  }
  return runs;
}

// Keep only values the menu can actually still offer. Rules saved by an older
// build (a since-retired option, or a count beyond the slider's range) fall
// back to the défaut rather than sticking at a value nothing can display.
function sanitize(rules) {
  const out = { ...DEFAULT_RULES };
  for (const s of SETTINGS) {
    const v = rules?.[s.key];
    if (s.options.some(o => o.value === v)) out[s.key] = v;
  }
  return out;
}

export function loadRules() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch { return { ...DEFAULT_RULES }; }
}

export function saveRules(rules) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rules)); } catch {}
}

export function isRulebook(rules) {
  return SETTINGS.every(s => (rules?.[s.key] ?? DEFAULT_RULES[s.key]) === DEFAULT_RULES[s.key]);
}

// Short "label: value" pairs for the lobby badge row and the help sheet. Pass the
// table size to turn every "Défaut" into the number it actually resolves to.
export function summarize(rules, playerCount) {
  const n = Math.min(4, Math.max(1, playerCount || 2));
  const resolved = resolveRules(rules, n);
  const book = rulebookFor(n);
  return SETTINGS
    .map(s => {
      let value = resolved[s.key];
      if (s.key === 'handSizeDelta') {
        return { key: s.key, label: s.label, value: `${book.handSize + value}`, standard: value === 0 };
      }
      const opt = s.options.find(o => o.value === value);
      return {
        key: s.key,
        label: s.label,
        value: opt?.label ?? String(value),
        standard: value === resolveRules(null, n)[s.key],
      };
    });
}

// The opening briefing is intentionally about the concrete game at hand, not
// menu controls. It is the player-count column resolved after everyone sits.
export function gameRulesSummary(rules, playerCount) {
  const n = Math.min(4, Math.max(1, playerCount || 1));
  const resolved = resolveRules(rules, n);
  const book = rulebookFor(n);
  const limits = ['J', 'Q', 'K'].map(rank => book.handSizes[rank] + resolved.handSizeDelta);
  const regroup = n === 1
    ? `${resolved.regroups} initially; gain ${resolved.regroupOnTransition} at Queens and Kings — unused La Retraite cards carry forward`
    : `${resolved.regroups} La Retraite card${resolved.regroups === 1 ? '' : 's'} — shuffle every hand into Le Peuple, then redeal to the current limit or until it runs out`;
  const royalPower = {
    easy: 'Easy — Officers / Queens / Kings strike 8 / 13 / 18',
    medium: 'Medium — Officers / Queens / Kings strike 10 / 15 / 20',
    hard: 'Hard — Officers / Queens / Kings strike 12 / 17 / 22',
  }[resolved.difficulty];
  return [
    ['Royal power', royalPower],
    ['Royal endurance', `${20 + resolved.royalHealthBonus} / ${30 + resolved.royalHealthBonus} / ${40 + resolved.royalHealthBonus} for Officers / Queens / Kings`],
    ['Hand limits', `${limits.join(' / ')} for Officers / Queens / Kings`],
    ['Spoils', resolved.drawOnVictory
      ? `${resolved.drawOnVictory} per citoyen after each royal`
      : 'None after individual royals'],
    ['Tier transition', n === 1
      ? 'Hand limit rises and you gain 1 La Retraite at Queens and Kings'
      : 'Each citoyen draws 1 tier Spoil at Queens and Kings'],
    ['Lay Low', n === 1 ? 'Not available alone' : 'Once per citoyen per tier'],
    ['Pamphleteers', `${resolved.pamphleteers} shared — majority vote, zero damage, turn continues`],
    ['La Retraite', regroup],
  ];
}
