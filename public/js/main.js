// Régicide 1789 — client orchestrator. One render path for multiplayer (server
// views over Socket.IO) and solo (the same engine running locally).
import * as engine from '/shared/engine.js';
import { enemyMeta, SUIT_META, EXCLAIM } from '/shared/theme.js';
import { cardSVG, cardBackSVG } from '/js/cards.js';
import { showEntrance, dismissEntrance, showGuillotine, riffleDeck, flyCards } from '/js/anim.js';
import * as help from '/js/help.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

// ── app state ───────────────────────────────────────────────────────────────
let mode = null;            // 'mp' | 'solo'
let socket = null;
let session = loadSession();         // { code, token, name }
let myIndex = null;
let view = null;            // last rendered view
let staged = [];            // cards selected in hand
let soloState = null;
let lastAnimSeq = 0;
let lastPhaseKey = '';
let endHandled = false;
let animBusy = false;
let pendingView = null;

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save(k, v) { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); }

// The seat session lives in BOTH storages: sessionStorage wins so each tab keeps
// its own seat (two tabs in one browser can't hijack each other), while
// localStorage lets a killed browser rejoin its most recent seat.
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem('r1789_session'))
        ?? JSON.parse(localStorage.getItem('r1789_session'));
  } catch { return null; }
}
function saveSession(v) {
  if (v == null) {
    sessionStorage.removeItem('r1789_session');
    localStorage.removeItem('r1789_session');
  } else {
    const s = JSON.stringify(v);
    sessionStorage.setItem('r1789_session', s);
    localStorage.setItem('r1789_session', s);
  }
}

// ── screens ─────────────────────────────────────────────────────────────────
const SCREENS = ['home', 'lobby', 'game', 'end'];
function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
}

// ── pseudo-state: lets the client reuse engine validation on a partial view ──
function pseudoState(v) {
  const players = Array.from({ length: v.playerCount }, () => ({ hand: [] }));
  if (v.you) players[v.you.index] = { hand: v.you.hand };
  return {
    phase: v.phase, current: v.current, players,
    enemy: v.enemy ? { card: v.enemy.card, immunityCancelled: v.enemy.immunityCancelled } : null,
    discard: { length: v.discardCount },
    tavern: { length: v.tavernCount },
    pendingDamage: v.pendingDamage,
  };
}

// ── networking ──────────────────────────────────────────────────────────────
function net() {
  if (socket) return socket;
  socket = io();
  socket.on('lobby', renderLobby);
  socket.on('state', v => { mode = 'mp'; onView(v); });
  // Reconnect only re-claims a seat THIS tab established (sessionStorage) —
  // never the localStorage fallback, or a second tab would hijack the seat.
  socket.on('connect', () => {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem('r1789_session')); } catch {}
    if (s?.code) { session = s; tryRejoin(true); }
  });
  return socket;
}

function tryRejoin(silent) {
  net().emit('rejoin', { code: session.code, token: session.token }, res => {
    if (!res.ok) {
      if (!silent) homeError(res.error);
      saveSession(null); session = null;
      show('home');
      return;
    }
    myIndex = res.playerIndex;
    if (res.status === 'lobby') show('lobby');
    // playing/ended: the server pushes a state event which routes the screen
  });
}

