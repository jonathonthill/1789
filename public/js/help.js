// Context-dependent help: status strip, long-press explainers (royals/decks),
// the "?" quick-help sheet, and the full help panel.
import { SUIT_META, TERMS, enemyMeta, suitPowerLine } from '/shared/theme.js';
import { cardSVG, cardBackSVG, miniLabel } from '/js/cards.js';
import { cardValue, previewPlay } from '/shared/engine.js';
import { summarize } from '/js/constitution.js';

const RANKS = { J: 'Officer', Q: 'Queen', K: 'King' };

function enemyName(view) { return view.enemy ? enemyMeta(view.enemy.card).name : ''; }

function helpCard(card, label, opts = {}) {
  return `<span class="help-card" aria-label="${label}">
    ${cardSVG(card, opts)}
    ${opts.hideLabel ? '' : `<span>${label}</span>`}
  </span>`;
}

// inHand only ever matters for the "?" quick-help tiles, which highlight
// whichever suits/specials the player is actually holding right now.
function powerGuide(suit, inHand = false) {
  const meta = SUIT_META[suit];
  return `<article class="help-power help-power-${suit.toLowerCase()}${inHand ? ' in-hand' : ''}">
    ${helpCard({ r: 5, s: suit }, `${meta.symbol} ${meta.power}`, { hideLabel: true })}
    <div><h4>${meta.symbol} ${meta.power}</h4><p>${meta.desc}</p></div>
  </article>`;
}

function specialGuide(card, title, desc, inHand = false) {
  return `<article class="help-power${inHand ? ' in-hand' : ''}">
    ${helpCard(card, title, { hideLabel: true })}
    <div><h4>${title}</h4><p>${desc}</p></div>
  </article>`;
}

// ── the always-on status strip ──────────────────────────────────────────────
export function statusText(view, stagedCount) {
  const cur = view.players[view.current];
  const yourTurn = view.you && view.current === view.you.index;

  if (view.phase === 'won') return `<span class="em">Vive la République!</span> The last King is dead.`;
  if (view.phase === 'lost') return `<span class="em">The Revolution is crushed.</span>`;

  if (view.phase === 'jesterChoose') {
    return yourTurn
      ? `Your Pamphleteer struck! <span class="em">Choose who acts next</span> — tap a citoyen's seat, or take the floor yourself below.`
      : `${cur.name}'s Pamphleteer shattered ${enemyName(view)}'s immunity. ${cur.name} chooses who goes next — you may hint whether you want the floor.`;
  }

  if (view.phase === 'discard') {
    if (!yourTurn) return `${enemyName(view)} strikes ${cur.name} for <span class="em">${view.pendingDamage}</span>. They must sacrifice enough cards to survive.`;
    return `The royal strikes for <span class="em">${view.pendingDamage}</span>. Sacrifice cards totaling <span class="em">${view.pendingDamage}</span> or more, then confirm.`;
  }

  if (view.phase === 'play') {
    if (!yourTurn) return `Waiting for <span class="em">${cur.name}</span> to attack or Lay Low.`;
    if (view.you.hand.length === 0) {
      if (view.canYield) return `You hold no cards. You must <span class="em">Lay Low</span>.`;
      if (view.players.length === 1) return `You hold no cards. <span class="em">Regroup</span> to draw a fresh hand.`;
      return `You hold no cards. <span class="em">You cannot act…</span>`;
    }
    if (stagedCount > 0) return `Attack staged. Review the preview, then press <span class="em">Attaquez!</span>`;
    if (view.players.length === 1) return `Your turn, citoyen. Stage an attack.`;
    if (view.canYield) return `Your turn, citoyen. Tap cards to stage an attack, or choose <span class="em">Lay Low</span>.`;
    return `Your turn, citoyen. Stage an attack — you have already lain low against this royal.`;
  }
  return '';
}

