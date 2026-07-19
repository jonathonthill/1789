// Context-dependent help: status strip, long-press explainers, help panel.
import { SUIT_META, TERMS, enemyMeta, suitPowerLine } from '/shared/theme.js';
import { miniLabel } from '/js/cards.js';
import { cardValue, previewPlay } from '/shared/engine.js';

const RANKS = { J: 'Officer', Q: 'Queen', K: 'King' };

function enemyName(view) { return view.enemy ? enemyMeta(view.enemy.card).name : ''; }

// ── the always-on status strip ──────────────────────────────────────────────
export function statusText(view, stagedCount) {
  const cur = view.players[view.current];
  const yourTurn = view.you && view.current === view.you.index;
  const e = view.enemy;

  if (view.phase === 'won') return `<span class="em">Vive la République!</span> The last King is dead.`;
  if (view.phase === 'lost') return `<span class="em">The Revolution is crushed.</span>`;

  if (view.phase === 'jesterChoose') {
    return yourTurn
      ? `Your Pamphleteer struck! <span class="em">Choose who acts next</span> — tap a citoyen's seat, or take the floor yourself below.`
      : `${cur.name}'s Pamphleteer shattered ${enemyName(view)}'s immunity. ${cur.name} chooses who goes next — you may hint whether you want the floor.`;
  }

  if (view.phase === 'discard') {
    if (!yourTurn) return `${enemyName(view)} strikes ${cur.name} for <span class="em">${view.pendingDamage}</span>. They must sacrifice cards to survive.`;
    return `${enemyName(view)} strikes you for <span class="em">${view.pendingDamage}</span>! Tap cards totaling <span class="em">${view.pendingDamage}+</span> to sacrifice, then confirm.`;
  }

  if (view.phase === 'play') {
    if (!yourTurn) return `Awaiting <span class="em">${cur.name}</span>… (they attack ${enemyName(view)} or lay low)`;
    const bits = [`Your turn, citoyen. Tap cards to stage an attack on <span class="em">${enemyName(view)}</span>`];
    if (stagedCount > 0) bits.push(`then press <span class="em">Attack</span>`);
    else if (view.canYield) bits.push(`or <span class="em">Lay Low</span> and take the hit`);
    else bits.push(`— you <span class="em">cannot lay low</span> (everyone else just did)`);
    if (view.you.hand.length === 0) return `You hold no cards. ${view.canYield ? 'You must <span class="em">Lay Low</span>.' : '<span class="em">You cannot act…</span>'}`;
    const eff = e.effectiveAttack;
    bits.push(`&nbsp;⚔️ Strikes back for <span class="em">${eff}</span>${e.shield ? ` (${e.attack}−${e.shield} barricade)` : ''}.`);
    return bits.join(', ').replace(', &nbsp;', ' &nbsp;').replace(', —', ' —');
  }
  return '';
}

// ── long-press / tap explainers ─────────────────────────────────────────────
export function cardInfo(card, view) {
  const v = cardValue(card);
  const e = view.enemy;
  let html = '';
  if (card.r === 'X') {
    html = `<h3>🪶 The Pamphleteer</h3>
      <p>Attack 0, played <b>alone</b>. His exposé <b>shatters the enemy's immunity</b> — suit powers matching the enemy's suit work from then on (even barricades already built).</p>
      <p>You skip the enemy's counterattack and <b>choose any citoyen</b> (or yourself) to act next. Until they act, everyone may hint whether they want the floor — but never what they hold.</p>
      <p>When sacrificed to damage, he is worth <b>0</b>.</p>`;
  } else if (card.r === 'A') {
    html = `<h3>${miniLabel(card)} Sans-Culotte</h3>
      <p>Worth <b>1</b>. May fight alone, or <b>join one other card</b> (even another Sans-Culotte — never the Pamphleteer). The pair's total value fuels <b>both</b> suit powers.</p>
      <p>${suitPowerLine(card.s)}</p>
      <p>Cannot join combos of 2s–5s.</p>`;
  } else if (card.r === 'J' || card.r === 'Q' || card.r === 'K') {
    const meta = enemyMeta(card);
    html = `<h3>${miniLabel(card)} ${meta.name}</h3>
      <p><i>${meta.title} — won to the Revolution and fighting for you.</i></p>
      <p>Attacks for <b>${v}</b> with the full ${SUIT_META[card.s].power} power. Worth <b>${v}</b> when sacrificed to damage.</p>
      <p>${suitPowerLine(card.s)}</p>`;
  } else {
    html = `<h3>${miniLabel(card)} — value ${v}</h3><p>${suitPowerLine(card.s)}</p>`;
    if (card.r >= 2 && card.r <= 5) html += `<p>May combo with other <b>${card.r}s</b> (2–4 cards, total ≤ 10); all suit powers fire at the combined value.</p>`;
  }
  if (e && card.s && card.s === e.card.s && !e.immunityCancelled) {
    html += `<p class="warn">⚠ ${enemyName(view)} is immune to ${SUIT_META[card.s].symbol} ${SUIT_META[card.s].power} — the damage still counts, but the power will not fire. A Pamphleteer would change that.</p>`;
  }
  return html;
}