function sendAction(action, cb) {
  if (mode === 'solo') {
    try {
      const s = soloState;
      if (action.type === 'play') engine.playCards(s, 0, action.cards);
      else if (action.type === 'yield') engine.yieldTurn(s, 0);
      else if (action.type === 'discard') engine.discardForDamage(s, 0, action.cards);
      else if (action.type === 'regroup') engine.soloRegroup(s);
      else if (action.type === 'surrender') engine.surrenderGame(s, 0);
      onView(engine.viewFor(s, 0));
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  } else {
    net().emit('action', action, cb);
  }
}

// ── home ────────────────────────────────────────────────────────────────────
function homeError(msg) { const el = $('#home-error'); el.textContent = msg; el.hidden = !msg; }
function myName() {
  const n = $('#name-input').value.trim() || 'Citoyen';
  save('r1789_name', n);
  return n;
}
$('#name-input').value = load('r1789_name') ?? '';

$('#btn-create').onclick = () => {
  homeError('');
  net().emit('create', { name: myName() }, res => {
    if (!res.ok) return homeError(res.error);
    session = { code: res.code, token: res.token, name: myName() };
    saveSession(session);
    myIndex = 0;
    show('lobby');
  });
};
$('#btn-join').onclick = () => {
  homeError('');
  const code = $('#code-input').value.trim().toUpperCase();
  if (code.length !== 4) return homeError('Salon codes are 4 letters.');
  net().emit('join', { code, name: myName() }, res => {
    if (!res.ok) return homeError(res.error);
    session = { code: res.code, token: res.token, name: myName() };
    saveSession(session);
    myIndex = res.playerIndex;
    show('lobby');
  });
};
$('#btn-solo').onclick = () => {
  mode = 'solo';
  soloState = engine.newGame([myName()]);
  lastAnimSeq = 0; endHandled = false;
  onView(engine.viewFor(soloState, 0));
};
$('#btn-rules').onclick = () => openHelp({ solo: true, phase: null });

// ── lobby ───────────────────────────────────────────────────────────────────
function renderLobby(lv) {
  if (lv.status !== 'lobby') return;
  show('lobby');
  $('#lobby-code').textContent = lv.code;
  $('#lobby-players').innerHTML = lv.players.map(p =>
    `<li><span>${esc(p.name)}${p.host ? ' <span class="tag">· hôte</span>' : ''}</span>
     <span class="tag ${p.connected ? '' : 'off'}">${p.connected ? 'present' : 'absent'}</span></li>`).join('');
  const n = lv.players.length;
  $('#lobby-status').textContent = n < 2
    ? 'Waiting for citoyens… (2–4 to begin)'
    : `${n} citoyens assembled.` + (lv.youAreHost ? '' : ' Waiting for the host to begin…');
  $('#btn-start').hidden = !(lv.youAreHost && n >= 2);
  myIndex = lv.yourIndex ?? myIndex;
}
$('#btn-start').onclick = () => net().emit('start', {}, res => {
  if (!res.ok) { $('#lobby-error').textContent = res.error; $('#lobby-error').hidden = false; }
});
$('#btn-leave').onclick = () => {
  saveSession(null); session = null;
  socket?.disconnect(); socket = null;
  show('home');
};

// ── view pipeline: animations, then render ──────────────────────────────────
function onView(v) {
  view = v;
  if (animBusy) { pendingView = v; return; }
  routeView(v);
}

function routeView(v) {
  if (v.phase === 'won' || v.phase === 'lost') {
    renderGame(v);
    if (!endHandled) {
      endHandled = true;
      staged = [];
      if (v.phase === 'won' && v.lastEvent?.type === 'victory') {
        withAnim(done => showGuillotine(v.lastEvent.card, v.lastEvent.exact, done), () => renderEnd(v));
      } else {
        renderEnd(v);
      }
    }
    return;
  }
  endHandled = false;
  show('game');
  const phaseKey = `${v.phase}:${v.current}`;
  if (phaseKey !== lastPhaseKey) { staged = []; lastPhaseKey = phaseKey; }
  const seq = v.enemy?.revealSeq ?? 0;
  if (seq && seq !== lastAnimSeq) {
    lastAnimSeq = seq;
    staged = [];
    const ev = v.lastEvent;
    if (ev?.type === 'defeatAndReveal' && ev.seq === seq) {
      withAnim(done => showGuillotine(ev.card, ev.exact, () => showEntrance(v.enemy, done)));
    } else {
      withAnim(done => showEntrance(v.enemy, done), maybeCoach);
      if (seq === 1) { // fresh game: the decks get their shuffle
        setTimeout(() => { riffleDeck($('#stack-tavern')); riffleDeck($('#stack-castle')); }, 300);
      }
    }
  }
  renderGame(v);
  animateEffects(v);
}

// Suit-power side effects become table motion: a diamond raid returns the
// Fallen under Le Peuple, then a heart rally recruits cards into hands.
let lastActionSeq = -1;
function animateEffects(v) {
  if (v.actionSeq === lastActionSeq) return;
  const first = lastActionSeq === -1 && v.actionSeq > 1;
  lastActionSeq = v.actionSeq;
  if (first || !v.lastEffects) return; // don't replay history on rejoin
  const { healed = 0, drawn = 0 } = v.lastEffects;
  if (healed > 0) {
    riffleDeck($('#stack-discard'));
    flyCards($('#stack-discard'), $('#stack-tavern'), healed, cardBackSVG(),
      () => riffleDeck($('#stack-tavern')));
  }
  if (drawn > 0) {
    setTimeout(() => flyCards($('#stack-tavern'), $('#hand-zone'), drawn, cardBackSVG()),
      healed > 0 ? 1100 : 0);
  }
}

function withAnim(run, after) {
  animBusy = true;
  run(() => {
    animBusy = false;
    after?.();
    if (pendingView) { const pv = pendingView; pendingView = null; routeView(pv); }
  });
}

$('#entrance-overlay').addEventListener('click', dismissEntrance);

// ── game rendering ──────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderGame(v) {
  if ($('#screen-game').hidden && v.phase !== 'won' && v.phase !== 'lost') show('game');
  $('#topbar-room').textContent = mode === 'mp' ? `salon ${v.roomCode}` : 'solo';

  // enemy
  if (v.enemy) {
    const e = v.enemy, meta = enemyMeta(e.card), sm = SUIT_META[e.card.s];
    $('#enemy-card').innerHTML = cardSVG(e.card);
    $('#enemy-name').textContent = meta.name;
    $('#enemy-title').textContent = `${meta.title} · ${sm.symbol}`;
    const hp = Math.max(0, e.health - e.damage);
    $('#hp-bar').style.width = `${(hp / e.health) * 100}%`;
    $('#hp-text').textContent = `${hp} / ${e.health}`;
    $('#enemy-attack').innerHTML = `⚔️ Strikes for <b>${e.effectiveAttack}</b>` +
      (e.shield ? ` <span class="shielded">(${e.attack} − ${e.shield} 🛡️)</span>` : '');
    $('#enemy-immunity').innerHTML = e.immunityCancelled
      ? `<span class="badge cancelled">Immunity shattered 🪶</span>`
      : `<span class="badge">Immune: ${sm.symbol} ${sm.power}</span>`;
  }

  // decks
  renderDeck($('#stack-castle'), v.castleCount, null);
  renderDeck($('#stack-tavern'), v.tavernCount, null);
  renderDeck($('#stack-discard'), v.discardCount, v.discardTop);
  $('#count-castle').textContent = v.castleCount;
  $('#count-tavern').textContent = v.tavernCount;
  $('#count-discard').textContent = v.discardCount;

  // cards played against the current enemy, on the table
  $('#played-row').innerHTML = v.playedCombos.map(c =>
    `<span class="table-combo">${c.cards.map(card =>
      `<span class="table-card">${cardSVG(card)}</span>`).join('')}</span>`).join('');

  renderSeats(v);

  // status + hand + actions
  const status = $('#status-strip');
  status.innerHTML = help.statusText(v, staged.length);
  const yourTurn = v.you && v.current === v.you.index;
  status.classList.toggle('danger', v.phase === 'discard');
  status.classList.toggle('waiting', v.phase !== 'discard' && !yourTurn);
  renderHand(v);
  renderActions(v);

  // pause banner
  const banner = $('#pause-banner');
  if (mode === 'mp' && v.connections?.some(c => !c)) {
    const gone = v.players.filter((_, i) => !v.connections[i]).map(p => p.name).join(', ');
    banner.textContent = `⏸ Waiting for ${gone} to return…`;
    banner.hidden = false;
  } else banner.hidden = true;
}

