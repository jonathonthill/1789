// Régicide 1789 — client orchestrator. One render path for multiplayer (server
// views over Socket.IO) and solo (the same engine running locally).
import * as engine from '/shared/engine.js';
import { enemyMeta, SUIT_META, EXCLAIM } from '/shared/theme.js';
import { cardSVG, cardBackSVG } from '/js/cards.js';
import { showEntrance, dismissEntrance, showGuillotine, riffleDeck, flyCards, animatePlayedCards } from '/js/anim.js';
import * as help from '/js/help.js';
import * as audio from '/js/audio.js';
import { SETTINGS, loadRules, saveRules, settingHelp, summarize, rulebookRuns } from '/js/constitution.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

// ── app state ───────────────────────────────────────────────────────────────
let mode = null;            // 'mp' | 'solo'
let socket = null;
let session = loadSession();         // { code, token, name }
let myIndex = null;
let view = null;            // last rendered view
let staged = [];            // cards selected in hand
let handOrder = [];          // cardIds in the player's own drag-to-rearrange order
let soloState = null;
let lastAnimSeq = 0;
let lastPhaseKey = '';
let endHandled = false;
let animBusy = false;
let pendingView = null;
let lastHandCount = 0;       // "your" hand size as of the last processed view
let lobbyCount = 2;          // citoyens in the salon, floored at 2 for rule display

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
const SCREENS = ['home', 'lobby', 'begin', 'game', 'victory', 'end'];
function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  // The cutscenes are a brief overlay on top of the game itself, not a scene
  // of their own — leave whatever music was already playing running.
  if (name === 'begin' || name === 'victory') return;
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
// The browser can suspend an already-unlocked AudioContext on its own after a
// quiet stretch; unlike the one-time listeners above, this stays attached for
// the whole session so later taps can nudge it back on.
document.addEventListener('pointerdown', () => audio.nudge(), { capture: true });

