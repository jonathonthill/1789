// SVG card rendering for 1789.
// Royals carry period paintings; number cards show rank+suit in the corners and
// a power icon medallion in the middle; the shared card back is a fleur-de-lis.
import { enemyMeta } from '/shared/theme.js';

const RED = '#9e2235', INK = '#26211a', FACE = '#f7f0df';
const GOLD = '#b08d2c', GOLD_HI = '#d9bc63', BLUE = '#1b2a5e', BLUE_DEEP = '#101c40';
const CRIMSON_DEEP = '#741526';
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SERIF = `'Cinzel', Georgia, serif`;

export function suitColor(s) { return (s === 'H' || s === 'D') ? RED : INK; }
export function rankLabel(r) { return r === 'X' ? '0' : String(r); }

export function miniLabel(card) {
  if (card.r === 'X') return '0✒';
  return `${card.r}${SUIT_GLYPH[card.s] ?? ''}`;
}

// ── the fleur-de-lis motif (used on backs, decks, and the board) ────────────
export const FLEUR_PATH = `
  M50 3
  C44 16 39 25 40 36 C41 43 46 49 48 56
  C43 54 39 49 34 43 C28 36 22 31 15 32
  C8 33 4 39 5 46 C6 54 13 59 24 60
  C18 55 17 49 20 46 C23 42 29 45 34 52
  C39 59 42 62 42 66 H58
  C58 62 61 59 66 52 C71 45 77 42 80 46
  C83 49 82 55 76 60 C87 59 94 54 95 46
  C96 39 92 33 85 32 C78 31 72 36 66 43
  C61 49 57 54 52 56 C54 49 59 43 60 36
  C61 25 56 16 50 3 Z
  M25 63 H75 V72 H25 Z
  M42 72 H58 C58 82 63 89 70 96 H30 C37 89 42 82 42 72 Z`;

export function fleur(x, y, size, fill, opacity = 1) {
  const k = size / 100;
  return `<path d="${FLEUR_PATH}" transform="translate(${x},${y}) scale(${k})" fill="${fill}" opacity="${opacity}"/>`;
}