export function pileInfo(kind, view) {
  if (kind === 'castle') {
    const total = view.castleCount;
    const jacks = Math.max(0, total - 8), queens = Math.max(0, Math.min(4, total - 4)), kings = Math.min(4, total);
    return `<h3>👑 ${TERMS.castle}</h3>
      <p>The enemies yet to face you, stacked <b>Officers → Queens → Kings</b> (suits shuffled within each rank). <b>${total}</b> remain${total ? `: ${jacks} Officer${jacks === 1 ? '' : 's'}, ${queens} Queen${queens === 1 ? '' : 's'}, ${kings} King${kings === 1 ? '' : 's'} — plus the one before you now` : ''}.</p>
      <p>Defeat them all to win. Officers strike 10 / endure 20 · Queens 15 / 30 · Kings 20 / 40.</p>`;
  }
  if (kind === 'tavern') {
    return `<h3>🥖 ${TERMS.tavern}</h3>
      <p>The people's deck — <b>${view.tavernCount}</b> potential recruits. ♥ Rally the People draws from it; ♦ Raid la Prison slips the freed and shuffled Fallen <i>under</i> it.</p>
      <p>An enemy felled with <b>exactly</b> the right damage is won to the Revolution: placed on top, ready to be drawn and fight for you at full strength.</p>
      <p>An empty deck is no defeat — you simply draw nothing.</p>`;
  }
  if (kind === 'discard') {
    const chips = view.discardPile.map(c => {
      const red = c.s === 'H' || c.s === 'D';
      return `<span class="mini-card ${red ? 'red' : ''}">${miniLabel(c)}</span>`;
    }).join('') || '<i>none yet</i>';
    return `<h3>🕯 ${TERMS.discard}</h3>
      <p><b>${view.discardCount}</b> cards lost to the struggle — spent attacks, sacrifices, and guillotined royals. ♦ Raid la Prison can free and return them (shuffled, face down) beneath ${TERMS.tavern}.</p>
      <div class="sheet-cards">${chips}</div>`;
  }
  if (kind === 'enemy') return enemyInfo(view);
  return '';
}

export function enemyInfo(view) {
  const e = view.enemy;
  if (!e) return '';
  const meta = enemyMeta(e.card);
  const sm = SUIT_META[e.card.s];
  return `<h3>${meta.name}</h3>
    <p><i>${meta.title} — ${RANKS[e.card.r]} of ${sm.symbol}</i></p>
    <p>Endurance <b>${e.health - e.damage}</b> of ${e.health} · Strikes for <b>${e.effectiveAttack}</b>${e.shield ? ` (${e.attack} − ${e.shield} barricades)` : ''}.</p>
    ${e.immunityCancelled
      ? `<p><b>Immunity shattered</b> by a Pamphleteer — all suit powers work, including ${sm.symbol} played earlier.</p>`
      : `<p class="warn">Immune to ${sm.symbol} ${sm.power}: that power will not fire against them (damage still counts). The Pamphleteer can end this.</p>`}
    <p>Defeat with <b>exactly ${e.health - e.damage}</b> more damage and they join the Revolution (top of ${TERMS.tavern}); any more and it's the guillotine.</p>`;
}

// ── projection line under the staged cards ─────────────────────────────────
export function projectionText(view, staged, pseudoState) {
  if (!view.you) return '';
  if (view.phase === 'discard' && view.current === view.you.index) {
    const tot = staged.reduce((s, c) => s + cardValue(c), 0);
    const need = view.pendingDamage;
    return tot >= need
      ? `Sacrificing ${tot} — enough. <b>Confirm to survive.</b>`
      : `Sacrificing ${tot} of <span class="warn">${need}</span> needed…`;
  }
  if (view.phase !== 'play' || view.current !== view.you.index || staged.length === 0) return '';
  const p = previewPlay(pseudoState, staged);
  if (p.isJester) return `The Pamphleteer strikes — immunity shattered, you choose who goes next.`;
  const bits = [`⚔️ <b>${p.damage}</b> damage${p.doubled ? ' (mob ×2!)' : ''}`];
  if (p.heals) bits.push(`♦ ${p.heals} Fallen returned`);
  if (p.draws) bits.push(`♥ ${p.draws} recruited`);
  if (p.shieldAdd) bits.push(`♠ +${p.shieldAdd} barricade`);
  if (p.immuneSuits.length) bits.push(`<span class="warn">⚠ ${p.immuneSuits.map(s => SUIT_META[s].symbol + ' immune').join(', ')}</span>`);
  const e = view.enemy;
  const remaining = e.health - e.damage - p.damage;
  if (remaining === 0) bits.push(`<b>exact — won to the Revolution!</b>`);
  else if (remaining < 0) bits.push(`<b>the guillotine awaits</b>`);
  return bits.join(' · ');
}

