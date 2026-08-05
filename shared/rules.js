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
// The starting numbers came from the balance study in scripts/sim; later live
// rules changes may supersede that historical recommendation.

// Hand limits rise when the Revolution reaches a new tier. The opening values
// descend cleanly with table size; the larger limits are unlocked before the
// tier-ending Spoils are dealt.
export const HAND_SIZE_BY_TIER = {
  1: { J: 5, Q: 6, K: 7 },
  2: { J: 5, Q: 6, K: 7 },
  3: { J: 4, Q: 5, K: 6 },
  4: { J: 4, Q: 5, K: 6 },
};
export const HAND_SIZE = Object.fromEntries(
  Object.entries(HAND_SIZE_BY_TIER).map(([n, tiers]) => [n, tiers.J]),
);

// La Constitution offers one difficulty. It changes how hard every royal
// strikes while leaving the rest of the rules stable and teachable.
export const DIFFICULTY = {
  hard: { royalStrikeBonus: { 1: 2, 2: 2, 3: 2, 4: 2 } },
  medium: { royalStrikeBonus: { 1: 0, 2: 0, 3: 0, 4: 0 } },
  easy: { royalStrikeBonus: { 1: -2, 2: -2, 3: -2, 4: -2 } },
};

export const RULE_SPEC = {
  // The one dial the table is asked about.
  difficulty: {
    label: 'Difficulté',
    values: ['hard', 'medium', 'easy'],
    default: 'medium',
    exposed: true,
  },
  // Les Dépouilles — cards every citoyen draws when a royal falls, never past
  // their hand limit. Worth more than the whole difficulty slider at a small
  // table, so it is offered as its own choice rather than folded into one.
  drawOnVictory: {
    label: 'Les Dépouilles',
    values: [0, 1, 2],
    bySize: { 1: 2, 2: 0, 3: 0, 4: 0 },
    exposed: false,
  },

  // After the fourth Officer and fourth Queen fall, every citoyen draws one
  // card (still capped by the newly raised limit). At multiplayer tables this
  // is the tier's only Spoil; they receive none after individual royals. Solo
  // already takes its Spoils after every royal, so it gets nothing extra here —
  // the raised hand limit and the earned Regroup are the transition's reward.
  transitionDraw: {
    label: 'Tier-transition draw',
    values: [0, 1],
    bySize: { 1: 0, 2: 1, 3: 1, 4: 1 },
    exposed: false,
  },

  // ---- set by the difficulty, and adjustable on their own for study ---------

  // null means "whatever the chosen difficulty gives".
  regroups: {
    label: 'Regroups',
    values: [0, 1, 2, 3],
    bySize: { 1: 1, 2: 1, 3: 1, 4: 1 },
    exposed: false,
  },
  // Solo begins with one Regroup and earns another on entering each new tier.
  // Unspent Regroups remain in the pool, so all three can be carried to Kings —
  // banking them for the Kings is the strongest line solo has, and the balance
  // study says taking that away costs roughly ten points of win rate.
  regroupOnTransition: {
    label: 'Regroups gained at tier transitions',
    values: [0, 1],
    bySize: { 1: 1, 2: 0, 3: 0, 4: 0 },
    exposed: false,
  },
  // How many cards each citoyen takes when a Regroup is a shared draw rather
  // than a reshuffle. Never past their hand limit — which is why there is no
  // point offering more than four: at these hand sizes a draw of four already
  // fills a depleted hand and the cap eats the rest.
  regroupDraw: {
    label: 'Cards a Regroup draws',
    values: [1, 2, 3, 4],
    bySize: { 1: 3, 2: 2, 3: 3, 4: 3 },
    exposed: false,
  },
  // Added to the base strike of every royal. Kept as an engine rule so the
  // simulator can tune the three difficulty stops against the real game.
  royalStrikeBonus: {
    label: 'Royal power',
    values: [-6, -4, -2, 0, 2, 4, 6],
    fromDifficulty: true,
    exposed: false,
  },
  // Four-player tables give every royal five additional endurance without
  // making the counterattack itself more punishing.
  royalHealthBonus: {
    label: 'Royal endurance bonus',
    values: [0, 5],
    bySize: { 1: 0, 2: 0, 3: 0, 4: 5 },
    exposed: false,
  },

  // ---- the shape of the game, not a difficulty setting ---------------------

  // What a Regroup actually resets. Under the rulebook default, every hand
  // returns to Le Peuple while La Prison stays put; the combined deck is
  // shuffled before fresh hands are dealt around the table.
  regroupScope: {
    label: 'What a Regroup resets',
    // Weakest first. 'draw' resets nothing at all — the table simply takes a
    // few cards from Le Peuple, a far smaller step than any reshuffle.
    values: ['draw', 'caller', 'callerAndPrison', 'table'],
    bySize: { 1: 'table', 2: 'table', 3: 'table', 4: 'table' },
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
    bySize: { 1: 2, 2: 2, 3: 2, 4: 2 },
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
  // takes the blow before play passes clockwise.
  pamphleteerImmune: {
    label: 'The Pamphleteer’s protection',
    values: [true, false],
    default: true,
    exposed: false,
  },
  // Whether the Pamphleteer may take the floor alongside one other card. He
  // breaks immunity before his partner resolves either way, so a companion
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
  const tiers = HAND_SIZE_BY_TIER[n] ?? HAND_SIZE_BY_TIER[2];
  const out = { handSize: tiers.J, handSizes: { ...tiers } };
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