// A physical-looking pile: under-edges + a top card (back, or a face for the Fallen).
function renderDeck(stackEl, count, topFaceCard) {
  if (count === 0) {
    stackEl.className = 'deck-stack empty-deck';
    stackEl.innerHTML = '';
    return;
  }
  stackEl.className = 'deck-stack';
  const layers = Math.min(3, Math.ceil(count / 10));
  let html = '';
  for (let i = layers; i > 0; i--) {
    html += `<span class="deck-card under" style="transform:translate(${i * 2}px,${i * 2}px)"></span>`;
  }
  html += `<span class="deck-card ${topFaceCard ? 'face' : ''}">${topFaceCard ? cardSVG(topFaceCard) : cardBackSVG()}</span>`;
  stackEl.innerHTML = html;
}

// Fellow citoyens seated around the table with their facedown hands.
const SEAT_POS = { 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'] };
function renderSeats(v) {
  const seats = $('#seats');
  const board = document.querySelector('.board');
  const you = v.you?.index ?? -1;
  const others = v.players.map((p, i) => ({ p, i })).filter(o => o.i !== you);
  board.classList.toggle('side-seats', others.length >= 2);
  const choosing = v.phase === 'jesterChoose' && v.you && v.current === v.you.index;
  const narrow = window.innerWidth <= 480;
  const fanW = narrow ? 96 : 128, cw = narrow ? 24 : 30;

  seats.innerHTML = '';
  others.forEach((o, k) => {
    const pos = (SEAT_POS[others.length] ?? SEAT_POS[3])[k] ?? 'top';
    const el = document.createElement('button');
    el.className = ['seat', `pos-${pos}`,
      o.i === v.current ? 'current' : '',
      (v.connections && v.connections[o.i] === false) ? 'disconnected' : '',
      choosing ? 'choosable' : ''].join(' ');
    const n = o.p.handCount;
    let fan = '';
    if (n > 0) {
      const step = n === 1 ? 0 : Math.min(cw * .72, (fanW - cw) / (n - 1));
      const x0 = (fanW - (cw + step * (n - 1))) / 2;
      for (let j = 0; j < n; j++) {
        const rot = n === 1 ? 0 : -9 + 18 * j / (n - 1);
        fan += `<span class="fan-card" style="left:${(x0 + j * step).toFixed(1)}px; transform:rotate(${rot.toFixed(1)}deg)">${cardBackSVG()}</span>`;
      }
    }
    el.innerHTML = `<span class="seat-fan">${fan}</span>
      <span class="seat-name">${esc(o.p.name)} · ${n}${o.p.yielded ? ' 🕊' : ''}${(v.connections && v.connections[o.i] === false) ? ' ⏸' : ''}</span>`;
    if (choosing) el.onclick = () => sendAction({ type: 'chooseNext', target: o.i }, flashError);
    seats.appendChild(el);
  });
}

function isStaged(c) { return staged.some(s => engine.sameCard(s, c)); }

function renderHand(v) {
  const zone = $('#hand-zone');
  if (!v.you) { zone.innerHTML = ''; return; }
  const ps = pseudoState(v);
  const myTurn = v.current === v.you.index;
  const canStage = myTurn && (v.phase === 'play' || v.phase === 'discard');

  zone.innerHTML = v.you.hand.length ? '' : '<div class="hand-empty">Empty-handed — but not out of the fight.</div>';
  v.you.hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'hand-card';
    el.innerHTML = cardSVG(card);
    const stagedNow = isStaged(card);
    if (stagedNow) el.classList.add('staged');
    let extendable = true;
    if (canStage && v.phase === 'play' && !stagedNow) {
      extendable = engine.validatePlay(ps, v.you.index, [...staged, card]) === null;
    }
    if (!canStage || (v.phase === 'play' && !stagedNow && !extendable)) el.classList.add('disabled');

    attachPress(el,
      () => { // tap: stage/unstage
        if (!canStage) return;
        if (stagedNow) staged = staged.filter(s => !engine.sameCard(s, card));
        else if (v.phase === 'discard' || extendable) staged = [...staged, card];
        else return;
        renderGame(view);
      },
      () => openSheet(help.cardInfo(card, v)) // long-press: contextual rules
    );
    zone.appendChild(el);
  });
  requestAnimationFrame(() => layoutHand(v.you.hand.length));
}

