// Régicide 1789 — the rule register.
//
// Every house rule the engine knows how to obey lives here, forever, whether or
// not La Constitution currently offers it. `exposed` is the only thing that
// decides which ones the menu renders: flipping a rule on or off for the table
// is a one-word change here, and the engine, the server and the balance
// simulations all keep reading the same register.
//
// `bySize` marks a rule whose default follows the size of the table — the menu
// shows those as "Défaut (n)" and stores null until the host overrides them.
// Everything else has one default for every table.
//
// The numbers here come from the balance study in scripts/sim; its findings and
// the reasoning behind each value are written up in scripts/sim/RECOMMENDATION.md.

export const HAND_SIZE = { 1: 8, 2: 6, 3: 5, 4: 5 };

// La Constitution offers one difficulty. It moves both the number of Regroups
// and the size of a shared refill, while preserving the table-size ladder.
export const DIFFICULTY = {
  hard: { regroups: { 1: 1, 2: 0, 3: 1, 4: 1 }, regroupDraw: { 1: 2, 2: 1, 3: 2, 4: 2 } },
  medium: { regroups: { 1: 2, 2: 1, 3: 2, 4: 2 }, regroupDraw: { 1: 3, 2: 2, 3: 3, 4: 3 } },
  easy: { regroups: { 1: 3, 2: 2, 3: 3, 4: 3 }, regroupDraw: { 1: 4, 2: 3, 3: 4, 4: 4 } },
};

export const RULE_SPEC = {
  // The one dial the table is asked about.
  difficulty: {
    label: 'Difficulté',
    values: ['hard', 'medium', 'easy'],
    default: 'medium',
    // Kept in the register for future tuning, but intentionally not offered in
    // La Constitution until the table-size effects are better matched.
    exposed: false,
  },
  // Les Dépouilles — cards every citoyen draws when a royal falls, never past
  // their hand limit. Worth more than the whole difficulty slider at a small
  // table, so it is offered as its own choice rather than folded into one.
  drawOnVictory: {
    label: 'Les Dépouilles',
    values: [0, 1, 2],
    default: 1,
    exposed: false,
  },

  // ---- set by the difficulty, and adjustable on their own for study ---------

  // null means "whatever the chosen difficulty gives".
  regroups: {
    label: 'Regroups',
    values: [0, 1, 2, 3],
    fromDifficulty: true,
    exposed: false,
  },
  // How many cards each citoyen takes when a Regroup is a shared draw rather
  // than a reshuffle. Never past their hand limit — which is why there is no
  // point offering more than four: at these hand sizes a draw of four already
  // fills a depleted hand and the cap eats the rest.
  regroupDraw: {
    label: 'Cards a Regroup draws',
    values: [1, 2, 3, 4],
    fromDifficulty: true,
    exposed: false,
  },

  // ---- the shape of the game, not a difficulty setting ---------------------

  // What a Regroup actually resets. A lone citoyen has no table to keep a hand
  // for, so alone it is the rulebook's own solo move — throw the hand away and
  // draw a fresh one. At a table it is a shared draw instead: nobody has to
  // sacrifice a hand they may have been holding for a reason.
  regroupScope: {
    label: 'What a Regroup resets',
    // Weakest first. 'draw' resets nothing at all — the table simply takes a
    // few cards from Le Peuple, a far smaller step than any reshuffle.
    values: ['draw', 'caller', 'callerAndPrison', 'table'],
    bySize: { 1: 'caller', 2: 'draw', 3: 'draw', 4: 'draw' },
    exposed: false,
  },
  handSizeDelta: {
    label: 'Hand size',
    values: [-1, 0, 1],
    default: 0,
    exposed: false,
  },
  pamphleteers: {
    label: 'Pamphleteers',
    values: [0, 1, 2, 3],
    bySize: { 1: 2, 2: 2, 3: 2, 4: 3 },
    exposed: false,
  },
  // Where an exact kill sends the royal: won over to the slayer's own hand, or
  // face down atop Le Peuple for whoever draws next (the rulebook's answer).
  exactKillTo: {
    label: 'Exact kill',
    values: ['hand', 'peuple'],
    default: 'hand',
    exposed: false,
  },
  // Whether the Pamphleteer's player dodges the counterattack. Exposed, he
  // takes the blow and still names who acts next.
  pamphleteerImmune: {
    label: 'The Pamphleteer’s protection',
    values: [true, false],
    default: false,
    exposed: false,
  },
  // Whether the Pamphleteer may take the floor alongside one other card. He
  // shatters immunity before his partner resolves either way, so a companion
  // lands its suit power even on a royal of its own suit.
  pamphleteerCompanion: {
    label: 'The Pamphleteer’s companion',
    values: [false, true],
    default: false,
    exposed: false,
  },
};

export const RULE_KEYS = Object.keys(RULE_SPEC);
export const EXPOSED_RULE_KEYS = RULE_KEYS.filter(k => RULE_SPEC[k].exposed);

// A rule left null means "whatever this table size gets by default", which is
// what lets the host fill the menu in before knowing how many citoyens arrive.
// Rules the difficulty sets are null here for the same reason.
export const DEFAULT_RULES = Object.fromEntries(
  RULE_KEYS.map(k => [k, RULE_SPEC[k].bySize || RULE_SPEC[k].fromDifficulty ? null : RULE_SPEC[k].default]),
);

function fallbackFor(key, n, difficulty) {
  const spec = RULE_SPEC[key];
  if (spec.fromDifficulty) return DIFFICULTY[difficulty][key][n] ?? DIFFICULTY[difficulty][key][1];
  if (spec.bySize) return spec.bySize[n] ?? spec.values[0];
  return spec.default;
}

// The default this table size would be given — the menu renders these as
// "Défaut (n)", and handSize is included for the label even though the rule
// itself is stored as a delta.
export function rulebookFor(n, difficulty = RULE_SPEC.difficulty.default) {
  const out = { handSize: HAND_SIZE[n] ?? 6 };
  for (const k of RULE_KEYS) out[k] = fallbackFor(k, n, difficulty);
  return out;
}

function coerce(key, value, n, difficulty) {
  const spec = RULE_SPEC[key];
  const fallback = fallbackFor(key, n, difficulty);
  if (value == null) return fallback;
  // Numeric rules clamp rather than fall back, so a stale client asking for 5
  // Regroups gets the most it may have instead of silently reverting.
  if (typeof spec.values[0] === 'number') {
    const num = Math.trunc(Number(value));
    if (!Number.isFinite(num)) return fallback;
    return Math.min(spec.values[spec.values.length - 1], Math.max(spec.values[0], num));
  }
  if (typeof spec.values[0] === 'boolean') return typeof value === 'boolean' ? value : fallback;
  return spec.values.includes(value) ? value : fallback;
}

// Fold a partial (and possibly hostile — this runs on the server too) rules
// object into concrete values for a table of n. The difficulty resolves first,
// because the rules it governs read their default from it.
export function resolveRules(rules, n) {
  const given = rules ?? {};
  const difficulty = coerce('difficulty', given.difficulty, n, RULE_SPEC.difficulty.default);
  return Object.fromEntries(RULE_KEYS.map(k => [k, coerce(k, given[k], n, difficulty)]));
}
