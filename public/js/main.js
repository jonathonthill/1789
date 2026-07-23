// Régicide 1789 — client orchestrator. One render path for multiplayer (server
// views over Socket.IO) and solo (the same engine running locally).
import * as engine from '/shared/engine.js';
import { enemyMeta, SUIT_META, EXCLAIM } from '/shared/theme.js';
import { cardSVG, cardBackSVG } from '/js/cards.js';
import { showEntrance, dismissEntrance, showGuillotine, riffleDeck, flyCards } from '/js/anim.js';
import * as help from '/js/help.js';
import * as audio from '/js/audio.js';

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
  audio.setScene(name === 'game' ? 'game' : (name === 'home' || name === 'lobby' ? 'intro' : null));
}

function syncAudioButtons() {
  const muted = audio.isMuted();
  $$('.audio-toggle').forEach(btn => {
    btn.textContent = muted ? '🔇' : '♫';
    btn.classList.toggle('muted', muted);
    btn.setAttribute('aria-label', 'Sound settings');
    btn.title = 'Sound settings';
  });
  const menu = $('#sound-menu');
  menu.classList.toggle('muted', muted);
  const mute = $('#sound-mute');
  mute.textContent = muted ? 'Unmute' : 'Mute all';
  mute.classList.toggle('on', muted);
  const mv = Math.round(audio.getMusicVolume() * 100);
  const sv = Math.round(audio.getSfxVolume() * 100);
  $('#music-vol').value = mv; $('#music-vol-out').value = `${mv}%`;
  $('#sfx-vol').value = sv; $('#sfx-vol-out').value = `${sv}%`;
}

// Sound menu: any ♫ button opens the volume popover anchored beneath itself.
const soundMenu = $('#sound-menu');
let soundAnchor = null;
function openSoundMenu(btn) {
  soundAnchor = btn;
  soundMenu.hidden = false;
  syncAudioButtons();
  const r = btn.getBoundingClientRect();
  const w = soundMenu.offsetWidth, h = soundMenu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  soundMenu.style.left = `${left}px`;
  soundMenu.style.top = `${top}px`;
}
function closeSoundMenu() { soundMenu.hidden = true; soundAnchor = null; }

$$('.audio-toggle').forEach(btn => {
  btn.onclick = e => {
    e.stopPropagation();
    audio.unlock();
    (!soundMenu.hidden && soundAnchor === btn) ? closeSoundMenu() : openSoundMenu(btn);
  };
});
soundMenu.addEventListener('click', e => e.stopPropagation());
$('#sound-mute').onclick = async () => { await audio.toggleMuted(); syncAudioButtons(); };
$('#music-vol').oninput = e => { audio.setMusicVolume(e.target.value / 100); $('#music-vol-out').value = `${e.target.value}%`; };
$('#sfx-vol').oninput = e => { audio.setSfxVolume(e.target.value / 100); $('#sfx-vol-out').value = `${e.target.value}%`; };
$('#sfx-vol').addEventListener('change', () => { if (!audio.isMuted()) audio.sfx('select'); });
document.addEventListener('click', () => { if (!soundMenu.hidden) closeSoundMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSoundMenu(); });
syncAudioButtons();
document.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
document.addEventListener('keydown', () => audio.unlock(), { once: true, capture: true });

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
      else if (action.type === 'regroup') engine.regroup(s, 0);
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
        // A killing Heart/Diamond still resolves before the royal falls.
        withAnim(done => animateEffects(v, () => {
          audio.sfx('guillotine');
          showGuillotine(v.lastEvent.card, v.lastEvent.exact, done);
        }), () => renderEnd(v));
      } else if (v.phase === 'lost' && v.lastEffects) {
        // Rally/Raid still happened before the fatal counterattack. Show those
        // resolved powers before replacing the board with the loss screen.
        withAnim(done => animateEffects(v, done), () => renderEnd(v));
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
      renderGame(v);
      withAnim(done => animateEffects(v, () => {
        audio.sfx('guillotine');
        showGuillotine(ev.card, ev.exact, () => {
          audio.sfx('enemy');
          showEntrance(v.enemy, done);
        });
      }));
      return;
    } else {
      audio.sfx('enemy');
      withAnim(done => showEntrance(v.enemy, done), maybeWalkthrough);
      if (seq === 1) { // fresh game: the decks get their shuffle
        setTimeout(() => {
          audio.sfx('shuffle');
          riffleDeck($('#stack-tavern')); riffleDeck($('#stack-castle'));
        }, 300);
      }
    }
  }
  renderGame(v);
  animateEffects(v);
}