// Keep every hand visible. Cards overlap by at most one third; once that is no
// longer enough, the whole hand scales down continuously with the viewport.
function layoutHand(count = view?.you?.hand.length ?? 0) {
  const zone = $('#hand-zone');
  if (!count || !zone.clientWidth) return;
  const target = window.matchMedia('(min-width: 800px)').matches ? 104 : 84;
  const available = Math.max(1, zone.clientWidth - 28);
  const naturalGap = 9;
  let width = target;
  let gap = naturalGap;

  if (count > 1 && count * target + (count - 1) * naturalGap > available) {
    const fittedGap = (available - count * target) / (count - 1);
    if (fittedGap >= -target / 3) {
      gap = fittedGap;
    } else {
      width = Math.min(target, available / (1 + (count - 1) * 2 / 3));
      gap = -width / 3;
    }
  }

  zone.style.setProperty('--hand-card-w', `${width.toFixed(2)}px`);
  zone.style.setProperty('--hand-gap', `${gap.toFixed(2)}px`);
}

window.addEventListener('resize', () => layoutHand());

function renderActions(v) {
  const confirm = $('#btn-confirm'), yield_ = $('#btn-yield'), regroup = $('#btn-regroup');
  const you = v.you, myTurn = you && v.current === you.index;
  const ps = pseudoState(v);

  confirm.hidden = false;
  if (v.phase === 'play' && myTurn) {
    confirm.textContent = 'Attack';
    confirm.disabled = staged.length === 0 || engine.validatePlay(ps, you.index, staged) !== null;
    yield_.hidden = false;
    yield_.disabled = !v.canYield;
  } else if (v.phase === 'discard' && myTurn) {
    confirm.textContent = 'Sacrifice';
    const total = staged.reduce((s, c) => s + engine.cardValue(c), 0);
    confirm.disabled = total < v.pendingDamage || engine.validateDiscard(ps, you.index, staged) !== null;
    yield_.hidden = true;
  } else if (v.phase === 'jesterChoose' && myTurn) {
    confirm.textContent = 'Take the floor yourself';
    confirm.disabled = false;
    yield_.hidden = true;
  } else {
    confirm.textContent = '…';
    confirm.disabled = true;
    yield_.hidden = true;
  }

  regroup.hidden = !(v.solo && v.soloJesters > 0 && myTurn && (v.phase === 'play' || v.phase === 'discard'));
  regroup.textContent = `Regroup (${v.soloJesters})`;

  $('#projection').innerHTML = help.projectionText(v, staged, ps) || '';
}