// ── the full help panel, opened to the relevant section ────────────────────
export function helpHTML(view) {
  const phase = view?.phase;
  const here = id => (id === phaseSection(phase) ? 'here' : '');
  return `
    <h2>How to Play — 1789</h2>
    <p><i>A cooperative game. Together, defeat all twelve royals of the Ancien Régime — 4 Officers, then 4 Queens, then 4 Kings. If one citoyen falls, the Revolution fails.</i></p>

    <h3 class="${here('turn')}">Your Turn</h3>
    <ol>
      <li><b>Play cards</b> (or Lay Low): one card, a Sans-Culotte pairing, a same-number combo totaling ≤ 10, or the Pamphleteer alone.</li>
      <li><b>Suit power fires</b> at the total value played (see below). Powers are mandatory.</li>
      <li><b>Damage is dealt.</b> Reduce the enemy's endurance; at 0 they fall.</li>
      <li><b>The enemy strikes back.</b> Sacrifice cards from hand totaling at least their attack (minus barricades) — or die, and all is lost.</li>
    </ol>

    <h3>Suit Powers</h3>
    ${['H', 'D', 'C', 'S'].map(s => `<p class="suit-line">${suitPowerLine(s)}</p>`).join('')}
    <p><b>Immunity:</b> each royal ignores the power of their own suit (the damage still counts) — until a Pamphleteer ends it.</p>

    <h3 class="${here('discard')}">Suffering Damage</h3>
    <p>Sacrificed cards are worth their value (Sans-Culotte 1, Pamphleteer 0, captured Officer 10 / Queen 15 / King 20). An empty hand is allowed — but if you cannot cover the damage, the Revolution is crushed. You also lose if a citoyen can neither play nor lay low on their turn.</p>

    <h3>Combos & Sans-Culottes</h3>
    <p>Pairs, triples, or quads of the same number may attack together if their total is ≤ 10 (2s through 5s). All suit powers fire at the combined value. A Sans-Culotte may instead join any one card, adding 1 and their own suit power.</p>

    <h3 class="${here('jester')}">The Pamphleteer</h3>
    <p>Played alone, attack 0. Shatters the enemy's immunity (barricades already built now count; a mob's doubling does not apply retroactively). Skip the counterattack and choose anyone — including yourself — to act next.</p>

    <h3>Exact Kills</h3>
    <p>Fell a royal with damage <i>exactly</i> equal to their remaining endurance and they are won to the Revolution: placed atop ${TERMS.tavern}, drawn like any card, and devastating in your hand.</p>

    <h3>Table Talk</h3>
    <p>Never reveal or hint at what you hold. Public facts are fair game ("I have two cards", "Le Peuple runs low"). After a Pamphleteer, you may say whether you'd like to go next — nothing more.</p>

    ${view?.solo ? `<h3 class="${here('solo')}">Solo — Défendre Seul</h3>
    <p>You fight alone with 8 cards. Twice per game you may <b>Regroup</b>: discard your whole hand and draw 8 fresh — before playing, or before suffering damage. Win using 0 Regroups for <b>Gold</b>, 1 for <b>Silver</b>, 2 for <b>Bronze</b>. You may not Lay Low twice in a row.</p>` : ''}
  `;
}
function phaseSection(phase) {
  return { play: 'turn', discard: 'discard', jesterChoose: 'jester' }[phase] ?? 'turn';
}

// ── first-game coach marks ─────────────────────────────────────────────────
export const COACH_STEPS = [
  { el: '#enemy-zone', text: 'This royal must fall. Their endurance, attack, and immunity live here — long-press anything on this screen for details.' },
  { el: '#hand-zone', text: 'Your hand. Tap cards to stage an attack — the app only allows legal plays, and shows you what the play will do before you commit.' },
  { el: '#action-bar', text: 'Confirm your attack here, or Lay Low to skip straight to the enemy\'s counterattack. Nothing happens until you press the button.' },
  { el: '#status-strip', text: 'When in doubt, read this strip — it always says what is happening and what you can do. Bonne chance, citoyen!' },
];
