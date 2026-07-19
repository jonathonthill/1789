// SVG card rendering for 1789.
// Royals carry period paintings; number cards show rank+suit in the corners and
// a power icon medallion in the middle; the shared card back is a fleur-de-lis.
import { enemyMeta } from '/shared/theme.js';

const RED = '#9e2235', INK = '#26211a', FACE = '#f7f0df';
const GOLD = '#b08d2c', GOLD_HI = '#d9bc63', BLUE = '#1b2a5e', BLUE_DEEP = '#101c40';
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SERIF = `'Cinzel', Georgia, serif`;

export function suitColor(s) { return (s === 'H' || s === 'D') ? RED : INK; }
export function rankLabel(r) { return r === 'X' ? '✒' : String(r); }

export function miniLabel(card) {
  if (card.r === 'X') return '🪶P';
  return `${card.r}${SUIT_GLYPH[card.s] ?? ''}`;
}

// ── the fleur-de-lis motif (used on backs, decks, and the board) ────────────
export const FLEUR_PATH = `
  M50 8 C40 22 40 36 50 54 C60 36 60 22 50 8 Z
  M21 27 C9 37 11 53 30 59 C24 49 26 39 34 33 C30 28 24 24 21 27 Z
  M79 27 C91 37 89 53 70 59 C76 49 74 39 66 33 C70 28 76 24 79 27 Z
  M31 61 L69 61 L69 68 L31 68 Z
  M42 70 C42 80 38 87 33 92 L67 92 C62 87 58 80 58 70 Z`;

export function fleur(x, y, size, fill, opacity = 1) {
  const k = size / 100;
  return `<path d="${FLEUR_PATH}" transform="translate(${x},${y}) scale(${k})" fill="${fill}" opacity="${opacity}"/>`;
}

// ── card back ───────────────────────────────────────────────────────────────
export function cardBackSVG() {
  return `<svg viewBox="0 0 240 336" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="234" height="330" rx="16" fill="${BLUE}" stroke="${BLUE_DEEP}" stroke-width="3"/>
    <rect x="12" y="12" width="216" height="312" rx="10" fill="none" stroke="${GOLD}" stroke-width="2.5"/>
    <rect x="19" y="19" width="202" height="298" rx="7" fill="none" stroke="${GOLD}" stroke-width="1" opacity=".55"/>
    ${fleur(28, 28, 26, GOLD, .5)}${fleur(186, 28, 26, GOLD, .5)}
    ${fleur(28, 282, 26, GOLD, .5)}${fleur(186, 282, 26, GOLD, .5)}
    <circle cx="120" cy="158" r="58" fill="none" stroke="${GOLD}" stroke-width="2"/>
    <circle cx="120" cy="158" r="51" fill="none" stroke="${GOLD}" stroke-width="1" opacity=".55"/>
    ${fleur(84, 118, 72, GOLD_HI)}
    <text x="120" y="252" font-size="26" text-anchor="middle" fill="${GOLD_HI}"
      font-family="${SERIF}" letter-spacing="8">1789</text>
  </svg>`;
}

// ── corners ─────────────────────────────────────────────────────────────────
function corners(card) {
  const col = card.s ? suitColor(card.s) : INK;
  const glyph = card.s ? SUIT_GLYPH[card.s] : '🪶';
  const label = rankLabel(card.r);
  const fs = String(label).length > 1 ? 34 : 46;
  const one = `
      <text x="34" y="52" font-size="${fs}">${label}</text>
      <text x="34" y="88" font-size="34">${glyph}</text>`;
  return `
    <g fill="${col}" font-family="${SERIF}" font-weight="700" text-anchor="middle">
      ${one}
    </g>`;
}

function frame() {
  return `
    <rect x="3" y="3" width="234" height="330" rx="16" fill="${FACE}" stroke="#b9a370" stroke-width="2.5"/>
    <rect x="10" y="10" width="220" height="316" rx="11" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity=".5"/>`;
}