function flashError(res) {
  if (res?.ok === false) {
    $('#projection').innerHTML = `<span class="warn">${esc(res.error)}</span>`;
  }
}

$('#btn-confirm').onclick = () => {
  if (!view?.you) return;
  if (view.phase === 'jesterChoose') {
    sendAction({ type: 'chooseNext', target: view.you.index }, flashError);
    return;
  }
  const type = view.phase === 'discard' ? 'discard' : 'play';
  const cards = staged;
  staged = [];
  sendAction({ type, cards }, res => { if (!res.ok) { staged = cards; renderGame(view); flashError(res); } });
};
$('#btn-yield').onclick = () => { staged = []; sendAction({ type: 'yield' }, flashError); };
$('#btn-regroup').onclick = () => { staged = []; sendAction({ type: 'regroup' }, flashError); };

// ── end screen ──────────────────────────────────────────────────────────────
function renderEnd(v) {
  show('end');
  const won = v.phase === 'won';
  $('#end-emblem').textContent = won ? '🇫🇷' : '⚰️';
  $('#end-title').textContent = won ? EXCLAIM.win : EXCLAIM.lose;
  let detail = '';
  if (won && v.solo) detail = `A ${v.result?.medal ?? 'Bronze'} victory — ${v.soloJestersUsed} Regroup${v.soloJestersUsed === 1 ? '' : 's'} used.`;
  else if (won) detail = 'The twelve royals have fallen. The Republic is born.';
  else detail = v.result?.reason ?? '';
  $('#end-detail').textContent = detail;
  $('#btn-rematch').textContent = 'Once More to the Barricades';
}
$('#btn-rematch').onclick = () => {
  if (mode === 'solo') {
    soloState = engine.newGame([myName()]);
    lastAnimSeq = 0; endHandled = false; staged = [];
    onView(engine.viewFor(soloState, 0));
  } else {
    net().emit('rematch', {}, flashError);
  }
};
function exitToHome(forgetSession = false) {
  if (mode === 'mp' && forgetSession) { saveSession(null); session = null; }
  if (mode === 'mp') { socket?.disconnect(); socket = null; }
  mode = null; soloState = null; view = null; staged = [];
  show('home');
}