// Suit-power side effects become table motion: a diamond raid returns the
// Prisoners under Le Peuple, then a heart rally recruits cards into hands.
let lastActionSeq = -1;
function animateEffects(v, done) {
  if (v.actionSeq === lastActionSeq) { done?.(); return; }
  const first = lastActionSeq === -1 && v.actionSeq > 1;
  lastActionSeq = v.actionSeq;
  if (first || !v.lastEffects) { done?.(); return; } // don't replay history on rejoin
  const { healed = 0, drawn = 0 } = v.lastEffects;
  const draw = () => {
    if (drawn <= 0) { done?.(); return; }
    audio.sfx('draw');
    flyCards($('#stack-tavern'), $('#hand-zone'), drawn, cardBackSVG(), done);
  };
  if (healed > 0) {
    audio.sfx('shuffle');
    riffleDeck($('#stack-discard'));
    flyCards($('#stack-discard'), $('#stack-tavern'), healed, cardBackSVG(),
      () => {
        riffleDeck($('#stack-tavern'));
        if (drawn > 0) setTimeout(draw, 300);
        else done?.();
      });
  } else {
    draw();
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
  const gameScreen = $('#screen-game');
  if (gameScreen.hidden && v.phase !== 'won' && v.phase !== 'lost') show('game');
  gameScreen.classList.toggle('multiplayer', mode === 'mp');
  $('#topbar-room').textContent = mode === 'mp' ? `salon ${v.roomCode}` : 'solo';

  // enemy
  if (v.enemy) {
    const e = v.enemy, meta = enemyMeta(e.card), sm = SUIT_META[e.card.s];
    $('#enemy-card').innerHTML = cardSVG(e.card);
    $('#enemy-name').textContent = meta.name;
    $('#enemy-title').textContent = `${meta.title} · ${sm.symbol}`;
    const hp = Math.max(0, e.health - e.damage);
    const hpRatio = hp / e.health;
    const hpWrap = $('.hp-wrap');
    $('#hp-bar').style.width = `${hpRatio * 100}%`;
    $('#hp-text').textContent = `${hpRatio <= .25 ? '♥ ' : ''}${hp} / ${e.health}`;
    hpWrap.classList.toggle('low', hpRatio <= .5);
    hpWrap.classList.toggle('critical', hpRatio <= .25);
    hpWrap.setAttribute('role', 'progressbar');
    hpWrap.setAttribute('aria-label', `${meta.name} health`);
    hpWrap.setAttribute('aria-valuemin', '0');
    hpWrap.setAttribute('aria-valuemax', String(e.health));
    hpWrap.setAttribute('aria-valuenow', String(hp));
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

// A physical-looking pile: under-edges + a top card (back, or a face for La Prison).
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
  // The enemy is immune to its own suit's power (until the Pamphleteer cancels
  // it), so a matching-suit card still deals damage but its power won't fire.
  const immuneSuit = (v.enemy && !v.enemy.immunityCancelled) ? v.enemy.card.s : null;

  zone.innerHTML = v.you.hand.length ? '' : '<div class="hand-empty">Empty-handed — but not out of the fight.</div>';
  v.you.hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'hand-card';
    el.innerHTML = cardSVG(card);
    if (card.s && card.s === immuneSuit) {
      el.classList.add('power-off');
      el.title = "This suit's power is blocked — the enemy is immune.";
    }
    const stagedNow = isStaged(card);
    if (stagedNow) el.classList.add('staged');
    let extendable = true;
    if (canStage && v.phase === 'play' && !stagedNow) {
      extendable = engine.validatePlay(ps, v.you.index, [...staged, card]) === null;
    }
    // Waiting never dims the hand: players can study their cards and prepare.
    // Only mark a card unavailable when it conflicts with a staged play on
    // this player's active turn.
    if (canStage && v.phase === 'play' && !stagedNow && !extendable) el.classList.add('disabled');

    attachPress(el,
      () => { // tap: stage/unstage
        if (!canStage) return;
        if (stagedNow) {
          audio.sfx('deselect');
          staged = staged.filter(s => !engine.sameCard(s, card));
        } else if (v.phase === 'discard' || extendable) {
          audio.sfx('select');
          staged = [...staged, card];
        }
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
  const compactMultiplayer = mode === 'mp' && window.innerWidth <= 480 && window.innerHeight <= 760;
  const target = window.matchMedia('(min-width: 800px)').matches ? 124 : (compactMultiplayer ? 76 : 96);
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
    confirm.textContent = 'Attaquez!';
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

  const regroupsRemaining = v.you?.regroupsRemaining ?? 0;
  regroup.hidden = !(regroupsRemaining > 0 && myTurn && (v.phase === 'play' || v.phase === 'discard'));
  regroup.textContent = `Regroup (${regroupsRemaining})`;

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
    audio.sfx('pamphleteer');
    sendAction({ type: 'chooseNext', target: view.you.index }, flashError);
    return;
  }
  const type = view.phase === 'discard' ? 'discard' : 'play';
  const cards = staged;
  audio.sfx(type === 'discard' ? 'sacrifice' : (cards.some(c => c.r === 'X') ? 'pamphleteer' : 'attack'));
  staged = [];
  sendAction({ type, cards }, res => { if (!res.ok) { staged = cards; renderGame(view); flashError(res); } });
};
$('#btn-yield').onclick = () => { audio.sfx('yield'); staged = []; sendAction({ type: 'yield' }, flashError); };
$('#btn-regroup').onclick = () => { audio.sfx('shuffle'); staged = []; sendAction({ type: 'regroup' }, flashError); };

// ── end screen ──────────────────────────────────────────────────────────────
function renderEnd(v) {
  show('end');
  const won = v.phase === 'won';
  audio.sfx(won ? 'win' : 'lose');
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
  activeHelpView = v ?? view;
  $('#help-content').innerHTML = help.helpHTML(activeHelpView);
  $('#help-panel').hidden = false;
  const here = $('#help-content .here');
  if (here) here.scrollIntoView({ block: 'start' });
}
let activeHelpView = null;
$('#btn-help').onclick = () => openHelp(view);
$('#help-close').onclick = () => { $('#help-panel').hidden = true; };
$('#help-content').addEventListener('click', e => {
  if (!e.target.closest('.help-walkthrough-link')) return;
  $('#help-panel').hidden = true;
  openWalkthrough(activeHelpView);
});

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

// ── animated walkthrough (automatic on the first game, replayable in Help) ─
let walkthroughStep = -1;
let walkthroughPages = [];
let walkthroughReturnFocus = null;

function maybeWalkthrough() {
  // Respect the completion flag from the coach marks this replaces, so
  // returning players are not treated as first-time users again.
  if (load('r1789_walkthrough_v1') || load('r1789_coach') || walkthroughStep >= 0) return;
  openWalkthrough(view);
}

function openWalkthrough(v) {
  walkthroughPages = help.walkthroughSteps(v ?? view);
  walkthroughStep = 0;
  walkthroughReturnFocus = document.activeElement;
  document.body.classList.add('walkthrough-open');
  $('#walkthrough').hidden = false;
  renderWalkthrough();
  $('#walkthrough-exit').focus();
}

function closeWalkthrough() {
  if (walkthroughStep < 0) return;
  save('r1789_walkthrough_v1', true);
  save('r1789_coach', true);
  walkthroughStep = -1;
  walkthroughPages = [];
  $('#walkthrough').hidden = true;
  document.body.classList.remove('walkthrough-open');
  if (walkthroughReturnFocus?.isConnected) walkthroughReturnFocus.focus();
  walkthroughReturnFocus = null;
}

function renderWalkthrough() {
  const page = walkthroughPages[walkthroughStep];
  if (!page) return closeWalkthrough();
  $('#walkthrough-count').textContent = `${walkthroughStep + 1} of ${walkthroughPages.length}`;
  $('#walkthrough-stage').innerHTML = page.stage;
  $('#walkthrough-copy').innerHTML = `<span class="walkthrough-eyebrow">${page.eyebrow}</span><h2 id="walkthrough-title">${page.title}</h2>${page.body}`;
  $('#walkthrough-back').disabled = walkthroughStep === 0;
  $('#walkthrough-next').textContent = walkthroughStep === walkthroughPages.length - 1 ? 'Begin the Revolution' : 'Next';
  $('#walkthrough-dots').innerHTML = walkthroughPages.map((_, i) =>
    `<button type="button" class="${i === walkthroughStep ? 'active' : ''}" data-walk-step="${i}" aria-label="Go to step ${i + 1}"${i === walkthroughStep ? ' aria-current="step"' : ''}></button>`
  ).join('');
}

function moveWalkthrough(delta) {
  const next = walkthroughStep + delta;
  if (next >= walkthroughPages.length) return closeWalkthrough();
  if (next < 0) return;
  walkthroughStep = next;
  renderWalkthrough();
}

$('#walkthrough-exit').onclick = closeWalkthrough;
$('#walkthrough-back').onclick = () => moveWalkthrough(-1);
$('#walkthrough-next').onclick = () => moveWalkthrough(1);
$('#walkthrough-dots').onclick = e => {
  const dot = e.target.closest('[data-walk-step]');
  if (!dot) return;
  walkthroughStep = Number(dot.dataset.walkStep);
  renderWalkthrough();
};
document.addEventListener('keydown', e => {
  if (walkthroughStep < 0) return;
  if (e.key === 'Escape') closeWalkthrough();
  else if (e.key === 'ArrowRight') moveWalkthrough(1);
  else if (e.key === 'ArrowLeft') moveWalkthrough(-1);
});

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