// ── card back ───────────────────────────────────────────────────────────────
// Deep crimson (not the royal blue used on card faces) so a fanned opponent
// hand reads clearly against the board instead of blending into it.
export function cardBackSVG() {
  return `<svg viewBox="0 0 240 336" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="234" height="330" rx="16" fill="${RED}" stroke="${CRIMSON_DEEP}" stroke-width="3"/>
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
  // One size for every rank so numbers never shift vertically; the two-glyph
  // '10' keeps that height and is condensed horizontally to fit the corner.
  const wide = String(label).length > 1;
  const rank = `<text x="34" y="52" font-size="46"${wide ? ' textLength="42" lengthAdjust="spacingAndGlyphs"' : ''}>${label}</text>`;
  // Blocked-power slash: an angled stroke in the opposite colour, hidden until a
  // hand card carries the .power-off class (see main.js / style.css).
  const slash = (card.s === 'H' || card.s === 'D') ? INK : RED;
  return `
    <g fill="${col}" font-family="${SERIF}" font-weight="700" text-anchor="middle">
      ${rank}
      <text class="corner-suit" x="34" y="88" font-size="34">${glyph}</text>
    </g>
    <line class="corner-suit-slash" x1="18" y1="91" x2="50" y2="61" stroke="${slash}" stroke-width="5.5" stroke-linecap="round"/>`;
}

function frame() {
  return `
    <rect x="3" y="3" width="234" height="330" rx="16" fill="${FACE}" stroke="#b9a370" stroke-width="2.5"/>
    <rect x="10" y="10" width="220" height="316" rx="11" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity=".5"/>`;
}

// ── power icons for number cards ────────────────────────────────────────────
// The illustrated medallions were lifted from the printed card artwork and
// live as transparent PNGs in /img/powers/{suit}.png (the gold ring is baked
// into each image, so numberArt draws no ring of its own).
const POWER_WORD = { H: 'RALLY LE PEUPLE!', D: 'RAID LA PRISON!', C: 'RISE EN MASSE!', S: 'A LA BARRICADE!' };
const POWER_ACTION = { H: 'RECRUIT CARDS', D: 'FREE PRISONERS', C: 'DOUBLE DAMAGE', S: 'LOWER ATTACK' };
// One size for every card, sized to fit the longest title ('RALLY LE PEUPLE!').
const POWER_WORD_SIZE = 18;
const POWER_ACTION_SIZE = 15;

// The two-line title/effect box shared by number cards and the Sans-Culotte Ace.
// The Ace overrides the colours (a red box) to flag its special nature.
function powerBox(title, action, o) {
  return `
    <rect x="17" y="253" width="206" height="66" rx="9" fill="${o.fill}" stroke="${o.stroke}" stroke-width="1.5"/>
    <text class="pb-title" x="120" y="281" font-size="${o.titleSize ?? POWER_WORD_SIZE}" text-anchor="middle" fill="${o.titleFill}"
      font-family="${SERIF}" font-weight="700" letter-spacing="0.4">${title}</text>
    <text class="pb-effect" x="120" y="306" font-size="${POWER_ACTION_SIZE}" text-anchor="middle" fill="${o.actionFill}" opacity="${o.actionOpacity}"
      font-family="${SERIF}" font-weight="700" letter-spacing=".25">${action}</text>`;
}

function numberArt(card) {
  return `
    <image href="/img/powers/${card.s}.png" x="12" y="40" width="216" height="216"/>
    ${powerBox(POWER_WORD[card.s], POWER_ACTION[card.s], {
      fill: '#f1e7cf', stroke: GOLD, titleFill: suitColor(card.s), actionFill: INK, actionOpacity: '.76' })}`;
}

// ── royals: period paintings in a gilt frame ────────────────────────────────
let uid = 0;
function royalArt(card, opts) {
  const meta = enemyMeta(card);
  const id = `clip${card.r}${card.s}${++uid}`;
  return `
    <defs><clipPath id="${id}"><rect x="22" y="24" width="196" height="240" rx="8"/></clipPath></defs>
    <rect x="17" y="19" width="206" height="300" rx="11" fill="${BLUE_DEEP}" stroke="${GOLD}" stroke-width="4"/>
    <image href="/img/enemies/${card.r}${card.s}.jpg" x="22" y="24" width="196" height="240"
      preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"/>
    <rect x="22" y="24" width="196" height="240" rx="8" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity=".7"/>
    <rect x="20" y="267" width="200" height="50" rx="6" fill="${BLUE}"/>
    <text x="120" y="${opts.subtitle ? 289 : 298}" font-size="${meta.name.length > 17 ? 16 : 19}" text-anchor="middle"
      fill="#f2ead2" font-family="${SERIF}" font-weight="700">${meta.name}</text>
    ${opts.subtitle ? `<text x="120" y="309" font-size="12.5" text-anchor="middle" fill="${GOLD_HI}"
      font-family="Georgia, serif" font-style="italic">${meta.title}</text>` : ''}`;
}

// Royals carry a single corner index over the painting (the rotated twin would
// collide with the name banner), with a paper halo for legibility.
function royalCorners(card) {
  const col = suitColor(card.s);
  const slash = (card.s === 'H' || card.s === 'D') ? INK : RED;
  return `
    <g font-family="${SERIF}" font-weight="700" text-anchor="middle">
      <g stroke="${FACE}" stroke-width="3.5" stroke-linejoin="round" fill="${FACE}">
        <text x="36" y="54" font-size="36">${card.r}</text>
        <text class="corner-suit" x="36" y="86" font-size="27">${SUIT_GLYPH[card.s]}</text>
      </g>
      <g fill="${col}">
        <text x="36" y="54" font-size="36">${card.r}</text>
        <text class="corner-suit" x="36" y="86" font-size="27">${SUIT_GLYPH[card.s]}</text>
      </g>
      <line class="corner-suit-slash" x1="23" y1="89" x2="49" y2="65" stroke="${slash}" stroke-width="4.5" stroke-linecap="round"/>
    </g>`;
}

// The Pamphleteer has no suit: value 0 over an upright pen nib (the "suit").
function pamphleteerCorners() {
  return `
    <g fill="${INK}" font-family="${SERIF}" font-weight="700" text-anchor="middle">
      <text x="34" y="52" font-size="46">0</text>
    </g>
    <g transform="translate(34,80)">
      <path d="M0 -14 C3 -6 5.5 -2 5.5 3 L-5.5 3 C-5.5 -2 -3 -6 0 -14 Z" fill="${INK}"/>
      <rect x="-4" y="2.5" width="8" height="12" rx="2.5" fill="${INK}"/>
      <line x1="0" y1="-13" x2="0" y2="1" stroke="${FACE}" stroke-width="1.2"/>
      <circle cx="0" cy="0.5" r="1.4" fill="${FACE}"/>
    </g>`;
}

// ── the specials ────────────────────────────────────────────────────────────
// The Sans-Culotte carries the lifted figure over a red title box.
function companionArt() {
  return `
    <image href="/img/specials/sans-culotte.png" x="55" y="28" width="130" height="200"/>
    ${powerBox('CALL LES RENFORTS!', 'ADD 1 ATTACK', {
      fill: RED, stroke: GOLD, titleFill: '#fbf3dc', actionFill: '#fbf3dc', actionOpacity: '.85', titleSize: 16 })}`;
}
function pamphleteerArt() {
  return `
    <image href="/img/specials/pamphleteer.png" x="60" y="58" width="120" height="149"/>
    <rect x="17" y="239" width="206" height="80" rx="9" fill="${BLUE}" stroke="${GOLD}" stroke-width="1.5"/>
    <text x="120" y="263" font-size="16" text-anchor="middle" fill="#fbf3dc"
      font-family="${SERIF}" font-weight="700" letter-spacing="0.4">THE PAMPHLETEER</text>
    <text x="120" y="287" font-size="13" text-anchor="middle" fill="${GOLD_HI}"
      font-family="${SERIF}" font-weight="700" letter-spacing=".3">SHATTERS IMMUNITY</text>
    <text x="120" y="306" font-size="13" text-anchor="middle" fill="${GOLD_HI}"
      font-family="${SERIF}" font-weight="700" letter-spacing=".3">CHOOSE WHO'S NEXT</text>`;
}