// ── power icons for number cards ────────────────────────────────────────────
// Each is drawn in a 120×120 box centered on (60,60).
const POWER_ICONS = {
  // Rally the People — a tricolor standard
  H: `
    <line x1="38" y1="14" x2="38" y2="108" stroke="#6b4a2f" stroke-width="6" stroke-linecap="round"/>
    <circle cx="38" cy="12" r="5" fill="${GOLD}"/>
    <path d="M42 22 L102 27 Q95 42 102 57 L42 62 Z" fill="#f2ede1" stroke="${INK}" stroke-width="2"/>
    <path d="M42 22 L62 23.7 L62 60.3 L42 62 Z" fill="${BLUE}"/>
    <path d="M82 24.4 Q79 42 84 58.6 L102 57 Q95 42 102 27 Z" fill="${RED}"/>
    <path d="M30 78 a10 10 0 0 1 16 -8 a10 10 0 0 1 16 8 q0 10 -16 22 q-16 -12 -16 -22 Z" fill="${RED}"/>`,
  // Raid the Treasury — a chest flung open, gold heaped and spilling
  D: `
    <path d="M32 54 Q18 22 58 15 Q68 14 71 20 Q45 24 40 52 Z" fill="#5d4326" stroke="${INK}" stroke-width="2.5"/>
    <path d="M32 54 Q40 38 52 44 Q58 32 68 42 Q80 36 88 54 Z" fill="${GOLD_HI}" stroke="#7d6318" stroke-width="2"/>
    <rect x="28" y="54" width="64" height="42" rx="6" fill="#7a5a33" stroke="${INK}" stroke-width="2.5"/>
    <rect x="28" y="54" width="64" height="9" fill="#5d4326"/>
    <rect x="52" y="54" width="16" height="42" fill="#5d4326" opacity=".55"/>
    <circle cx="60" cy="78" r="6" fill="${GOLD_HI}" stroke="#7d6318" stroke-width="2"/>
    <circle cx="18" cy="98" r="9" fill="${GOLD_HI}" stroke="#7d6318" stroke-width="2"/>
    <circle cx="102" cy="92" r="8" fill="${GOLD_HI}" stroke="#7d6318" stroke-width="2"/>
    <circle cx="106" cy="106" r="7" fill="${GOLD_HI}" stroke="#7d6318" stroke-width="2"/>
    <path d="M98 22 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill="${GOLD_HI}"/>`,
  // Fury of the Mob — a burning torch
  C: `
    <path d="M52 58 L68 58 L64 112 L56 112 Z" fill="#6b4a2f" stroke="${INK}" stroke-width="2"/>
    <path d="M48 52 L72 52 L70 62 L50 62 Z" fill="#4d372a" stroke="${INK}" stroke-width="2"/>
    <path d="M60 8 C48 24 44 34 48 44 C50 50 55 53 60 53 C65 53 70 50 72 44 C76 34 72 24 60 8 Z" fill="#c96a2b"/>
    <path d="M60 20 C54 30 52 36 55 43 C57 47 63 47 65 43 C68 36 66 30 60 20 Z" fill="${GOLD_HI}"/>`,
  // Man the Barricades — piled timbers, a barrel, a cartwheel
  S: `
    <path d="M10 110 Q26 98 42 103 Q54 96 66 101 Q80 96 92 103 Q102 99 110 110 Z" fill="#93887a" stroke="${INK}" stroke-width="2"/>
    <rect x="22" y="84" width="80" height="15" rx="4" fill="#7a5a33" stroke="${INK}" stroke-width="2.5"/>
    <rect x="30" y="67" width="62" height="15" rx="4" fill="#8a6a3f" stroke="${INK}" stroke-width="2.5"/>
    <rect x="40" y="50" width="42" height="15" rx="4" fill="#9a7d58" stroke="${INK}" stroke-width="2.5"/>
    <rect x="12" y="60" width="26" height="42" rx="9" fill="#8a5f36" stroke="${INK}" stroke-width="2.5"/>
    <line x1="13" y1="73" x2="37" y2="73" stroke="#4d372a" stroke-width="2.5"/>
    <line x1="13" y1="88" x2="37" y2="88" stroke="#4d372a" stroke-width="2.5"/>
    <circle cx="94" cy="84" r="20" fill="#cbb98b" stroke="${INK}" stroke-width="3"/>
    <line x1="94" y1="66" x2="94" y2="102" stroke="${INK}" stroke-width="2.5"/>
    <line x1="76" y1="84" x2="112" y2="84" stroke="${INK}" stroke-width="2.5"/>
    <line x1="81" y1="71" x2="107" y2="97" stroke="${INK}" stroke-width="2.5"/>
    <line x1="107" y1="71" x2="81" y2="97" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="94" cy="84" r="4.5" fill="${INK}"/>`,
};
const POWER_WORD = { H: 'RALLY', D: 'RAID', C: 'THE MOB ×2', S: 'BARRICADE' };
const POWER_ACTION = { H: 'RECRUIT CARDS', D: 'RESHUFFLE FALLEN', C: 'DOUBLE DAMAGE', S: 'LOWER ATTACK' };
const POWER_ACTION_SIZE = { H: 18, D: 16, C: 18, S: 18 };