// ── pseudo-state: lets the client reuse engine validation on a partial view ──
function pseudoState(v) {
  const players = Array.from({ length: v.playerCount }, () => ({ hand: [] }));
  if (v.you) players[v.you.index] = { hand: v.you.hand };
  return {
    phase: v.phase, current: v.current, players,
    // validatePlay and previewPlay both read the table's Constitution.
    rules: v.rules ?? engine.DEFAULT_RULES,
    assembly: v.assembly ?? null,
    enemy: v.enemy ? { card: v.enemy.card, damage: v.enemy.damage, immunityCancelled: v.enemy.immunityCancelled } : null,
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
    checkForUpdate(); // a reconnect is usually a phone waking up on a stale tab
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
      else if (action.type === 'assembly') throw new Error('There is no Assemblée to convene alone.');
      else if (action.type === 'chooseNext') engine.chooseNext(s, 0, action.target);
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

// ── La Constitution ─────────────────────────────────────────────────────────
// The same modal serves forming a salon, editing in the lobby, calling a
// rematch, and starting solo — only the confirm label and callback differ.
let draftRules = loadRules();
let constitutionCtx = null;   // { playerCount, onAdopt }

function openConstitution({ sub, confirmLabel, playerCount = 2, onAdopt }) {
  draftRules = loadRules();
  constitutionCtx = { playerCount, onAdopt };
  $('#constitution-sub').textContent = sub;
  $('#constitution-go').textContent = confirmLabel;
  renderConstitution();
  $('#constitution').hidden = false;
}
function closeConstitution() { $('#constitution').hidden = true; constitutionCtx = null; }

function renderConstitution() {
  const seats = constitutionCtx?.playerCount ?? 2;
  $('#constitution-rules').innerHTML = SETTINGS.length ? SETTINGS
    .map(s => `
      <div class="rule-row">
        <span class="rule-label">${esc(s.label)}</span>
        ${s.slider ? sliderControl(s) : buttonControl(s)}
        ${rulebookLine(s.key, seats)}
        ${settingHelp(s)}
      </div>`).join('') : `<p class="constitution-fixed-copy">The current Constitution is fixed for this ruleset. The exact table-size column will be shown when the Revolution begins.</p>`;
}

function buttonControl(s) {
  return `<div class="rule-options" data-key="${s.key}">
    ${s.options.map((o, i) => `
      <button type="button" class="rule-opt${draftRules[s.key] === o.value ? ' on' : ''}" data-idx="${i}">
        ${esc(o.label)}${o.note ? `<span class="rule-note">${esc(o.note)}</span>` : ''}
      </button>`).join('')}
  </div>`;
}

// A settled count reads better as one position on a track than as a row of
// look-alike buttons. The tick labels beneath stay tappable, so the choice is
// never a drag-only affair on a small screen.
function sliderControl(s) {
  const idx = optionIndex(s, draftRules[s.key]);
  const last = s.options.length - 1;
  // The thumb's centre only travels between half a thumb from each end, so the
  // stop dots and their labels are placed on that same inset track rather than
  // on evenly divided columns — otherwise the outer two would never line up.
  const at = i => `left:calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${(i / last).toFixed(4)})`;
  const difficulty = s.key === 'difficulty';
  return `<div class="rule-slider${difficulty ? ' difficulty-slider' : ''}" data-key="${s.key}">
    <div class="rule-track">
      <span class="rule-track-line" aria-hidden="true"></span>
      ${s.options.map((_, i) => `<span class="rule-stop" style="${at(i)}" aria-hidden="true"></span>`).join('')}
      ${difficulty ? `<span class="difficulty-cockade" style="${at(idx)}" aria-hidden="true"><i></i></span>` : ''}
      <input type="range" class="rule-range" min="0" max="${last}" step="1"
             value="${idx}" aria-label="${esc(s.label)}">
    </div>
    <div class="rule-ticks">
      ${s.options.map((o, i) => {
        // The two end labels are flush with the row's text column rather than
        // centred on their dot, which would hang them past the card's edge —
        // "Défaut" is far wider than the half-thumb of track it sits above.
        const edge = difficulty ? '' : (i === 0 ? ' at-start' : (i === last ? ' at-end' : ''));
        return `<button type="button" class="rule-tick${i === idx ? ' on' : ''}${edge}"
          style="${edge ? '' : at(i)}" data-idx="${i}">${esc(o.label)}</button>`;
      }).join('')}
    </div>
  </div>`;
}

function optionIndex(setting, value) {
  const i = setting.options.findIndex(o => o.value === value);
  return i === -1 ? setting.options.findIndex(o => o.value === engine.DEFAULT_RULES[setting.key]) : i;
}

// What "Défaut" comes to at each table size, with this table's own size
// picked out — the host is usually choosing before anyone has joined.
function rulebookLine(key, seats) {
  const runs = rulebookRuns(key);
  if (!runs) return '';
  const chips = runs.map(r => {
    const sizes = r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
    const yours = seats >= r.from && seats <= r.to;
    return `<span class="rule-book-run${yours ? ' yours' : ''}">${sizes} <i>→</i> ${r.value}</span>`;
  }).join('');
  return `<p class="rule-book"><span class="rule-book-label">Défaut by table size</span>
    <span class="rule-book-runs">${chips}</span></p>`;
}

// Sliders update in place rather than re-rendering the menu: replacing the
// range element mid-drag would drop the pointer and strand the thumb.
function setRule(key, idx) {
  const setting = SETTINGS.find(s => s.key === key);
  const value = setting.options[idx].value;
  if (draftRules[key] === value) return;
  draftRules = { ...draftRules, [key]: value };
  audio.sfx('select');
  if (!setting.slider) { renderConstitution(); return; }
  const row = $(`.rule-slider[data-key="${key}"]`);
  row.querySelector('.rule-range').value = idx;
  row.querySelectorAll('.rule-tick').forEach((t, i) => t.classList.toggle('on', i === idx));
  const cockade = row.querySelector('.difficulty-cockade');
  if (cockade) {
    const last = setting.options.length - 1;
    cockade.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${(idx / last).toFixed(4)})`;
  }
}

$('#constitution-rules').onclick = e => {
  const btn = e.target.closest('.rule-opt, .rule-tick');
  if (!btn) return;
  setRule(btn.closest('[data-key]').dataset.key, Number(btn.dataset.idx));
};
$('#constitution-rules').oninput = e => {
  const range = e.target.closest('.rule-range');
  if (range) setRule(range.closest('[data-key]').dataset.key, Number(range.value));
};
$('#constitution-reset').onclick = () => {
  draftRules = { ...engine.DEFAULT_RULES };
  renderConstitution();
};
$('#constitution-cancel').onclick = closeConstitution;
$('#constitution-go').onclick = () => {
  const ctx = constitutionCtx;
  const rules = draftRules;
  saveRules(rules);
  closeConstitution();
  ctx?.onAdopt(rules);
};

function renderRuleBadges(el, rules, playerCount) {
  el.innerHTML = summarize(rules, playerCount)
    .map(r => `<span class="rule-badge${r.standard ? '' : ' house'}">
        <span class="rule-badge-label">${esc(r.label)}</span>${esc(r.value)}</span>`).join('');
}

$('#btn-create').onclick = () => {
  homeError('');
  openConstitution({
    sub: 'The rules this salon adopts. You may revise them until the Revolution begins.',
    confirmLabel: 'Form the Salon',
    onAdopt: rules => {
      net().emit('create', { name: myName(), rules }, res => {
        if (!res.ok) return homeError(res.error);
        session = { code: res.code, token: res.token, name: myName() };
        saveSession(session);
        myIndex = 0;
        show('lobby');
      });
    },
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
  homeError('');
  openConstitution({
    sub: 'The rules you fight under, citoyen.',
    confirmLabel: 'Défendre Seul',
    playerCount: 1,
    onAdopt: rules => {
      mode = 'solo';
      soloState = engine.newGame([myName()], { rules });
      lastAnimSeq = 0; endHandled = false; staged = []; handOrder = [];
      onView(engine.viewFor(soloState, 0));
    },
  });
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
  $('#btn-edit-rules').hidden = !lv.youAreHost;
  // A salon is never a solo table, however few have arrived so far — showing it
  // as one would quote solo's hand size and Regroup pool.
  lobbyCount = Math.max(2, n);
  renderRuleBadges($('#lobby-rules'), lv.rules, lobbyCount);
  myIndex = lv.yourIndex ?? myIndex;
}

$('#btn-edit-rules').onclick = () => openConstitution({
  sub: 'Revise the rules. Every citoyen in the salon sees them.',
  confirmLabel: 'Adopt',
  playerCount: lobbyCount,
  onAdopt: rules => net().emit('rules', { rules }, res => {
    if (!res.ok) { $('#lobby-error').textContent = res.error; $('#lobby-error').hidden = false; }
  }),
});
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
  // Captured before anything renders this view, so animateEffects can tell
  // how many of "your" hand cards are new arrivals from a Rally draw — those
  // get held back from the hand until the fly-in ghosts actually deliver them.
  const prevHandCount = lastHandCount;
  lastHandCount = v.you?.hand.length ?? lastHandCount;
  if (v.phase === 'won' || v.phase === 'lost') {
    if (!endHandled) {
      endHandled = true;
      staged = [];
      if (v.phase === 'won' && v.lastEvent?.type === 'victory') {
        // The board is left showing the about-to-fall royal (no renderGame
        // yet) so the killing combo can make the same hand-to-enemy trip a
        // survived hit gets, before a killing Heart/Diamond resolves and the
        // victory cutscene plays.
        withAnim(done => animateKillingBlow(v, prevHandCount, () => {
          renderGame(v);
          const arrivals = defeatArrivals(v, prevHandCount, v.lastEvent);
          renderSeats(v, defeatSeatHolds(v, v.lastEvent, true));
          animateEffects(v, prevHandCount, () => {
            animatePlayedToPrison(v.lastEvent, () => {
              audio.sfx('guillotine');
              showGuillotine(v.lastEvent.card, v.lastEvent.exact, wonOverTo(v, v.lastEvent), () => {
                renderHand(v);
                renderSeats(v);
                done();
              });
            });
          }, { holdAfter: arrivals.captured });
        }), () => playCutscene('victory', () => renderEnd(v)));
      } else if (v.phase === 'lost' && v.lastSacrifice) {
        // The sacrifice itself succeeded, but it immediately doomed the next
        // citoyen (no cards, can't lie low) — let the cards make their trip
        // to La Prison before the loss screen replaces the board.
        withAnim(done => animateSacrifice(v, () => animateEffects(v, prevHandCount, done)), () => renderEnd(v));
      } else if (v.phase === 'lost' && v.lastEffects) {
        // Rally/Raid still happened before the fatal counterattack. Show those
        // resolved powers before replacing the board with the loss screen.
        renderGame(v);
        withAnim(done => animateEffects(v, prevHandCount, done), () => renderEnd(v));
      } else {
        // A reconnect/refresh straight into an already-decided game — no
        // fresh event to animate, and no need to replay the cutscene either.
        renderGame(v);
        renderEnd(v);
      }
    } else {
      renderGame(v);
    }
    return;
  }
  endHandled = false;
  const seq = v.enemy?.revealSeq ?? 0;
  const freshGame = seq === 1 && seq !== lastAnimSeq;

  // Everything that used to run unconditionally now runs as a continuation,
  // so a brand-new game can hold on the begin cutscene first instead of
  // flashing the board underneath it.
  const proceed = () => {
    show('game');
    const phaseKey = `${v.phase}:${v.current}`;
    if (phaseKey !== lastPhaseKey) { staged = []; lastPhaseKey = phaseKey; }
    if (seq && seq !== lastAnimSeq) {
      lastAnimSeq = seq;
      staged = [];
      const ev = v.lastEvent;
      if (ev?.type === 'defeatAndReveal' && ev.seq === seq) {
        // Board stays on the about-to-fall royal until the killing combo has
        // made its trip; only then does the new enemy actually swap in,
        // right before the guillotine covers the screen anyway.
        withAnim(done => animateKillingBlow(v, prevHandCount, () => {
          renderGame(v);
          const arrivals = defeatArrivals(v, prevHandCount, ev);
          renderSeats(v, defeatSeatHolds(v, ev, true));
          animateEffects(v, prevHandCount, () => {
            animatePlayedToPrison(ev, () => {
              audio.sfx('guillotine');
              showGuillotine(ev.card, ev.exact, wonOverTo(v, ev), () => {
                // Exact-kill recruits arrive with the royal's judgment. Spoils
                // remain held back until their own draw follows the blade.
                renderHand(v, arrivals.spoils);
                renderSeats(v, ev.spoilsByPlayer);
                animateSpoils(v, ev, () => {
                  audio.sfx('enemy');
                  showEntrance(v.enemy, done);
                });
              });
            });
          }, { holdAfter: arrivals.captured + arrivals.spoils });
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
    const firstPlayView = lastPlayActionSeq === -1;
    const isNewAction = v.actionSeq !== lastPlayActionSeq && !(firstPlayView && v.actionSeq > 1);
    lastPlayActionSeq = v.actionSeq;
    if (isNewAction && v.lastPlay) {
      // Any Rally/Raid on this same play runs alongside the play animation,
      // not after it — otherwise La Prison/Le Peuple would sit at their
      // already-resolved state through the whole ~2s play animation before
      // their own fly-in ever caught up to explain the change.
      withAnim(done => {
        let pending = 2;
        const finish = () => { if (--pending === 0) done(); };
        animatePlay(v, finish);
        animateEffects(v, prevHandCount, finish);
      });
    } else if (isNewAction && v.lastSacrifice) {
      withAnim(done => animateSacrifice(v, done), () => animateEffects(v, prevHandCount));
    } else {
      renderGame(v);
      // A Regroup empties La Prison and every hand back into Le Peuple, which
      // swells and is reshuffled — give it the riffle that explains the jump.
      if (isNewAction && v.lastEvent?.type === 'regroup') {
        audio.sfx('shuffle');
        riffleDeck($('#stack-tavern'));
      }
      animateEffects(v, prevHandCount);
    }
  };

  if (freshGame) {
    audio.setScene('game'); // let the music carry straight through the cutscene
    // Let the opening flourish establish the scene, then move straight to the
    // board. The exact table rules remain available at the bottom of contextual
    // help without interrupting every new game.
    withAnim(done => playCutscene('begin', () => {
      show('game');
      renderGame(v);
      done();
    }), proceed);
  } else {
    proceed();
  }
}

// Suit-power side effects become table motion: a diamond raid returns the
// Prisoners under Le Peuple, then a heart rally recruits cards into hands.
let lastActionSeq = -1;
function animatePlayedToPrison(event, done) {
  const cards = event?.playedCards ?? [];
  if (!cards.length) { done?.(); return; }
  audio.sfx('shuffle');
  // The resolved state has already cleared In Play, but its stack remains the
  // visual origin while the face-up committed cards fly into La Prison.
  flyCards(
    $('#stack-played'),
    $('#stack-discard'),
    cards.length,
    cards.slice(-5).map(card => cardSVG(card)),
    () => { riffleDeck($('#stack-discard')); done?.(); }
  );
}

function animateEffects(v, prevHandCount, done, { holdAfter = 0 } = {}) {
  if (v.actionSeq === lastActionSeq) {
    if (holdAfter > 0) renderHand(v, holdAfter);
    done?.();
    return;
  }
  const first = lastActionSeq === -1 && v.actionSeq > 1;
  lastActionSeq = v.actionSeq;
  if (first || !v.lastEffects) {
    if (holdAfter > 0) renderHand(v, holdAfter);
    done?.();
    return;
  } // don't replay history on rejoin
  const { healed = 0, drawn = 0 } = v.lastEffects;

  // Hold back whichever of "your" hand cards are new arrivals from this
  // Rally, so the hand doesn't expand to make room for them until the
  // fly-in ghosts actually deliver them. Whatever just rendered the hand at
  // its final state (renderGame, synchronously, just before this runs) never
  // gets painted — nothing yields the JS thread between the two — so there's
  // no flash of the already-expanded hand before the cards visibly arrive.
  const removedThisAction = (v.you && v.lastPlay?.playerIdx === v.you.index) ? v.lastPlay.cards.length : 0;
  const yourDrawCount = v.you ? Math.max(0, v.you.hand.length - (prevHandCount - removedThisAction)) : 0;
  if (yourDrawCount > 0) renderHand(v, yourDrawCount);

  // Every exit releases the Rally arrivals. A defeat sequence may ask us to
  // keep the captured royal and spoils hidden until their later beats.
  const finish = () => {
    if (yourDrawCount > 0 || holdAfter > 0) renderHand(v, holdAfter);
    done?.();
  };
  const draw = () => {
    if (drawn <= 0) { finish(); return; }
    audio.sfx('draw');
    flyCards($('#stack-tavern'), $('#hand-zone'), drawn, cardBackSVG(), finish);
  };
  if (healed > 0) {
    audio.sfx('shuffle');
    riffleDeck($('#stack-discard'));
    flyCards($('#stack-discard'), $('#stack-tavern'), healed, cardBackSVG(),
      () => {
        riffleDeck($('#stack-tavern'));
        if (drawn > 0) setTimeout(draw, 300);
        else finish();
      });
  } else {
    draw();
  }
}

// Split the cards added to this viewer's hand by a killing action into the
// three moments that explain them: suit powers, exact-kill capture, and spoils.
// The event supplies the spoil allocation; the final hand delta accounts for
// Rally without exposing anyone else's cards.
function defeatArrivals(v, prevHandCount, event) {
  if (!v.you) return { total: 0, captured: 0, spoils: 0 };
  const slayer = v.lastPlay?.playerIdx;
  const removed = slayer === v.you.index ? (v.lastPlay?.cards.length ?? 0) : 0;
  const total = Math.max(0, v.you.hand.length - (prevHandCount - removed));
  const captured = event?.exact
    && (v.rules?.exactKillTo ?? 'hand') === 'hand'
    && slayer === v.you.index ? 1 : 0;
  const spoils = Math.min(total - captured, event?.spoilsByPlayer?.[v.you.index] ?? 0);
  return { total, captured, spoils: Math.max(0, spoils) };
}

function defeatSeatHolds(v, event, includeCapture) {
  const holds = (event?.spoilsByPlayer ?? []).slice();
  while (holds.length < v.players.length) holds.push(0);
  const slayer = v.lastPlay?.playerIdx;
  if (includeCapture
    && event?.exact
    && (v.rules?.exactKillTo ?? 'hand') === 'hand'
    && slayer != null) {
    holds[slayer] = (holds[slayer] ?? 0) + 1;
  }
  return holds;
}

// Spoils are a separate reward beat, after the guillotine has cleared. Hold
// this viewer's actual spoil cards out of their hand until the shared draw
// finishes; the ghost count still shows the whole table's draw.
function animateSpoils(v, event, done) {
  const drawn = event?.spoilsDrawn ?? 0;
  if (drawn <= 0) {
    renderHand(v);
    renderSeats(v);
    done?.();
    return;
  }
  audio.sfx('draw');
  flyCards($('#stack-tavern'), $('#hand-zone'), drawn, cardBackSVG(), () => {
    renderHand(v);
    renderSeats(v);
    done?.();
  });
}

// A just-played combo: the cards rise from the hand (acting player) or fade
// in (everyone else) under the enemy, hold there while the health/strike
// bars react, then continue on into the In Play pile.
let lastPlayActionSeq = -1;
// The combo's shared rise-from point: centered on the group of played cards,
// but sized to a single card — a bounding box spanning all of them would be
// far wider than any one card once more than one is played.
function findPlayedCardsOrigin(cards) {
  const zone = $('#hand-zone');
  const els = cards.map(c => zone.querySelector(`[data-card="${engine.cardId(c)}"]`)).filter(Boolean);
  if (!els.length) return null;
  const rects = els.map(el => el.getBoundingClientRect());
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return {
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    cardWidth: rects[0].width,
    cardHeight: rects[0].height,
  };
}

function animatePlay(v, done) {
  const lp = v.lastPlay;
  const isYou = v.you && lp.playerIdx === v.you.index;
  const origin = isYou ? findPlayedCardsOrigin(lp.cards) : null;

  renderGame(v);
  // Hold the enemy bars and In Play pile at their pre-hit values — the
  // animation below releases each one at the moment it should visibly land.
  if (v.enemy) renderEnemyStats(v.enemy, lp.healthBefore, lp.attackBefore);
  renderPlayedPile(v.playedCombos.slice(0, -1));

  animatePlayedCards({
    cards: lp.cards,
    origin,
    destinationEl: $('#stack-played'),
    onArrived: () => { if (v.enemy) renderEnemyStats(v.enemy, lp.healthAfter, lp.attackAfter); },
    onDone: () => { renderPlayedPile(v.playedCombos); done(); },
  });
}

// A killing blow: by the time this view arrives, the server has already
// moved on (a new enemy is revealed, or the game is won), so v.enemy/
// v.playedCombos no longer describe the royal that was just struck. The
// board is left showing that royal — untouched since the previous render —
// while the killing combo makes the same trip a survived hit would, using
// the fallen royal's own card (from the event) for the bars. The caller
// renders the real new state once this settles, right before the guillotine
// takes over the screen anyway.
// Whose hand an exact-kill royal joined, phrased as a possessive for the
// guillotine caption — null when the royal was overkilled and won over to nobody.
function wonOverTo(v, ev) {
  if (!ev?.exact) return null;
  const slayer = v.lastPlay?.playerIdx;
  if (slayer == null || v.solo || slayer === v.you?.index) return 'your';
  return `${v.players[slayer]?.name ?? 'the slayer'}'s`;
}

function setEnemyBarsForCard(card, hp, atk) {
  const stats = engine.ENEMY_STATS[card.r];
  const maxAttack = Math.max(0, stats.attack + (view?.rules?.royalStrikeBonus ?? 0));
  const hpRatio = hp / stats.health;
  const hpWrap = $('.hp-wrap');
  $('#hp-bar').style.width = `${hpRatio * 100}%`;
  $('#hp-text').textContent = `${hp} / ${stats.health}`;
  hpWrap.classList.toggle('low', hpRatio <= .5);
  hpWrap.classList.toggle('critical', hpRatio <= .25);
  const atkRatio = maxAttack > 0 ? atk / maxAttack : 0;
  $('#strike-bar').style.width = `${atkRatio * 100}%`;
  $('#strike-text').textContent = `${atk} / ${maxAttack}`;
}

function animateKillingBlow(v, prevHandCount, done) {
  const lp = v.lastPlay;
  const ev = v.lastEvent;
  if (!lp) { done(); return; } // safety net — never hang the sequence
  const isYou = v.you && lp.playerIdx === v.you.index;
  const origin = isYou ? findPlayedCardsOrigin(lp.cards) : null;

  // The board deliberately stays on the fallen royal until the combo lands, but
  // the HAND must not: it still holds the cards now flying out of it, and would
  // show each played card twice for the whole trip. Re-render it alone, once the
  // origin has been measured from the old positions — holding back this action's
  // new arrivals (a Rally draw, or a royal won over to the hand) exactly as
  // animateEffects does, so nothing lands before its own animation delivers it.
  const removed = isYou ? lp.cards.length : 0;
  const arrivals = v.you ? Math.max(0, v.you.hand.length - (prevHandCount - removed)) : 0;
  renderHand(v, arrivals);

  setEnemyBarsForCard(ev.card, lp.healthBefore, lp.attackBefore);

  animatePlayedCards({
    cards: lp.cards,
    origin,
    destinationEl: $('#stack-played'),
    onArrived: () => setEnemyBarsForCard(ev.card, lp.healthAfter, lp.attackAfter),
    onDone: () => {
      renderDeck($('#stack-played'), ev.playedCards.length, ev.playedCards.at(-1));
      done();
    },
  });
}

// A sacrifice: cards rise from hand (or fade in, for other players) the same
// way a play does, but continue on into La Prison instead of In Play — no
// enemy bars to release along the way, since discarding for damage doesn't
// touch the enemy at all.
function animateSacrifice(v, done) {
  const ls = v.lastSacrifice;
  const isYou = v.you && ls.playerIdx === v.you.index;
  const origin = isYou ? findPlayedCardsOrigin(ls.cards) : null;

  renderGame(v);
  // Hold La Prison at its pre-sacrifice state until the cards actually land.
  const before = v.discardPile.slice(0, Math.max(0, v.discardPile.length - ls.cards.length));
  renderDeck($('#stack-discard'), before.length, before[before.length - 1] ?? null);
  $('#count-discard').textContent = before.length;

  animatePlayedCards({
    cards: ls.cards,
    origin,
    destinationEl: $('#stack-discard'),
    onDone: () => {
      renderDeck($('#stack-discard'), v.discardCount, v.discardTop);
      $('#count-discard').textContent = v.discardCount;
      done();
    },
  });
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

// Split out from renderGame so the play animation can hold these at their
// pre-hit values and release them once the flying cards actually arrive,
// rather than the bars/pile jumping to the new state before the cards do.
function renderEnemyStats(e, hpOverride, atkOverride) {
  const meta = enemyMeta(e.card), sm = SUIT_META[e.card.s];
  $('#enemy-card').innerHTML = cardSVG(e.card);
  const hp = hpOverride ?? Math.max(0, e.health - e.damage);
  const effectiveAttack = atkOverride ?? e.effectiveAttack;
  const hpRatio = hp / e.health;
  const hpWrap = $('.hp-wrap');
  $('#hp-bar').style.width = `${hpRatio * 100}%`;
  $('#hp-text').textContent = `${hp} / ${e.health}`;
  hpWrap.classList.toggle('low', hpRatio <= .5);
  hpWrap.classList.toggle('critical', hpRatio <= .25);
  hpWrap.setAttribute('role', 'progressbar');
  hpWrap.setAttribute('aria-label', `${meta.name} health`);
  hpWrap.setAttribute('aria-valuemin', '0');
  hpWrap.setAttribute('aria-valuemax', String(e.health));
  hpWrap.setAttribute('aria-valuenow', String(hp));
  const strikeRatio = e.attack > 0 ? effectiveAttack / e.attack : 0;
  const strikeWrap = $('.strike-wrap');
  $('#strike-bar').style.width = `${strikeRatio * 100}%`;
  $('#strike-text').textContent = `${effectiveAttack} / ${e.attack}`;
  strikeWrap.setAttribute('role', 'progressbar');
  strikeWrap.setAttribute('aria-label', `${meta.name} strike after barricades`);
  strikeWrap.setAttribute('aria-valuemin', '0');
  strikeWrap.setAttribute('aria-valuemax', String(e.attack));
  strikeWrap.setAttribute('aria-valuenow', String(effectiveAttack));
  $('#enemy-zone').setAttribute(
    'aria-label',
    `${meta.name}. ${hp} of ${e.health} health. ${effectiveAttack} of ${e.attack} strike.${e.immunityCancelled ? ' Immunity shattered.' : ` Immune to ${sm.power}.`}`
  );
}

function renderPlayedPile(combos) {
  const playedCards = combos.flatMap(combo => combo.cards);
  const playedTop = playedCards[playedCards.length - 1] ?? null;
  renderDeck($('#stack-played'), playedCards.length, playedTop);
  $('#count-played').textContent = playedCards.length;
  const playedLabel = playedCards.length
    ? `${playedCards.length} card${playedCards.length === 1 ? '' : 's'} in play. Open the stack.`
    : 'No cards in play. Open the stack.';
  $('#pile-played').setAttribute('aria-label', playedLabel);
  $('#pile-played').title = playedLabel;
}

function renderGame(v) {
  const gameScreen = $('#screen-game');
  if (gameScreen.hidden && v.phase !== 'won' && v.phase !== 'lost') show('game');
  gameScreen.classList.toggle('multiplayer', mode === 'mp');
  $('#topbar-room').textContent = mode === 'mp' ? `salon ${v.roomCode}` : 'solo';

  // enemy
  if (v.enemy) renderEnemyStats(v.enemy);

  // decks
  renderDeck($('#stack-castle'), v.castleCount, null);
  renderDeck($('#stack-tavern'), v.tavernCount, null);
  renderDeck($('#stack-discard'), v.discardCount, v.discardTop);
  renderPlayedPile(v.playedCombos);
  $('#count-castle').textContent = v.castleCount;
  $('#count-tavern').textContent = v.tavernCount;
  $('#count-discard').textContent = v.discardCount;

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

// Fellow citoyens' facedown hands sit in the blue rail beneath the table.
function renderSeats(v, holdBackByPlayer = []) {
  const seats = $('#seats');
  const rail = $('#opponent-rail');
  const you = v.you?.index ?? -1;
  const others = v.players.map((p, i) => ({ p, i })).filter(o => o.i !== you);
  const choosing = v.phase === 'jesterChoose' && v.you && v.current === v.you.index;
  const narrow = window.innerWidth <= 480;
  const fanW = narrow ? 82 : 128, cw = narrow ? 22 : 30;

  seats.innerHTML = '';
  rail.hidden = others.length === 0;
  seats.style.setProperty('--opponent-count', Math.max(1, others.length));
  others.forEach(o => {
    const el = document.createElement('button');
    el.className = ['seat',
      o.i === v.current ? 'current' : '',
      (v.connections && v.connections[o.i] === false) ? 'disconnected' : '',
      choosing ? 'choosable' : ''].join(' ');
    const n = Math.max(0, o.p.handCount - (holdBackByPlayer[o.i] ?? 0));
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
      <span class="seat-name">${esc(o.p.name)} · ${n}${o.p.laidLow ? ' 🕊' : ''}${(v.connections && v.connections[o.i] === false) ? ' ⏸' : ''}</span>`;
    if (o.p.laidLow) el.title = `${o.p.name} has lain low against this royal.`;
    if (choosing) el.onclick = () => sendAction({ type: 'chooseNext', target: o.i }, flashError);
    seats.appendChild(el);
  });
}

function isStaged(c) { return staged.some(s => engine.sameCard(s, c)); }

// The player's own drag-to-rearrange order, reconciled against the real
// hand: cards no longer held drop out, cards not seen before (a fresh deal,
// or newly drawn ones — always appended last server-side) join the end in
// their existing relative order. A plain re-render (someone else's turn,
// a status update) never touches this, so a custom order survives it.
function orderedHand(hand) {
  const byId = new Map(hand.map(c => [engine.cardId(c), c]));
  const seen = new Set();
  const kept = [];
  for (const id of handOrder) {
    if (byId.has(id) && !seen.has(id)) { kept.push(id); seen.add(id); }
  }
  for (const c of hand) {
    const id = engine.cardId(c);
    if (!seen.has(id)) { kept.push(id); seen.add(id); }
  }
  handOrder = kept;
  return handOrder.map(id => byId.get(id));
}

// holdBack omits that many cards off the end of the (ordered) hand — used
// while a Rally draw's fly-in ghosts are still travelling, so the newly
// drawn cards don't appear, or make the rest of the hand reflow to fit them,
// until they've actually landed.
function renderHand(v, holdBack = 0) {
  const zone = $('#hand-zone');
  if (!v.you) { zone.innerHTML = ''; return; }
  const ordered = orderedHand(v.you.hand);
  const hand = holdBack > 0 ? ordered.slice(0, ordered.length - holdBack) : ordered;
  const ps = pseudoState(v);
  const myTurn = v.current === v.you.index;
  const canStage = myTurn && (v.phase === 'play' || v.phase === 'discard');
  // The enemy is immune to its own suit's power (until the Pamphleteer cancels
  // it), so a matching-suit card still deals damage but its power won't fire.
  const immuneSuit = (v.enemy && !v.enemy.immunityCancelled) ? v.enemy.card.s : null;

  zone.innerHTML = hand.length ? '' : '<div class="hand-empty">Empty-handed — but not out of the fight.</div>';
  hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'hand-card';
    el.innerHTML = cardSVG(card, { solo: !!v.solo, shielded: v.rules?.pamphleteerImmune !== false });
    el.dataset.card = engine.cardId(card); // lets the play animation find this card's on-screen origin
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

    attachHandCard(el, card, zone,
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
      }
    );
    zone.appendChild(el);
  });
  requestAnimationFrame(() => layoutHand(hand.length));
}

// Set every card from the viewport, not the number of cards currently held.
// Eight cards can always fit with no more than one-third overlap, so deck and
// opponent-card sizes stay steady as hands are drawn or played.
function layoutHand(count = view?.you?.hand.length ?? 0) {
  const zone = $('#hand-zone');
  if (!zone.clientWidth) return;
  const target = window.matchMedia('(min-width: 800px)').matches ? 124 : 96;
  const available = Math.max(1, zone.clientWidth - 28);
  const naturalGap = 9;
  const width = Math.min(target, available / (8 - 7 / 3));
  const gap = count > 1
    ? Math.max(-width / 3, Math.min(naturalGap, (available - count * width) / (count - 1)))
    : naturalGap;

  zone.style.setProperty('--hand-card-w', `${width.toFixed(2)}px`);
  zone.style.setProperty('--hand-card-h', `${(width * 1.4).toFixed(2)}px`);
  zone.style.setProperty('--hand-gap', `${gap.toFixed(2)}px`);
  $('#screen-game').style.setProperty('--deck-w', `${width.toFixed(2)}px`);
  layoutDecks(width);
}

// Match deck scale to the hand. Each side rail holds a pair and switches to a
// vertical stack only when two hand-sized piles no longer fit beside the royal.
function layoutDecks(deckWidth) {
  const center = $('.board-center');
  const royal = $('#enemy-zone');
  const pairs = $$('.deck-col');
  if (!center || !royal || !pairs.length) return;
  const railWidth = Math.max(0, (center.clientWidth - royal.getBoundingClientRect().width) / 2);
  pairs.forEach(pair => {
    const gap = parseFloat(getComputedStyle(pair).columnGap) || 0;
    pair.classList.toggle('stacked', deckWidth * 2 + gap > railWidth);
  });
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
    yield_.hidden = !!v.solo;
    yield_.disabled = !v.canYield;
    yield_.title = v.canYield
      ? 'Skip your turn entirely — no attack, and no strike against you. Once per royal.'
      : 'You have already lain low against this royal.';
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

  // Alone you simply spend a Regroup; at a table you must move for one and let
  // l'Assemblée decide.
  const left = v.regroupsRemaining ?? 0;
  regroup.hidden = !v.canRegroup || !myTurn;
  regroup.textContent = v.solo ? `Regroup (${left})` : `l'Assemblée (${left})`;
  const drawn = v.rules?.regroupDraw ?? 3;
  regroup.title = v.solo
    ? 'Put your hand back into Le Peuple, shuffle, and draw a fresh one'
    : `Move for a Regroup — the table votes, and every citoyen draws ${drawn} card${drawn === 1 ? '' : 's'}`;

  $('#projection').innerHTML = help.projectionText(v, staged, ps) || '';
  renderAssembly(v);
}

// ── l'Assemblée ─────────────────────────────────────────────────────────────
function renderAssembly(v) {
  const a = v.assembly;
  $('#assembly').hidden = !a;
  if (!a) return;
  const mover = v.players[a.caller]?.name ?? 'A citoyen';
  const draw = v.rules?.regroupDraw ?? 3;
  $('#assembly-motion').innerHTML =
    `<strong>${esc(mover)}</strong> moves to Regroup — ${draw} card${draw === 1 ? '' : 's'} from Le Peuple
     to every citoyen, up to their limit.
     ${v.regroupsRemaining} remain${v.regroupsRemaining === 1 ? 's' : ''} in the pool.`;
  $('#assembly-tally').innerHTML = [a.caller, ...a.voters].map(i => {
    const answered = i === a.caller ? true : a.votes[i] !== undefined;
    const aye = i === a.caller ? true : a.votes[i];
    const mark = !answered ? '<span class="vote-pending">…</span>'
      : `<span class="vote-${aye ? 'aye' : 'nay'}">${aye ? 'Yea' : 'Nay'}</span>`;
    return `<li><span>${esc(v.players[i]?.name ?? '—')}${i === a.caller ? ' <span class="tag">· mover</span>' : ''}</span>${mark}</li>`;
  }).join('');
  $('#assembly-actions').hidden = !a.youMayVote;
  $('#assembly-wait').hidden = !!a.youMayVote;
  $('#assembly-wait').textContent = v.you?.index === a.caller
    ? 'Your motion is before the floor…'
    : 'The floor is still debating…';
}

const castVote = aye => {
  audio.sfx('select');
  sendAction({ type: 'vote', aye }, flashError);
};
$('#assembly-aye').onclick = () => castVote(true);
$('#assembly-nay').onclick = () => castVote(false);

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
$('#btn-regroup').onclick = () => {
  staged = [];
  // No shuffle sfx here — the regroup event plays it for every citoyen alike.
  if (view?.solo) { sendAction({ type: 'regroup' }, flashError); return; }
  audio.sfx('select');
  sendAction({ type: 'assembly' }, flashError);
};

// ── cutscenes (game-start and victory) ────────────────────────────────────
const CUTSCENE_FADE_MS = 500;
// Both clips carry their own soundtrack, mastered louder than anything the
// synth bus produces. Pull them down so they don't jump out of the mix.
const CUTSCENE_VOLUME = .64;
// name is 'begin' or 'victory' — each maps to #screen-{name} / #{name}-video.
function playCutscene(name, next) {
  const screen = $(`#screen-${name}`);
  const video = $(`#${name}-video`);
  screen.classList.remove('fading');
  show(name);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    video.pause();
    audio.setMusicSilenced(false);
    video.removeEventListener('ended', finish);
    screen.removeEventListener('click', finish);
    // Fade the stage out before cutting to what comes next, rather than
    // hard-switching between two very differently lit screens.
    screen.classList.add('fading');
    setTimeout(next, CUTSCENE_FADE_MS);
  };
  video.currentTime = 0;
  video.volume = CUTSCENE_VOLUME;
  video.muted = !audio.sfxEnabled();
  // Stand the score down only while the clip's own soundtrack is actually
  // audible — a muted clip with silenced music would be ten seconds of nothing.
  audio.setMusicSilenced(!video.muted);
  video.addEventListener('ended', finish, { once: true });
  screen.addEventListener('click', finish, { once: true });
  const playing = video.play();
  // Autoplay-with-sound can be refused even mid-session; fall back to muted
  // playback rather than leaving the cutscene frozen on its first frame.
  if (playing?.catch) playing.catch(() => {
    video.muted = true;
    audio.setMusicSilenced(false);
    video.play().catch(() => finish());
  });
}

// ── end screen ──────────────────────────────────────────────────────────────
function renderEnd(v) {
  show('end');
  const won = v.phase === 'won';
  audio.sfx(won ? 'win' : 'lose');
  $('#end-emblem').innerHTML = won
    ? `<img class="end-banner" src="/img/specials/victory-banner.png" alt="Citoyens triumphant on the barricade">`
    : '⚰️';
  $('#end-title').textContent = won ? EXCLAIM.win : EXCLAIM.lose;
  $('#end-detail').textContent = won
    ? 'The twelve royals have fallen. The Republic is born.'
    : (v.result?.reason ?? '');
  // A rematch carries a fresh Constitution, so only the host may call one.
  const mayRematch = v.solo || v.youAreHost;
  $('#btn-rematch').hidden = !mayRematch;
  $('#btn-rematch').textContent = 'Once More to the Barricades';
  $('#end-wait').hidden = mayRematch;
}
$('#btn-rematch').onclick = () => {
  const solo = mode === 'solo';
  openConstitution({
    sub: solo ? 'The rules you fight under, citoyen.' : 'The rules for the next game.',
    confirmLabel: 'To the Barricades',
    playerCount: solo ? 1 : (view?.playerCount ?? 2),
    onAdopt: rules => {
      if (solo) {
        soloState = engine.newGame([myName()], { rules });
        lastAnimSeq = 0; endHandled = false; staged = []; handOrder = [];
        onView(engine.viewFor(soloState, 0));
      } else {
        net().emit('rematch', { rules }, flashError);
      }
    },
  });
};
function exitToHome(forgetSession = false) {
  if (mode === 'mp' && forgetSession) { saveSession(null); session = null; }
  if (mode === 'mp') { socket?.disconnect(); socket = null; }
  mode = null; soloState = null; view = null; staged = []; handOrder = [];
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
const sheet = $('#sheet');
const sheetPanel = $('.sheet-panel');
const sheetGrip = $('#sheet-grip');
let sheetCloseTimer = null;
let sheetDrag = null;
let sheetGripDragged = false;

function resetSheetPanel() {
  clearTimeout(sheetCloseTimer);
  sheetPanel.classList.remove('dragging', 'settling');
  sheetPanel.style.transform = '';
}

function openSheet(html) {
  $('#sheet-content').innerHTML = html;
  resetSheetPanel();
  sheet.hidden = false;
}

function closeSheet(animated = true) {
  if (sheet.hidden) return;
  clearTimeout(sheetCloseTimer);
  if (!animated) {
    sheet.hidden = true;
    resetSheetPanel();
    return;
  }
  sheetPanel.classList.remove('dragging');
  sheetPanel.classList.add('settling');
  sheetPanel.style.transform = 'translateY(100%)';
  sheetCloseTimer = setTimeout(() => {
    sheet.hidden = true;
    resetSheetPanel();
  }, 190);
}

sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

sheetGrip.addEventListener('pointerdown', e => {
  if (e.button !== undefined && e.button !== 0) return;
  sheetDrag = { id: e.pointerId, startY: e.clientY, distance: 0 };
  sheetGripDragged = false;
  sheetPanel.classList.remove('settling');
  sheetPanel.classList.add('dragging');
  sheetGrip.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
  sheetDrag.distance = Math.max(0, e.clientY - sheetDrag.startY);
  if (sheetDrag.distance > 5) sheetGripDragged = true;
  sheetPanel.style.transform = `translateY(${sheetDrag.distance}px)`;
  e.preventDefault();
}, { passive: false });
function finishSheetDrag(e, allowClose = true) {
  if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
  const shouldClose = allowClose && sheetDrag.distance >= Math.min(110, sheetPanel.clientHeight * .18);
  sheetDrag = null;
  sheetPanel.classList.remove('dragging');
  if (shouldClose) {
    closeSheet();
  } else {
    sheetPanel.classList.add('settling');
    sheetPanel.style.transform = '';
    sheetCloseTimer = setTimeout(() => sheetPanel.classList.remove('settling'), 190);
  }
  e.preventDefault();
}
window.addEventListener('pointerup', e => finishSheetDrag(e));
window.addEventListener('pointercancel', e => finishSheetDrag(e, false));
sheetGrip.addEventListener('click', () => {
  if (sheetGripDragged) {
    sheetGripDragged = false;
    return;
  }
  closeSheet();
});
sheetGrip.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !sheet.hidden) closeSheet();
});

for (const kind of ['castle', 'tavern', 'discard', 'played']) {
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
// "?" opens a quick, context-driven cheat sheet (current phase, suits in
// hand, decks) instead of jumping straight to the full rulebook — it has its
// own link into that full rulebook for anyone who wants it.
$('#btn-help').onclick = () => view && openSheet(help.contextHelp(view));
$('#sheet-content').addEventListener('click', e => {
  if (!e.target.closest('[data-open-full-help]')) return;
  closeSheet(false);
  openHelp(view);
});
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

// Tap to stage/unstage, or drag sideways to reorder — no long-press here
// (card and suit details now live behind the "?" quick-help button instead,
// since long-press was fighting drag-detection for the same gesture window,
// especially on touch). Moving the pointer past a small threshold before
// release cancels the tap and instead picks the card up (the fixed lift/scale
// is CSS, .hand-card.dragging, matching .staged — JS only ever drives
// horizontal movement). The dragged card itself is never reparented mid-drag
// (that was breaking pointer capture, which read as "doesn't let go");
// instead its siblings preview the slide by translating out of the way,
// purely as a function of the current target slot (recomputed fresh every
// move, so reversing direction just un-shifts them — no accumulated state to
// get stuck). The target slot is arithmetic (pointer delta / card step)
// rather than compared against live sibling boxes: hand cards overlap by
// design, so neighboring midpoints can sit a few pixels apart or cross, which
// is what made an earlier approach flicker. The DOM only actually reorders
// once, on release, at which point the dragged card FLIPs from its held
// position into its landing slot. Dragging past either end of the row
// commits immediately into that end slot instead of letting the card dangle
// past the row's bounds.
const HAND_DRAG_THRESHOLD = 6;
function attachHandCard(el, card, zone, onTap) {
  let dragging = false, pointerId = null;
  let startX = 0, startY = 0, cardStep = 1, minDx = 0, maxDx = 0;
  let order = [], startIndex = 0, currentTarget = 0;

  function applyPreview(targetIndex) {
    if (targetIndex === currentTarget) return;
    currentTarget = targetIndex;
    order.forEach((c, i) => {
      if (c === el) return;
      let shift = 0;
      if (startIndex < targetIndex && i > startIndex && i <= targetIndex) shift = -1;
      else if (startIndex > targetIndex && i >= targetIndex && i < startIndex) shift = 1;
      c.style.translate = shift ? `${shift * cardStep}px` : '';
    });
  }

  function finishDrag(finalIndex) {
    if (!dragging) return;
    dragging = false;
    try { el.releasePointerCapture(pointerId); } catch {}
    pointerId = null;

    applyPreview(finalIndex);
    const beforeRect = el.getBoundingClientRect();

    if (finalIndex !== startIndex) {
      const finalOrder = order.slice();
      finalOrder.splice(startIndex, 1);
      finalOrder.splice(finalIndex, 0, el);
      for (const c of finalOrder) zone.appendChild(c);
    }
    for (const c of order) if (c !== el) c.style.translate = '';

    el.classList.remove('dragging');
    el.style.transition = 'none';
    el.style.translate = '';
    const afterRect = el.getBoundingClientRect();
    const dx = beforeRect.left - afterRect.left, dy = beforeRect.top - afterRect.top;
    el.style.translate = `${dx}px ${dy}px`;
    void el.offsetWidth; // commit the pre-transition offset before releasing it below
    el.style.transition = '';
    el.style.translate = '';

    handOrder = [...zone.children].filter(c => c.classList.contains('hand-card')).map(c => c.dataset.card);
  }

  function updateDrag(clientX) {
    const rawDx = clientX - startX;
    if (rawDx < minDx) { finishDrag(0); return; }
    if (rawDx > maxDx) { finishDrag(order.length - 1); return; }
    el.style.translate = `${rawDx}px`;
    applyPreview(startIndex + Math.round(rawDx / cardStep));
  }

  el.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return; // primary touch/left-click only
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    dragging = false;
    // Without this, touch can hand the gesture to the scroll/pan recognizer
    // before our own threshold check fires — the browser then sends
    // pointercancel instead of pointermove, and the drag silently never starts.
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) <= HAND_DRAG_THRESHOLD) return;
      dragging = true;
      el.setPointerCapture(pointerId);
      el.classList.add('dragging');
      order = [...zone.children].filter(c => c.classList.contains('hand-card'));
      startIndex = currentTarget = order.indexOf(el);
      const zoneStyle = getComputedStyle(zone);
      const cardW = parseFloat(zoneStyle.getPropertyValue('--hand-card-w')) || el.getBoundingClientRect().width;
      const gap = parseFloat(zoneStyle.getPropertyValue('--hand-gap')) || 0;
      cardStep = Math.max(1, cardW + gap);
      minDx = -startIndex * cardStep;
      maxDx = (order.length - 1 - startIndex) * cardStep;
    }
    updateDrag(e.clientX);
  }, { passive: false });
  const release = e => {
    if (e.pointerId !== pointerId) return;
    if (dragging) {
      finishDrag(currentTarget);
    } else if (e.type === 'pointerup') {
      onTap();
    }
    pointerId = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
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

// ── staying fresh ───────────────────────────────────────────────────────────
// Mobile Safari will sit on a cached build for days, so the page carries the
// build stamp it was served with and asks the server what it is running now —
// on load, whenever the tab returns to the foreground, and on every socket
// reconnect (the phone-unlock case). A stale tab reloads itself, unless a solo
// game is in progress: that state lives only in this tab and reloading would
// throw it away, so those players get a banner and choose their moment.
const BUILD = document.querySelector('meta[name="build"]')?.content ?? '';
const RELOADED_FOR = 'r1789_reloaded_for';
let updatePending = false;

function safeToReload() {
  if (mode !== 'solo') return true; // a salon seat is rejoined silently on load
  return !soloState || soloState.phase === 'won' || soloState.phase === 'lost';
}

function offerReload() {
  const banner = $('#update-banner');
  banner.hidden = false;
  banner.onclick = () => location.reload();
}

async function checkForUpdate() {
  // An unstamped page means the server did not render index.html (a file:// or
  // static-host preview) — there is nothing to compare against.
  if (updatePending || !BUILD || BUILD === '__BUILD__') return;
  let latest = null;
  try {
    const res = await fetch('/version', { cache: 'no-store' });
    latest = (await res.json())?.build;
  } catch { return; } // offline, or the server is mid-restart — ask again later
  if (!latest || latest === BUILD) return;
  updatePending = true;
  // If a reload has already been spent on this build and we are STILL stale,
  // something upstream is serving the old document; ask rather than loop.
  const spent = (() => { try { return sessionStorage.getItem(RELOADED_FOR); } catch { return null; } })();
  if (spent === latest || !safeToReload()) { offerReload(); return; }
  try { sessionStorage.setItem(RELOADED_FOR, latest); } catch {}
  location.reload();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});
checkForUpdate();

// ── boot ────────────────────────────────────────────────────────────────────
// Dev shortcuts: /?win jumps straight to the victory cutscene and end screen,
// /?begin plays the game-start cutscene on its own — both skip an actual game
// so either sequence can be previewed on demand. Neither touches real game
// state; /?win just fakes the view shape renderEnd reads.
const debugParams = new URLSearchParams(location.search);
if (debugParams.has('win')) {
  mode = 'solo';
  const debugView = { phase: 'won', solo: true, result: null };
  view = debugView;
  playCutscene('victory', () => renderEnd(debugView));
} else if (debugParams.has('begin')) {
  playCutscene('begin', () => show('home'));
} else {
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
}