// ── long-press / tap explainers ─────────────────────────────────────────────
export function cardInfo(card, view) {
  const v = cardValue(card);
  const e = view.enemy;
  let html = '';
  if (card.r === 'X') {
    html = `<h3>0✒ The Pamphleteer</h3>
      <p>Attack 0, played <b>alone</b>. His exposé <b>shatters the enemy's immunity</b> — suit powers matching the enemy's suit work from then on (even barricades already built).</p>
      <p>You then face the enemy's counterattack. If you survive, <b>choose any citoyen</b> (or yourself) to act next. Until they act, everyone may hint whether they want the floor — but never what they hold.</p>
      <p>When sacrificed to damage, he is worth <b>0</b>.</p>`;
  } else if (card.r === 'A') {
    html = `<h3>${miniLabel(card)} Sans-Culotte</h3>
      <p>Worth <b>1</b>. May fight alone or join exactly one other non-Pamphleteer card (even another Sans-Culotte). The pair's full value fuels every suit power.</p>
      <p>${suitPowerLine(card.s)}</p>
      <p>Cannot join a same-number combo.</p>`;
  } else if (card.r === 'J' || card.r === 'Q' || card.r === 'K') {
    const meta = enemyMeta(card);
    html = `<h3>${miniLabel(card)} ${meta.name}</h3>
      <p><i>${meta.title} — won over to the Revolution and fighting for you.</i></p>
      <p>Attacks for <b>${v}</b> with the full ${SUIT_META[card.s].power} power. Worth <b>${v}</b> when sacrificed to damage.</p>
      <p>${suitPowerLine(card.s)}</p>`;
  } else {
    html = `<h3>${miniLabel(card)} — value ${v}</h3><p>${suitPowerLine(card.s)}</p>`;
    if (typeof card.r === 'number') html += `<p>May combo with other <b>${card.r}s</b> (2–4 matching numbered cards totaling at most 20); all suit powers fire at the full value.</p>`;
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
      <p>The people's deck — <b>${view.tavernCount}</b> potential recruits. ♥ Rally Le Peuple draws from it; ♦ Raid La Prison slips the freed and shuffled prisoners <i>under</i> it.</p>
      <p>A <b>Regroup</b> draws from here: alone it takes back your hand, shuffles, and deals you a fresh one; at a table it simply deals every citoyen a few cards.</p>
      <p>An empty deck is no defeat — you simply draw nothing.</p>`;
  }
  if (kind === 'discard') {
    const chips = view.discardPile.map(c => {
      const red = c.s === 'H' || c.s === 'D';
      return `<span class="mini-card ${red ? 'red' : ''}">${miniLabel(c)}</span>`;
    }).join('') || '<i>none yet</i>';
    return `<h3>🕯 ${TERMS.discard}</h3>
      <p><b>${view.discardCount}</b> prisoners — spent attacks, sacrifices, and guillotined royals. ♦ Raid La Prison can free and return them (shuffled, face down) beneath ${TERMS.tavern}.</p>
      <div class="sheet-cards">${chips}</div>`;
  }
  if (kind === 'played') {
    const cards = view.playedCombos.flatMap(combo => combo.cards);
    const spread = cards.map(card =>
      `<span class="sheet-played-card">${cardSVG(card)}</span>`
    ).join('') || '<p><i>No cards have been played against this royal yet.</i></p>';
    return `<h3>⚔ In Play</h3>
      ${cards.length ? `<p><b>${cards.length}</b> card${cards.length === 1 ? '' : 's'} committed against the current royal.</p>` : ''}
      <div class="sheet-played-cards">${spread}</div>`;
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
    <p>Defeat with <b>exactly ${e.health - e.damage}</b> more damage and they join the Revolution — straight into the slayer's hand; any more and it's the guillotine.</p>`;
}

// ── the "?" quick-help sheet: always the same seven card tiles (four suits,
// Sans-Culotte, Pamphleteer, captured royals) plus the turn phase and all
// four decks — whatever's actually in the player's hand just gets a
// brighter border. Replaces hand-card long-press entirely (it was fighting
// drag-detection for the same gesture, especially on touch); nothing needs
// to be selected to use it. Always ends with a way into the full rulebook.
export function contextHelp(view) {
  const hand = view.you?.hand ?? [];
  const heldSuits = new Set(hand.filter(c => c.s).map(c => c.s));
  const hasSansCulotte = hand.some(c => c.r === 'A');
  const hasPamphleteer = hand.some(c => c.r === 'X');
  const hasCapturedRoyal = hand.some(c => c.r === 'J' || c.r === 'Q' || c.r === 'K');

  const phaseCopy = {
    play: `<p>Play one card, a legal same-number combo, or a Sans-Culotte pair, then press <b>Attaquez!</b> Every represented suit power fires at the play's total value.</p>
      <p>Or <b>Lay Low</b>: skip the turn outright, taking no strike — once against each royal.${view.solo ? ' (Not offered alone.)' : ''} Fell a royal and you take no strike either; the <b>next citoyen</b> faces whoever steps up.</p>`,
    discard: `<p>Tap cards totaling at least <b>${view.pendingDamage ?? 0}</b>, then confirm to survive. Sans-Culottes count 1, the Pamphleteer 0, captured royals 10 / 15 / 20.</p>`,
    jesterChoose: `<p>A Pamphleteer shattered the royal's immunity and its player survived the counterattack. Choose any citoyen — even yourself — to act next.</p>`,
    won: `<p><b>Vive la République!</b> Every royal has fallen.</p>`,
    lost: `<p><b>The Revolution has been crushed.</b></p>`,
  }[view.phase] ?? '';

  // The odd tile out (captured royals) spans the full row instead of
  // leaving a lonely half-empty row — see .help-power-grid.ref-grid.
  const cardsSection = `<h3>Card Reference</h3><div class="help-power-grid ref-grid">
    ${['H', 'D', 'C', 'S'].map(s => powerGuide(s, heldSuits.has(s))).join('')}
    ${specialGuide({ r: 'A', s: 'S' }, 'Sans-Culotte',
      `Worth 1. Fights alone or pairs with exactly one other non-Pamphleteer card — even another Sans-Culotte. The pair's full value fires every represented suit power; never joins a same-number combo.`,
      hasSansCulotte)}
    ${specialGuide({ r: 'X', s: null }, 'The Pamphleteer',
      `Worth 0. Fights alone, shatters the royal's immunity, takes the counterattack, and then lets you choose who acts next — even yourself.`,
      hasPamphleteer)}
    ${specialGuide({ r: 'J', s: 'H' }, 'Captured Royals',
      `A defeated Officer, Queen, or King you've recruited attacks at a fixed value — 10 / 15 / 20 — with its full suit power, and is worth the same if sacrificed.`,
      hasCapturedRoyal)}
  </div>`;

  const playedCount = (view.playedCombos ?? []).reduce((n, combo) => n + combo.cards.length, 0);
  const decksSection = `<h3>The Four Decks</h3><dl class="help-decks four">
    <div><dt>${TERMS.castle}</dt><dd>${view.castleCount ?? 0} royal${view.castleCount === 1 ? '' : 's'} still to come.</dd></div>
    <div><dt>${TERMS.tavern}</dt><dd>${view.tavernCount ?? 0} recruits — ♥ Rally draws from it, ♦ Raid slips prisoners beneath it.</dd></div>
    <div><dt>${TERMS.discard}</dt><dd>${view.discardCount ?? 0} prisoners — ♦ Raid La Prison can free them.</dd></div>
    <div><dt>In Play</dt><dd>${playedCount} card${playedCount === 1 ? '' : 's'} committed against the current royal.</dd></div>
  </dl>`;

  return `
    <h2>Right now</h2>
    ${phaseCopy}
    ${cardsSection}
    ${decksSection}
    <button class="help-walkthrough-link" type="button" data-open-full-help>
      <span class="help-walkthrough-icon" aria-hidden="true">📖</span>
      <span><b>Full instructions</b><small>The complete rulebook</small></span>
      <span aria-hidden="true">›</span>
    </button>
  `;
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
  if (p.isJester && staged.length === 1) return `The Pamphleteer strikes — immunity shattered, you choose who goes next.`;
  const bits = [];
  if (p.isJester) bits.push('📜 immunity shattered');
  bits.push(`⚔️ <b>${p.damage}</b> damage${p.doubled ? ' (mob ×2!)' : ''}`);
  if (p.heals) bits.push(`♦ ${p.heals} freed from La Prison`);
  if (p.draws) bits.push(`♥ ${p.draws} recruited`);
  if (p.shieldAdd) bits.push(`♠ +${p.shieldAdd} barricade`);
  if (p.immuneSuits.length) bits.push(`<span class="warn">⚠ ${p.immuneSuits.map(s => SUIT_META[s].symbol + ' immune').join(', ')}</span>`);
  const e = view.enemy;
  const remaining = e.health - e.damage - p.damage;
  if (remaining === 0) {
    bits.push(`<b>exact — the royal joins your hand!</b>`);
  } else if (remaining < 0) bits.push(`<b>the guillotine awaits</b>`);
  else if (p.isJester) bits.push('immunity shattered — you choose who goes next');
  return bits.join(' · ');
}

// The rules in force at THIS table, so nobody has to remember what the host
// adopted. Anything shifted from the rulebook is called out as a house rule.
function constitutionSection(view) {
  if (!view?.rules) return '';
  const rows = summarize(view.rules, view.playerCount);
  const house = rows.filter(r => !r.standard).length;
  return `
    <h3>La Constitution</h3>
    <p class="help-rule-note">${house
      ? `This table plays under <b>${house} house rule${house === 1 ? '' : 's'}</b>, marked below.`
      : 'This table plays the défaut rules exactly.'}</p>
    <div class="rule-badges help-rule-badges">${rows.map(r =>
      `<span class="rule-badge${r.standard ? '' : ' house'}"><span class="rule-badge-label">${r.label}</span>${r.value}</span>`
    ).join('')}</div>`;
}

// ── the full help panel, opened to the relevant section ────────────────────
export function helpHTML(view) {
  const phase = view?.phase;
  const here = id => (id === phaseSection(phase) ? 'here' : '');
  return `
    <h2>How to Play — 1789</h2>
    <button class="help-walkthrough-link" type="button">
      <span class="help-walkthrough-icon" aria-hidden="true">▶</span>
      <span><b>Watch the animated walkthrough</b><small>A guided review of the complete rules</small></span>
      <span aria-hidden="true">›</span>
    </button>
    <div class="help-intro">
      <div class="help-royal-line" aria-hidden="true">
        ${helpCard({ r: 'J', s: 'S' }, 'Officer', { subtitle: true })}
        ${helpCard({ r: 'Q', s: 'H' }, 'Queen', { subtitle: true })}
        ${helpCard({ r: 'K', s: 'C' }, 'King', { subtitle: true })}
      </div>
      <p><b>One Revolution, twelve royals.</b> Defeat 4 Officers of the Crown, then 4 Queens, then 4 Kings. If one citoyen falls, everyone loses.</p>
    </div>