function numberArt(card) {
  const col = suitColor(card.s);
  return `
    <circle cx="120" cy="160" r="72" fill="none" stroke="${GOLD}" stroke-width="2"/>
    <circle cx="120" cy="160" r="65" fill="#f1e7cf" stroke="${GOLD}" stroke-width="1" opacity=".9"/>
    <g transform="translate(60,100)">${POWER_ICONS[card.s]}</g>
    <rect x="20" y="238" width="200" height="64" rx="9" fill="#f1e7cf" stroke="${GOLD}" stroke-width="1.5"/>
    <text x="120" y="262" font-size="21" text-anchor="middle" fill="${col}"
      font-family="${SERIF}" font-weight="700" letter-spacing="1.5">${POWER_WORD[card.s]}</text>
    <text x="120" y="287" font-size="${POWER_ACTION_SIZE[card.s]}" text-anchor="middle" fill="${INK}" opacity=".76"
      font-family="${SERIF}" font-weight="700" letter-spacing=".25">${POWER_ACTION[card.s]}</text>`;
}

// ── royals: period paintings in a gilt frame ────────────────────────────────
let uid = 0;
function royalArt(card, opts) {
  const meta = enemyMeta(card);
  const id = `clip${card.r}${card.s}${++uid}`;
  return `
    <defs><clipPath id="${id}"><rect x="22" y="24" width="196" height="240" rx="8"/></clipPath></defs>
    <rect x="17" y="19" width="206" height="250" rx="11" fill="${BLUE_DEEP}" stroke="${GOLD}" stroke-width="4"/>
    <image href="/img/enemies/${card.r}${card.s}.jpg" x="22" y="24" width="196" height="240"
      preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"/>
    <rect x="22" y="24" width="196" height="240" rx="8" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity=".7"/>
    <rect x="16" y="272" width="208" height="${opts.subtitle ? 54 : 44}" rx="8" fill="${BLUE}" stroke="${GOLD}" stroke-width="1.5"/>
    <text x="120" y="${opts.subtitle ? 294 : 300}" font-size="${meta.name.length > 17 ? 16 : 19}" text-anchor="middle"
      fill="#f2ead2" font-family="${SERIF}" font-weight="700">${meta.name}</text>
    ${opts.subtitle ? `<text x="120" y="315" font-size="12.5" text-anchor="middle" fill="${GOLD_HI}"
      font-family="Georgia, serif" font-style="italic">${meta.title}</text>` : ''}`;
}

// Royals carry a single corner index over the painting (the rotated twin would
// collide with the name banner), with a paper halo for legibility.
function royalCorners(card) {
  const col = suitColor(card.s);
  return `
    <g font-family="${SERIF}" font-weight="700" text-anchor="middle">
      <g stroke="${FACE}" stroke-width="7" stroke-linejoin="round" fill="${FACE}">
        <text x="36" y="54" font-size="36">${card.r}</text>
        <text x="36" y="86" font-size="27">${SUIT_GLYPH[card.s]}</text>
      </g>
      <g fill="${col}">
        <text x="36" y="54" font-size="36">${card.r}</text>
        <text x="36" y="86" font-size="27">${SUIT_GLYPH[card.s]}</text>
      </g>
    </g>`;
}