export function cardSVG(card, opts = {}) {
  const isRoyal = card.r === 'J' || card.r === 'Q' || card.r === 'K';
  let center, extra = '', cornerLayer;
  if (isRoyal) {
    center = royalArt(card, opts);
    cornerLayer = royalCorners(card);
  } else if (card.r === 'A') {
    center = companionArt(); cornerLayer = corners(card);
  } else if (card.r === 'X') {
    center = pamphleteerArt(); cornerLayer = pamphleteerCorners();
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

// Two clipped copies let the guillotine visibly separate the card along its
// diagonal blade line without rasterizing or damaging the original card art.
// Each half is a double-sided 3D piece: the card face and the deck back mounted
// back-to-back, so when severFall tumbles the piece its reverse shows the deck
// artwork instead of vanishing (backface-visibility).
export function victimSVG(card) {
  const front = cardSVG(card);
  const back = cardBackSVG();
  const half = (cls, hidden) =>
    `<span class="victim-half ${cls}"${hidden ? ' aria-hidden="true"' : ''}>` +
      `<span class="vh-tumble">` +
        `<span class="vh-face vh-front">${front}</span>` +
        `<span class="vh-face vh-back">${back}</span>` +
      `</span>` +
    `</span>`;
  return half('victim-half-top', false) + half('victim-half-bottom', true);
}