$('#btn-quit').onclick = () => {
  const msg = mode === 'mp'
    ? 'Leave this salon? Your seat stays reserved — rejoin any time with the same browser.'
    : 'Abandon this solo game?';
  if (!window.confirm(msg)) return;
  exitToHome(); // multiplayer keeps its seat for rejoining
};
$('#btn-surrender').onclick = () => {
  const msg = mode === 'mp'
    ? 'Surrender this game for everyone and exit the salon?'
    : 'Surrender this solo game and exit?';
  if (!window.confirm(msg)) return;
  if (mode === 'mp') {
    sendAction({ type: 'surrender' }, res => {
      if (!res?.ok) return flashError(res);
      exitToHome(true);
    });
  } else {
    exitToHome();
  }
};
$('#btn-home').onclick = () => {
  exitToHome(true);
};

// ── sheets and help panel ───────────────────────────────────────────────────
function openSheet(html) {
  $('#sheet-content').innerHTML = html;
  $('#sheet').hidden = false;
}
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });

for (const kind of ['castle', 'tavern', 'discard']) {
  $(`#pile-${kind}`).onclick = () => view && openSheet(help.pileInfo(kind, view));
}
attachPress($('#enemy-zone'), () => view && openSheet(help.enemyInfo(view)), () => view && openSheet(help.enemyInfo(view)));

function openHelp(v) {
  $('#help-content').innerHTML = help.helpHTML(v ?? view);
  $('#help-panel').hidden = false;
  const here = $('#help-content .here');
  if (here) here.scrollIntoView({ block: 'start' });
}
$('#btn-help').onclick = () => openHelp(view);
$('#help-close').onclick = () => { $('#help-panel').hidden = true; };

// ── long-press helper ───────────────────────────────────────────────────────
function attachPress(el, onTap, onLong) {
  let timer = null, longFired = false;
  el.addEventListener('pointerdown', () => {
    longFired = false;
    timer = setTimeout(() => { longFired = true; onLong(); }, 480);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerup', () => { cancel(); if (!longFired) onTap(); });
  el.addEventListener('contextmenu', e => e.preventDefault());
}

// ── coach marks (first game only) ───────────────────────────────────────────
let coachStep = -1;
function maybeCoach() {
  if (load('r1789_coach') || coachStep >= 0) return;
  coachStep = 0;
  showCoach();
}
function showCoach() {
  const steps = help.COACH_STEPS;
  $$('.coach-hilite').forEach(el => el.classList.remove('coach-hilite'));
  if (coachStep >= steps.length) {
    $('#coach').hidden = true;
    save('r1789_coach', true);
    return;
  }
  const step = steps[coachStep];
  const target = $(step.el);
  target.classList.add('coach-hilite');
  $('#coach-text').textContent = step.text;
  $('#coach').hidden = false;
  const r = target.getBoundingClientRect();
  const bubble = $('#coach-bubble');
  const below = r.bottom < window.innerHeight * 0.55;
  bubble.style.top = below ? `${r.bottom + 10}px` : '';
  bubble.style.bottom = below ? '' : `${window.innerHeight - r.top + 10}px`;
  bubble.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 290))}px`;
  $('#coach-next').textContent = coachStep === steps.length - 1 ? 'À la Bastille!' : 'Next';
}
$('#coach-next').onclick = () => { coachStep++; showCoach(); };

// ── boot ────────────────────────────────────────────────────────────────────
// Same-tab refresh (sessionStorage) rejoins silently — the phone-lock case.
// A brand-new tab only OFFERS to resume the seat found in localStorage, so a
// second player on the same browser can't accidentally hijack it.
const tabSession = (() => { try { return JSON.parse(sessionStorage.getItem('r1789_session')); } catch { return null; } })();
if (tabSession?.code) {
  tryRejoin(false);
} else {
  show('home');
  if (session?.code) {
    const btn = $('#btn-resume');
    btn.innerHTML = `Rejoin salon ${esc(session.code)} <small>as ${esc(session.name ?? 'Citoyen')}</small>`;
    btn.hidden = false;
    btn.onclick = () => tryRejoin(false);
  }
}