// ── the two specials keep their drawn art, polished ─────────────────────────
function companionArt() {
  return `
    <line x1="168" y1="86" x2="152" y2="252" stroke="#6b4a2f" stroke-width="7" stroke-linecap="round"/>
    <path d="M168 84 L159 56 L168 30 L177 56 Z" fill="#8b929c" stroke="${INK}" stroke-width="2"/>
    <path d="M56 264 q8 -58 52 -60 q44 2 52 60 z" fill="${BLUE}" stroke="${BLUE_DEEP}" stroke-width="2.5"/>
    <path d="M94 212 q14 12 28 0 l-5 30 l-18 0 z" fill="#f2ede1"/>
    <path d="M100 240 l16 0 l-2 10 l-12 0 z" fill="${RED}"/>
    <ellipse cx="108" cy="172" rx="30" ry="34" fill="#e8c39e"/>
    <path d="M78 158 Q78 118 110 112 Q138 108 146 124 Q156 132 148 142 Q141 148 134 141 Q137 131 130 127 Q134 143 137 154 Q108 144 78 158 Z"
      fill="${RED}" stroke="#701626" stroke-width="2.5"/>
    <circle cx="88" cy="148" r="10" fill="${BLUE}" stroke="#f2ede1" stroke-width="2.5"/>
    <circle cx="88" cy="148" r="5" fill="#f2ede1"/>
    <circle cx="88" cy="148" r="2.5" fill="${RED}"/>
    <text x="120" y="284" font-size="14" text-anchor="middle" fill="${INK}" opacity=".55"
      font-family="Georgia, serif" font-style="italic">fights beside one other card · +1</text>`;
}
function pamphleteerArt() {
  return `
    <g transform="rotate(-7 120 176)">
      <rect x="66" y="112" width="108" height="138" rx="4" fill="#fdfaf1" stroke="${INK}" stroke-width="2.5"/>
      <text x="120" y="142" font-size="19" font-family="${SERIF}" font-weight="700" text-anchor="middle" fill="${RED}">LIBERTÉ!</text>
      ${[158, 172, 186, 200, 214, 228].map(y => `<line x1="78" y1="${y}" x2="162" y2="${y}" stroke="${INK}" stroke-width="3" opacity=".5"/>`).join('')}
    </g>
    <path d="M152 238 q46 -34 36 -86 q24 46 -12 96 q-9 9 -16 3 z" fill="${BLUE}" stroke="${BLUE_DEEP}" stroke-width="1.5"/>
    <line x1="154" y1="240" x2="172" y2="258" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <text x="120" y="286" font-size="14" text-anchor="middle" fill="${INK}" opacity=".55"
      font-family="Georgia, serif" font-style="italic">shatters immunity · choose who's next</text>`;
}

function banner(text) {
  return `
    <rect x="24" y="292" width="192" height="32" rx="7" fill="${BLUE}" stroke="${GOLD}" stroke-width="1.5"/>
    <text x="120" y="314" font-size="17" text-anchor="middle" fill="#f2ead2" font-family="${SERIF}" font-weight="700">${text}</text>`;
}

export function cardSVG(card, opts = {}) {
  const isRoyal = card.r === 'J' || card.r === 'Q' || card.r === 'K';
  let center, extra = '', cornerLayer;
  if (isRoyal) {
    center = royalArt(card, opts);
    cornerLayer = royalCorners(card);
  } else if (card.r === 'A') {
    center = companionArt(); extra = banner('Sans-Culotte'); cornerLayer = corners(card);
  } else if (card.r === 'X') {
    center = pamphleteerArt(); extra = banner('The Pamphleteer'); cornerLayer = corners(card);
  } else {
    center = numberArt(card); cornerLayer = corners(card);
  }
  return `<svg viewBox="0 0 240 336" xmlns="http://www.w3.org/2000/svg" role="img">
    ${frame()}
    ${center}
    ${cornerLayer}
    ${extra}
  </svg>`;
}

// The guillotine drops on the royal's card itself.
export function victimSVG(card) {
  return cardSVG(card);
}
