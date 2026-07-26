// La Constitution — the house-rules menu the host adopts before the Revolution.
// One descriptor table drives the menu, the lobby badges and the help sheet, so
// a rule is only ever named in one place.
import { DEFAULT_RULES, resolveRules, rulebookFor } from '/shared/engine.js';

const STORE_KEY = 'r1789_rules';

// `null` on a count means "whatever the rulebook says for this table size" —
// which is what lets the host fill the menu in before anyone has joined.
const counts = extra => [{ value: null, label: 'Rulebook' }, ...extra.map(n => ({ value: n, label: String(n) }))];

export const SETTINGS = [
  {
    key: 'afterKill',
    label: 'After a kill',
    hint: 'Who faces the royal that steps up when one falls.',
    soloOnly: false,
    hideForSolo: true,
    options: [
      { value: 'slayer', label: 'Slayer again', note: 'rulebook' },
      { value: 'next', label: 'Next citoyen' },
      { value: 'choose', label: 'Slayer chooses' },
    ],
  },
  {
    key: 'regroups',
    label: 'Regroups',
    hint: 'A pool shared by the whole table. At a table, l’Assemblée must carry the motion before one is spent.',
    options: counts([0, 1, 2, 3, 4]),
  },
  {
    key: 'pamphleteers',
    label: 'Pamphleteers',
    hint: 'How many shuffle into Le Peuple. At zero, no royal ever loses its suit immunity — the hardest setting here.',
    options: counts([0, 1, 2, 3, 4]),
  },
  {
    key: 'pamphleteerCompanion',
    label: 'Pamphleteer partner',
    hint: 'A Pamphleteer may take one other card along. It attacks through the shattered immunity, and still draws no reprisal.',
    options: [
      { value: false, label: 'Works alone', note: 'rulebook' },
      { value: true, label: 'May take one' },
    ],
  },
  {
    key: 'exactKillToHand',
    label: 'Exact kill',
    hint: 'A royal felled to exactly zero is won over to the Revolution. Where does it go?',
    options: [
      { value: false, label: 'Top of Le Peuple', note: 'rulebook' },
      { value: true, label: 'Slayer’s hand' },
    ],
  },
  {
    key: 'handSizeDelta',
    label: 'Hand size',
    hint: 'Shifts every citoyen’s limit up or down from the rulebook default.',
    options: [
      { value: -1, label: '−1' },
      { value: 0, label: 'Standard', note: 'rulebook' },
      { value: 1, label: '+1' },
    ],
  },
];

// Which engine table each "Rulebook" option actually reads from.
const RULEBOOK_KEYS = { regroups: 'regroups', pamphleteers: 'pamphleteers', handSizeDelta: 'handSize' };

// Spell out what "Rulebook" means at every table size, collapsing table sizes
// that share a value into one run (1–2 → 2, 3–4 → 0). Derived from the engine
// rather than written out, so the hint can never drift from the tables it
// describes. Returns null for settings whose rulebook value is a fixed option
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

export function loadRules() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved ? { ...DEFAULT_RULES, ...saved } : { ...DEFAULT_RULES };
  } catch { return { ...DEFAULT_RULES }; }
}

export function saveRules(rules) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rules)); } catch {}
}

export function isRulebook(rules) {
  return SETTINGS.every(s => (rules?.[s.key] ?? DEFAULT_RULES[s.key]) === DEFAULT_RULES[s.key]);
}

// Short "label: value" pairs for the lobby badge row and the help sheet. Pass the
// table size to turn every "Rulebook" into the number it actually resolves to.
export function summarize(rules, playerCount) {
  const n = Math.min(4, Math.max(1, playerCount || 2));
  const resolved = resolveRules(rules, n);
  const book = rulebookFor(n);
  return SETTINGS
    .filter(s => !(n === 1 && s.hideForSolo))
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
