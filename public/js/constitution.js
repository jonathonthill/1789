// La Constitution — the house-rules menu the host adopts before the Revolution.
// One descriptor table drives the menu, the lobby badges and the help sheet, so
// a rule is only ever named in one place.
import { DEFAULT_RULES, resolveRules, rulebookFor } from '/shared/engine.js';

const STORE_KEY = 'r1789_rules';

// `null` on a count means "whatever the rulebook says for this table size" —
// which is what lets the host fill the menu in before anyone has joined.
const counts = extra => [{ value: null, label: 'Défaut' }, ...extra.map(n => ({ value: n, label: String(n) }))];

export const SETTINGS = [
  {
    key: 'regroups',
    label: 'Regroups',
    hint: 'A pool shared by the whole table. At a table, l’Assemblée must carry the motion before one is spent.',
    slider: true,
    options: counts([0, 1, 2, 3]),
  },
  {
    key: 'pamphleteers',
    label: 'Pamphleteers',
    hint: 'How many shuffle into Le Peuple. At zero, no royal ever loses its suit immunity — the hardest setting here.',
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
];

// Which engine table each "Défaut" option actually reads from.
const RULEBOOK_KEYS = { regroups: 'regroups', pamphleteers: 'pamphleteers', handSizeDelta: 'handSize' };

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