${constitutionSection(view)}

    <h3 class="${here('turn')}">Your Turn</h3>
    <div class="help-turn-flow">
      <div><b>1</b><span><strong>Attack</strong>Play one card, a legal combo, or a Sans-Culotte pair—then press <em>Attaquez!</em> Rise en Masse doubles the blow. You may instead <em>Lay Low</em> once against each royal.</span></div>
      <div><b>2</b><span><strong>Resolve suit powers</strong>Powers are mandatory and use the total value played. If both occur, Raid La Prison resolves before Rally Le Peuple.</span></div>
      <div><b>3</b><span><strong>Judge the royal</strong>After every power resolves, compare the total damage with the royal's endurance. Exact damage wins the royal over; overkill sends them to the guillotine.</span></div>
      <div><b>4</b><span><strong>Resolve the outcome</strong>A defeated royal falls without striking back, and the next citoyen faces their successor. If the royal remains, use the post-power hand to resist their counterattack after barricades.</span></div>
    </div>
    <p class="help-rule-note"><b>Rearranging your hand:</b> drag a card sideways to reorder it. This is just your own view — it changes nothing for the other citoyens.</p>

    <h3>Suit Powers</h3>
    <div class="help-power-grid">${['H', 'D', 'C', 'S'].map(s => powerGuide(s)).join('')}</div>
    <p class="help-rule-note"><b>Immunity:</b> each royal blocks the power of their own suit—the crossed-out suit on affected cards—but their damage still counts. A Pamphleteer shatters that immunity for the rest of the fight.</p>

    <h3 class="${here('discard')}">Suffering Damage</h3>
    <p>Tap cards totaling at least the displayed damage, then press <b>Sacrifice</b>. Sans-Culottes are worth 1, Pamphleteers 0, and captured royals 10 / 15 / 20. If your hand cannot cover the blow, the Revolution is crushed.</p>
    <p><b>Lay Low:</b> skip your turn outright — you make no attack, and the royal finds nobody to strike. Each citoyen may lie low <b>once against each royal</b>; the right returns when the next royal steps up. It is a multiplayer option only, since alone there is no one for a skipped turn to help.</p>

    <h3>Combos & Sans-Culottes</h3>
    <div class="help-example-row">
      <div class="help-example-cards" aria-hidden="true">
        ${helpCard({ r: 3, s: 'H' }, '3♥')}${helpCard({ r: 3, s: 'D' }, '3♦')}${helpCard({ r: 3, s: 'C' }, '3♣')}
      </div>
      <p><b>Same-number combo:</b> play 2–4 matching number cards totaling at most 20. All four copies of ranks 2–5 can therefore fight together. This trio has value 9: Hearts and Diamonds resolve at 9, then Clubs doubles the damage to 18.</p>
    </div>
    <div class="help-example-row">
      <div class="help-example-cards help-pair" aria-hidden="true">
        ${helpCard({ r: 'A', s: 'S' }, 'Sans-Culotte')}${helpCard({ r: 8, s: 'H' }, '8♥')}
      </div>
      <p><b>Sans-Culotte:</b> may fight alone or pair with one non-Pamphleteer card (including another Sans-Culotte), but cannot join a combo. Add 1 to the pair's value and fire every represented suit power.</p>
    </div>

    <h3 class="${here('jester')}">The Pamphleteer</h3>
    <div class="help-example-row">
      <div class="help-example-cards help-single" aria-hidden="true">${helpCard({ r: 'X', s: null }, 'Pamphleteer')}</div>
      <p>The Pamphleteer is worth 0 and fights <b>alone</b>. He shatters the royal's immunity but does not escape the reprisal: the royal strikes, and only then does he name who follows. Earlier barricades begin working; earlier mob attacks are not doubled retroactively. Two are shuffled into Le Peuple—three at a four-citoyen table.</p>
    </div>

    <h3>Defeating a Royal</h3>
    <div class="help-exact">
      <div class="help-exact-cards" aria-hidden="true">
        ${helpCard({ r: 10, s: 'C' }, '10♣')}
        <span class="help-arrow">×2 →</span>
        ${helpCard({ r: 'J', s: 'H' }, 'Officer', { subtitle: true })}
        <span class="help-arrow">→</span>
        <span class="help-deck">${cardBackSVG()}<small>your hand</small></span>
      </div>
      <p><b>Exact damage:</b> the royal is won over to the Revolution and joins the slayer's own hand, ready to fight at full value. <b>Overkill:</b> the royal goes to ${TERMS.discard}. In either case the slayer takes no counterattack, and the <b>next citoyen</b> faces the royal who steps up.</p>
    </div>

    <h3>The Three Decks</h3>
    <dl class="help-decks">
      <div><dt>${TERMS.castle}</dt><dd>Royals still waiting: Officers, Queens, then Kings.</dd></div>
      <div><dt>${TERMS.tavern}</dt><dd>Face-down recruits drawn by Rally Le Peuple.</dd></div>
      <div><dt>${TERMS.discard}</dt><dd>Played and sacrificed cards; Raid La Prison returns prisoners beneath Le Peuple.</dd></div>
    </dl>

    <h3>Table Talk</h3>
    <p>Never reveal or hint at what you hold. Public facts are fair game (“I have two cards,” “Le Peuple runs low”). After a Pamphleteer, you may say whether you would like to act next—nothing more.</p>

    <h3>Regroup</h3>
    <p>A Regroup is the table's way of catching its breath. ${view?.solo
      ? `Alone it is a fresh start: your hand goes back into ${TERMS.tavern}, which is shuffled, and you draw a full hand again.`
      : `At a table every citoyen draws ${view?.rules?.regroupDraw ?? 3} card${(view?.rules?.regroupDraw ?? 3) === 1 ? '' : 's'} from ${TERMS.tavern} — nobody has to give up a hand they were keeping for a reason.`} It may be called before attacking or while facing damage, and it does not shatter royal immunity.</p>
    ${view?.solo ? `<h3 class="${here('solo')}">Solo — Défendre Seul</h3>
    <p>You fight alone with ${view.handSize ?? 8} cards and the ${view.rules?.regroups ?? 2} Regroup${(view.rules?.regroups ?? 2) === 1 ? '' : 's'} La Constitution granted you — spent freely, with no Assemblée to convince. Finish having spent none for <b>Gold</b>, one for <b>Silver</b>, two for <b>Bronze</b>. Lay Low is not offered alone: there is no fellow citoyen for a skipped turn to help.</p>` : ''}
    ${view && !view.solo ? `<h3>l'Assemblée</h3>
    <p>At a table the Regroups are a <b>shared pool</b>, and one is only spent if the floor agrees. The citoyen holding the floor moves for it; moving counts as their own <b>Yea</b>, everyone else answers <b>Yea</b> or <b>Nay</b>, and a strict majority carries the motion. A fallen motion costs nothing.</p>` : ''}
  `;
}
function phaseSection(phase) {
  return { play: 'turn', discard: 'discard', jesterChoose: 'jester' }[phase] ?? 'turn';
}

// ── animated walkthrough ───────────────────────────────────────────────────
function walkCard(card, label, className = '') {
  return `<span class="walk-card ${className}">${cardSVG(card)}<small>${label}</small></span>`;
}

export function walkthroughSteps(view) {
  const left = view?.regroupsRemaining ?? 0;
  const draw = view?.rules?.regroupDraw ?? 3;
  const regroupCopy = view?.solo
    ? `A Regroup is a fresh start: your hand goes back into Le Peuple, which is shuffled, and you draw a full hand again. You have ${left} left; La Constitution sets how many the game begins with.`
    : `The table shares a pool of Regroups — ${left} left. Spending one deals every citoyen ${draw} card${draw === 1 ? '' : 's'}. Move for one on your turn (or while suffering a blow) and l'Assemblée votes: the mover counts as a Yea, and a majority of the table carries it.`;

  return [
    {
      eyebrow: 'The cause',
      title: 'Overthrow the Ancien Régime',
      body: `<p>Your Revolution faces <b>twelve royals</b>: four Officers, four Queens, then four Kings. Defeat every one to win.</p>
        <p>Officers strike for 10 and endure 20; Queens are 15 / 30; Kings are 20 / 40. If even one citoyen cannot survive a blow, <b>everyone loses</b>.</p>`,
      stage: `<div class="walk-royal-march">
        ${walkCard({ r: 'J', s: 'S' }, '10 attack · 20 endurance', 'royal-one')}
        ${walkCard({ r: 'Q', s: 'H' }, '15 attack · 30 endurance', 'royal-two')}
        ${walkCard({ r: 'K', s: 'C' }, '20 attack · 40 endurance', 'royal-three')}
      </div><div class="walk-goal"><span>4 Officers</span><i>→</i><span>4 Queens</span><i>→</i><span>4 Kings</span></div>`,
    },
    {
      eyebrow: 'Know the table',
      title: 'Three decks, one royal, your hand',
      body: `<p><b>Le Régime</b> holds the royals still to come. <b>Le Peuple</b> is the face-down recruit deck. Played, sacrificed, and overkilled cards collect in <b>La Prison</b>.</p>
        <p>Beneath the royal, the heart bar shows remaining health and the swords bar shows current strike versus full strike. Barricades reduce the first number. Your hand and actions sit below the status strip.</p>`,
      stage: `<div class="walk-board-viewport">
        <div class="walk-board-demo">
          <div class="walk-demo-topbar"><b>⚜ 1789</b><span>salon</span><i></i><span>?</span></div>
          <div class="walk-demo-board">
            <div class="walk-demo-center">
              <div class="walk-demo-deck-col walk-demo-left">
                <div class="walk-demo-deck walk-demo-regime">${cardBackSVG()}<b>11</b><span>Régime</span><em>royals ahead</em></div>
                <div class="walk-demo-deck walk-demo-people">${cardBackSVG()}<b>33</b><span>Peuple</span><em>recruits</em></div>
              </div>
              <div class="walk-demo-enemy">${walkCard({ r: 'J', s: 'D' }, '')}<div><span class="walk-demo-stat walk-demo-hp"><i></i><b>♥</b>20 / 20</span><span class="walk-demo-stat walk-demo-strike"><i></i><b>⚔</b>6 / 10</span></div></div>
              <div class="walk-demo-deck-col walk-demo-right">
                <div class="walk-demo-deck walk-demo-prison"><span class="walk-demo-empty"></span><b>0</b><span>La Prison</span><em>discard</em></div>
                <div class="walk-demo-deck walk-demo-played">${cardSVG({ r: 5, s: 'S' })}<b>1</b><span>In Play</span><em>current royal</em></div>
              </div>
            </div>
          </div>
          <div class="walk-demo-opponent-rail"><small>In a salon</small><span class="walk-demo-fan">${cardBackSVG()}${cardBackSVG()}${cardBackSVG()}</span><b>Citoyen · 8</b></div>
          <div class="walk-demo-turn-area">
            <div class="walk-demo-status">Your turn, citoyen. Tap cards to stage an attack.</div>
            <div class="walk-demo-hand">${[2, 5, 8, 10].map((r, i) => walkCard({ r, s: ['H','S','D','C'][i] }, '')).join('')}</div>
          </div>
          <div class="walk-demo-actions"><span>Regroup (2)</span><span>Lay Low</span><b>Attaquez!</b></div>
        </div>
      </div>`,
    },
    {
      eyebrow: 'The turn at a glance',
      title: 'Every turn has four phases',
      body: `<p>Choose one legal play and press <b>Attaquez!</b> All represented suit powers are mandatory and use the play's <b>total value</b>. Raid resolves before Rally.</p>
        <p>Then judge the royal: a defeated royal cannot strike back, while a survivor counterattacks after barricades. We will review each phase in order. <b>Next: Phase 1 — Attack.</b></p>`,
      stage: `<div class="walk-flow">
        <div><b>1</b><span>Attack<small>stage cards</small></span></div><i>→</i>
        <div><b>2</b><span>Powers<small>resolve all</small></span></div><i>→</i>
        <div><b>3</b><span>Judge<small>royal falls?</small></span></div><i>→</i>
        <div><b>4</b><span>Respond<small>next royal or hit</small></span></div>
      </div>`,
    },
    {
      eyebrow: 'Phase 1 of 4 · Attack',
      title: 'Phase 1: Choose one legal attack',
      body: `<p>Play any single card. Or combine <b>2–4 numbered cards of the same rank</b> if their total is at most 20. Every suit in a combo fires at the full total.</p>
        <p>A <b>Sans-Culotte</b> is worth 1 and may pair with exactly one non-Pamphleteer card—even another Sans-Culotte—but never joins a numbered combo. Stage your choice and press <b>Attaquez!</b> <b>Next: Phase 2 — Resolve Powers.</b></p>`,
      stage: `<div class="walk-play-examples">
        <div><span>single</span><div>${walkCard({ r: 8, s: 'S' }, 'value 8')}</div></div>
        <div><span>same-rank combo</span><div>${walkCard({ r: 3, s: 'H' }, '')}${walkCard({ r: 3, s: 'D' }, '')}${walkCard({ r: 3, s: 'C' }, 'total 9')}</div></div>
        <div><span>Sans-Culotte pair</span><div>${walkCard({ r: 'A', s: 'S' }, '1')}${walkCard({ r: 8, s: 'H' }, '8 · total 9')}</div></div>
      </div>`,
    },
    {
      eyebrow: 'Phase 2 of 4 · Resolve powers',
      title: 'Phase 2: Apply every suit power',
      body: `<p><b>♥ Rally Le Peuple</b> draws up to the play's value, starting with you and circling past full hands. An empty deck is not a defeat. <b>♦ Raid La Prison</b> returns that many shuffled prisoners beneath Le Peuple.</p>
        <p><b>♣ Rise en Masse</b> doubles the play's damage. <b>♠ Build Barricades</b> permanently reduces this royal's counterattack by the play's value. Before resolving a power, check the royal's immunity on the next slide.</p>`,
      stage: `<div class="walk-suits">
        <div class="hearts">${walkCard({ r: 5, s: 'H' }, '')}<span>♥ <b>Draw 5</b><small>Rally Le Peuple</small></span></div>
        <div class="diamonds">${walkCard({ r: 5, s: 'D' }, '')}<span>♦ <b>Return 5</b><small>Raid La Prison</small></span></div>
        <div class="clubs">${walkCard({ r: 5, s: 'C' }, '')}<span>♣ <b>Deal 10</b><small>Rise en Masse</small></span></div>
        <div class="spades">${walkCard({ r: 5, s: 'S' }, '')}<span>♠ <b>Block 5</b><small>Build Barricades</small></span></div>
      </div>`,
    },
    {
      eyebrow: 'Phase 2 continued · Immunity',
      title: 'Phase 2: Check the royal’s immunity',
      body: `<p>A royal is immune to the <b>power</b> of cards matching their suit, but those cards still deal their normal damage.</p>
        <p>The <b>Pamphleteer</b> is worth 0, fights alone, and permanently shatters that royal's immunity. The royal still strikes back; if the player survives, they choose who acts next. Earlier Spade barricades begin working; earlier Club attacks are not doubled retroactively. Two are shuffled into Le Peuple—three at a four-citoyen table. <b>Next: Phase 3 — Judge the Royal.</b></p>`,
      stage: `<div class="walk-immunity">
        <div class="walk-immune-royal">${walkCard({ r: 'Q', s: 'H' }, 'immune to ♥')}</div>
        <div class="walk-immune-card">${walkCard({ r: 6, s: 'H' }, '6 damage · no draw')}<span class="walk-block">×</span></div>
        <div class="walk-pamphlet">${walkCard({ r: 'X', s: null }, 'played alone')}<span class="walk-rip">immunity shattered</span></div>
      </div>`,
    },
    {
      eyebrow: 'Phase 3 of 4 · Judge the royal',
      title: 'Phase 3: Compare damage to endurance',
      body: `<p>Deal <b>exactly</b> the remaining endurance and the royal joins the Revolution in the slayer's own hand, ready to be used at full value with its suit power.</p>
        <p>Deal too much and the royal goes to La Prison. Either way the slayer escapes the counterattack, and the <b>next citoyen</b> faces the royal who steps up. If the royal survives, continue to <b>Phase 4 — Respond.</b></p>`,
      stage: `<div class="walk-outcomes">
        <div><strong>Exact</strong><div>${walkCard({ r: 10, s: 'C' }, '')}<i>×2</i>${walkCard({ r: 'J', s: 'H' }, '')}<i>→</i><span class="walk-mini-deck people">your hand</span></div><small>20 damage for 20</small></div>
        <div><strong>Overkill</strong><div>${walkCard({ r: 10, s: 'C' }, '')}<i>+</i>${walkCard({ r: 2, s: 'S' }, '')}<i>→</i><span class="walk-mini-deck prison">La Prison</span></div><small>22 damage for 20</small></div>
      </div>`,
    },
    {
      eyebrow: 'Phase 4 of 4 · Respond',
      title: 'Phase 4: Survive the counterattack',
      body: `<p>Subtract all active Spade barricades from the royal's attack. Sacrifice cards from your hand totaling <b>at least</b> the damage left: Sans-Culottes are 1, Pamphleteers 0, and recruited royals 10 / 15 / 20.</p>
        <p>You may <b>Lay Low</b> instead: no attack, and no counterattack either — but only <b>once against each royal</b>, and never in solo, where there is no one else for a skipped turn to help. It is the way out for a citoyen handed a fresh royal on an empty hand. Once you survive, the next turn begins again at <b>Phase 1 — Attack.</b></p>`,
      stage: `<div class="walk-damage-math"><span class="hit">10 attack</span><i>−</i><span class="shield">4 barricade</span><i>=</i><span class="damage">6 damage</span></div>
        <div class="walk-sacrifice">${walkCard({ r: 2, s: 'H' }, '')}${walkCard({ r: 4, s: 'D' }, '')}<span>6 sacrificed ✓</span></div>
        <div class="walk-lay-low">Lay Low <small>skip the turn · no hit · once per royal</small></div>`,
    },
    {
      eyebrow: 'Fight together',
      title: 'Share plans, never share cards',
      body: `<p>You may discuss public information—whose turn it is, hand sizes, damage, deck counts, or whether Le Peuple is running low.</p>
        <p>Never reveal or hint at what you hold. After a Pamphleteer, each citoyen may only say whether they would like the next turn; the Pamphleteer's player chooses.</p>`,
      stage: `<div class="walk-talk">
        <div class="allowed"><b>Public facts</b><span>“I have two cards.”</span><span>“Le Peuple runs low.”</span><span>“I would like the floor.”</span></div>
        <div class="forbidden"><b>Keep hands secret</b><span class="secret-hand">${walkCard({ r: 7, s: 'H' }, '')}${walkCard({ r: 7, s: 'C' }, '')}</span><span>Never name or hint at these.</span></div>
      </div>`,
    },
    {
      eyebrow: 'Your safety net',
      title: 'Regroup, read the status, ask for help',
      body: `<p>${regroupCopy} It can be called before attacking or while suffering damage, and it does not shatter immunity.</p>
        <p>The status strip always tells you what happens next. Tap cards to stage an attack, or drag one sideways to reorder your hand. Tap a royal or a deck for details, or tap <b>? Help</b> any time for a quick reference on your hand and the current phase — plus a link to these full instructions.</p>`,
      stage: `<div class="walk-regroup">
        <div class="walk-regroup-hand old-hand"><div class="walk-regroup-cards">${walkCard({ r: 2, s: 'D' }, '')}${walkCard({ r: 'A', s: 'C' }, '')}</div><strong>${view?.solo ? 'Your hand' : 'Le Peuple'}</strong><small>${view?.solo ? 'back into Le Peuple' : 'deals to everyone'}</small></div>
        <div class="walk-regroup-arrow"><span>↻</span><b>Regroup</b></div>
        <div class="walk-regroup-hand new-hand"><div class="walk-regroup-cards">${walkCard({ r: 8, s: 'S' }, '')}${walkCard({ r: 10, s: 'H' }, '')}</div><strong>${view?.solo ? 'A fresh hand' : 'Cards all round'}</strong><small>${view?.solo ? 'shuffled and redealt' : 'nobody loses a card'}</small></div>
      </div><div class="walk-ready-status"><i></i><span>Your turn, citoyen. Tap cards to stage an attack.</span></div>`,
    },
  ];
}
