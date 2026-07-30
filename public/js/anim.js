// Entrance theatrics and the two royal-defeat judgments.
import { cardSVG, cardBackSVG, victimSVG } from '/js/cards.js';
import { enemyMeta, enemyThreat, SUIT_META, EXCLAIM } from '/shared/theme.js';

const $ = sel => document.querySelector(sel);
const ROYAL_DEFEAT_MS = 3500; // 3.1 s of motion, then a shared .4 s hold.

// Same icons as the enemy stat bars, reused here for the entrance popup.
const HEART_ICON = `<span class="heart-icon"><svg viewBox="0 0 24 24" focusable="false">` +
  `<path d="M12,7 C10,3 4,3.5 4,9 C4,14 8,17.5 12,21.5 C16,17.5 20,14 20,9 C20,3.5 14,3 12,7 Z"/></svg></span>`;
const SWORD_ICON = `<span class="strike-icon"><svg viewBox="0 0 24 24" focusable="false">` +
  `<polygon points="12,1 13.6,5 13.6,14 10.4,14 10.4,5"/><rect x="5.5" y="13" width="13" height="2.2" rx=".6"/>` +
  `<rect x="10.8" y="15.2" width="2.4" height="5" rx=".8"/><circle cx="12" cy="21.3" r="1.8"/></svg></span>`;

let entranceTimer = null;
let typeTimer = null;
let onEntranceDone = null;

export function showEntrance(enemy, done) {
  const meta = enemyMeta(enemy.card);
  const threat = enemyThreat(enemy.card, enemy.threatVariant);
  const sm = SUIT_META[enemy.card.s];
  // Plain card, exactly as it appears on the table — the facts panel beside it
  // already carries the name and title, and a subtitle here would make the
  // royal look like a different card than the one about to be dealt.
  $('#entrance-card').innerHTML = cardSVG(enemy.card);
  $('#entrance-facts').innerHTML =
    `<div class="entrance-name">${meta.name}</div>` +
    `<div class="entrance-title">${meta.title}</div>` +
    `<div class="entrance-stats">` +
      `<span class="entrance-stat">${HEART_ICON}${enemy.health}</span>` +
      `<span class="entrance-stat">${SWORD_ICON}${enemy.effectiveAttack}</span>` +
    `</div>` +
    `<div class="badge">Immune to ${sm.symbol} ${sm.power}</div>`;
  const textEl = $('#entrance-threat');
  textEl.textContent = '';
  textEl.classList.remove('done');
  $('#entrance-overlay').hidden = false;
  onEntranceDone = done;

  // typewriter
  clearInterval(typeTimer);
  let i = 0;
  typeTimer = setInterval(() => {
    i++;
    textEl.textContent = `“${threat.slice(0, i)}${i >= threat.length ? '”' : ''}`;
    if (i >= threat.length) { clearInterval(typeTimer); textEl.classList.add('done'); }
  }, 26);

  clearTimeout(entranceTimer);
  entranceTimer = setTimeout(dismissEntrance, 2200 + threat.length * 26 + 7600);
}

export function dismissEntrance() {
  if ($('#entrance-overlay').hidden) return;
  clearTimeout(entranceTimer);
  clearInterval(typeTimer);
  $('#entrance-overlay').hidden = true;
  const cb = onEntranceDone;
  onEntranceDone = null;
  cb?.();
}

// ── table motion: shuffles and flying cards ────────────────────────────────
export function riffleDeck(stackEl) {
  if (!stackEl) return;
  stackEl.classList.remove('shuffling');
  void stackEl.offsetWidth; // retrigger
  stackEl.classList.add('shuffling');
  setTimeout(() => stackEl.classList.remove('shuffling'), 900);
}

export function flyCards(fromEl, toEl, count, svg, then) {
  if (!fromEl || !toEl) { then?.(); return; }
  const f = fromEl.getBoundingClientRect(), t = toEl.getBoundingClientRect();
  const n = Math.min(count, 5);
  if (n === 0) { then?.(); return; }
  // Ghosts match the source pile's own on-screen size (the deck piles are all
  // sized to the same width as a hand card) instead of a fixed small size, so
  // nothing looks like it shrinks mid-flight.
  const x0 = f.left, y0 = f.top;
  const dx = (t.left + t.width / 2) - (f.left + f.width / 2);
  const dy = (t.top + t.height / 2) - (f.top + f.height / 2);
  for (let i = 0; i < n; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'fly-card';
    ghost.style.width = `${f.width}px`;
    ghost.innerHTML = Array.isArray(svg) ? svg[Math.min(i, svg.length - 1)] : svg;
    ghost.style.left = `${x0}px`;
    ghost.style.top = `${y0}px`;
    document.body.appendChild(ghost);
    const anim = ghost.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) rotate(${(i % 2 ? 1 : -1) * 14}deg)`, opacity: .9 },
    ], { duration: 480, delay: i * 90, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
    anim.onfinish = () => { ghost.remove(); if (i === n - 1) then?.(); };
  }
}

// A played combo's journey: rise from the hand (or, for players who never
// held the cards, fade in) to rest under the enemy long enough to read, then
// continue on into `destinationEl` — the In Play pile for an attack, or La
// Prison for a sacrifice. `onArrived` fires the moment the cards settle
// under the enemy — the caller uses it to release the health/strike bars
// from their pre-hit values, so the drain reads as caused by the hit (a
// sacrifice, which doesn't touch the bars, just omits that callback).
export function animatePlayedCards({ cards, origin, destinationEl, onArrived, onDone }) {
  const enemyZone = document.querySelector('#enemy-zone');
  if (!cards.length || !enemyZone || !destinationEl) { onArrived?.(); onDone?.(); return; }

  const n = Math.min(cards.length, 5);
  const shown = cards.slice(0, n);
  const ez = enemyZone.getBoundingClientRect();
  const restCenterX = ez.left + ez.width / 2;
  const restY = ez.bottom + 16;

  // Cards keep their actual hand size for the whole trip — including once
  // they reach In Play, since the deck piles are already sized to match — so
  // nothing appears to shrink the instant it's played.
  const handZone = document.querySelector('#hand-zone');
  const cardW = origin?.cardWidth
    || parseFloat(getComputedStyle(handZone).getPropertyValue('--hand-card-w'))
    || 96;
  const cardH = cardW * 1.4;
  const halfW = cardW / 2, halfH = cardH / 2;
  const restX = i => restCenterX - halfW + (i - (n - 1) / 2) * (cardW * 0.4);

  const RISE_MS = 620, FADE_MS = 420, HOLD_MS = 900, FLY_MS = 560, STAGGER = 110, FLY_STAGGER = 70;

  const ghosts = shown.map(card => {
    const ghost = document.createElement('div');
    ghost.className = 'fly-card';
    ghost.style.width = `${cardW}px`;
    ghost.innerHTML = cardSVG(card);
    document.body.appendChild(ghost);
    return ghost;
  });

  ghosts.forEach((ghost, i) => {
    const rx = restX(i);
    if (origin) {
      ghost.style.left = `${origin.centerX - halfW}px`;
      ghost.style.top = `${origin.centerY - halfH}px`;
      ghost.style.opacity = '1';
      requestAnimationFrame(() => {
        ghost.style.transition = `left ${RISE_MS}ms cubic-bezier(.22,.7,.3,1) ${i * STAGGER}ms, `
          + `top ${RISE_MS}ms cubic-bezier(.22,.7,.3,1) ${i * STAGGER}ms`;
        ghost.style.left = `${rx}px`;
        ghost.style.top = `${restY}px`;
      });
    } else {
      ghost.style.left = `${rx}px`;
      ghost.style.top = `${restY}px`;
      ghost.style.opacity = '0';
      requestAnimationFrame(() => {
        ghost.style.transition = `opacity ${FADE_MS}ms ease-out ${i * STAGGER}ms`;
        ghost.style.opacity = '1';
      });
    }
  });

  const arriveDelay = (origin ? RISE_MS : FADE_MS) + (n - 1) * STAGGER + 40;
  setTimeout(() => {
    onArrived?.();
    setTimeout(() => {
      const t = destinationEl.getBoundingClientRect();
      const tx = t.left + t.width / 2 - halfW, ty = t.top + t.height / 2 - halfH;
      ghosts.forEach((ghost, i) => {
        ghost.style.transition = `left ${FLY_MS}ms cubic-bezier(.3,.7,.4,1) ${i * FLY_STAGGER}ms, `
          + `top ${FLY_MS}ms cubic-bezier(.3,.7,.4,1) ${i * FLY_STAGGER}ms, `
          + `opacity ${FLY_MS}ms ease ${i * FLY_STAGGER}ms`;
        ghost.style.left = `${tx}px`;
        ghost.style.top = `${ty}px`;
        ghost.style.opacity = '.85';
        ghost.style.transform = `rotate(${(i % 2 ? 1 : -1) * 14}deg)`;
      });
      setTimeout(() => {
        ghosts.forEach(g => g.remove());
        onDone?.();
      }, FLY_MS + (n - 1) * FLY_STAGGER + 40);
    }, HOLD_MS);
  }, arriveDelay);
}

// Once the blade parts the card, each half falls as its own scrap of card
// stock. Instead of a fixed keyframe (which only ever jiggles the same way),
// we integrate the motion frame-by-frame: gravity pulls each half down toward a
// terminal velocity (air drag), a continuous 3D flip tumbles it, and a lift
// force that swings with the flip angle makes it flutter and drift sideways —
// the aerodynamic coupling that gives real falling cards their wandering fall.
let severRaf = 0;
export function severFall(container, { speed = 1, done } = {}) {
  cancelAnimationFrame(severRaf);
  const top = container.querySelector('.victim-half-top .vh-tumble');
  const bottom = container.querySelector('.victim-half-bottom .vh-tumble');
  if (!top || !bottom) { done?.(); return; }
  const rand = (a, b) => a + Math.random() * (b - a);
  const mk = (el, dir) => ({
    el,
    x: 0, y: 0,
    vx: dir * rand(25, 60), vy: rand(-40, 15),
    rx: rand(-6, 6), ry: rand(-8, 8), rz: rand(-4, 4),
    wx: rand(230, 400) * (Math.random() < 0.5 ? 1 : -1), // flip (deg/s)
    wy: rand(-55, 55),
    wz: dir * rand(28, 66),
    lift: rand(560, 820),                                 // flutter force
    liftPhase: rand(0, Math.PI * 2),
    drift: dir * rand(45, 95),                            // net outward drift
  });
  const halves = [mk(top, -1), mk(bottom, 1)];
  const g = 2000, vTerm = 920, k = g / vTerm, dragH = 1.5;
  const limit = window.innerHeight + 280;
  let last = performance.now();
  const start = last;
  function step(now) {
    const dt = Math.min(0.034, (now - last) / 1000) * speed;
    last = now;
    let alive = false;
    for (const h of halves) {
      h.vy += (g - k * h.vy) * dt;
      h.y += h.vy * dt;
      const liftForce = h.lift * Math.sin(h.rx * Math.PI / 180 + h.liftPhase);
      h.vx += (liftForce + h.drift) * dt;
      h.vx -= h.vx * dragH * dt;
      h.x += h.vx * dt;
      h.rx += h.wx * dt;
      h.ry += h.wy * dt;
      h.rz += h.wz * dt;
      h.el.style.transform =
        `perspective(900px) translate3d(${h.x.toFixed(1)}px, ${h.y.toFixed(1)}px, 0) ` +
        `rotateZ(${h.rz.toFixed(1)}deg) rotateY(${h.ry.toFixed(1)}deg) rotateX(${h.rx.toFixed(1)}deg)`;
      if (h.y < limit) alive = true;
    }
    if (alive && (now - start) * speed < 2600) severRaf = requestAnimationFrame(step);
    else done?.();
  }
  severRaf = requestAnimationFrame(step);
}

function showGuillotine(enemyCard, done) {
  const meta = enemyMeta(enemyCard);
  $('#g-victim').innerHTML = victimSVG(enemyCard);
  const victim = $('#g-victim');
  const blade = $('#g-blade');
  const caption = $('#g-caption');
  cancelAnimationFrame(severRaf);
  victim.classList.remove('severed');
  blade.classList.remove('drop');
  caption.classList.remove('show');
  for (const t of victim.querySelectorAll('.vh-tumble')) t.style.transform = '';
  caption.innerHTML = `${EXCLAIM.guillotine}<span class="sub">${meta.name} is no more</span>`;
  $('#guillotine-overlay').hidden = false;
  // force reflow so the animation classes retrigger
  void blade.offsetWidth;
  blade.classList.add('drop');
  victim.classList.add('severed');
  caption.classList.add('show');
  setTimeout(() => severFall(victim), 870);
  setTimeout(() => {
    $('#guillotine-overlay').hidden = true;
    done?.();
  }, ROYAL_DEFEAT_MS);
}

// Build the same compact facedown fan used by multiplayer seats, widened for
// the full-screen judgment. Recomputing the spacing for count + 1 lets all
// existing cards settle naturally when the captured royal joins them.
function captureFan(count) {
  const n = Math.max(0, count);
  if (n === 0) return '';
  const fanW = 190, cardW = 46;
  const step = n === 1 ? 0 : Math.min(cardW * .65, (fanW - cardW) / (n - 1));
  const x0 = (fanW - (cardW + step * (n - 1))) / 2;
  let html = '';
  for (let i = 0; i < n; i++) {
    const rot = n === 1 ? 0 : -9 + 18 * i / (n - 1);
    html += `<span class="capture-fan-card" style="left:${(x0 + i * step).toFixed(1)}px;`
      + `transform:rotate(${rot.toFixed(1)}deg)">${cardBackSVG()}</span>`;
  }
  return html;
}

let captureCountTimer = null;
let captureDoneTimer = null;

// The server stamps index.html at boot, while JavaScript and CSS revalidate on
// every request. During local development that can briefly pair a new client
// with an older entry document. Materialize the overlay here as a compatibility
// guard so a captured royal never silently loses its judgment animation.
function ensureCaptureOverlay() {
  if ($('#capture-overlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="capture-overlay" class="overlay" hidden>
      <div id="capture-stage" class="capture-stage">
        <div class="capture-burst" aria-hidden="true"></div>
        <div id="capture-royal" class="capture-royal" aria-hidden="true">
          <div id="capture-card" class="capture-card"></div>
          <svg class="capture-cockade" viewBox="0 0 82 104">
            <path d="M19 57L13 100L34 84L42 103L48 57Z" fill="#1b2a5e" stroke="#b08d2c" stroke-width="2"/>
            <path d="M39 58L48 101L60 83L73 96L62 51Z" fill="#9e2235" stroke="#b08d2c" stroke-width="2"/>
            <circle cx="41" cy="38" r="32" fill="#1b2a5e" stroke="#b08d2c" stroke-width="3"/>
            <circle cx="41" cy="38" r="21" fill="#f8f1df" stroke="#b08d2c" stroke-width="2"/>
            <circle cx="41" cy="38" r="10" fill="#9e2235" stroke="#b08d2c" stroke-width="2"/>
            <circle cx="41" cy="38" r="3" fill="#d9bc63"/>
          </svg>
          <span class="capture-pin-glint"></span>
        </div>
        <div class="capture-caption">
          <strong>Won over to the Revolution!</strong>
          <span id="capture-sub"></span>
        </div>
        <div class="capture-hand" aria-hidden="true">
          <div id="capture-fan-before" class="capture-fan capture-fan-before"></div>
          <div id="capture-fan-after" class="capture-fan capture-fan-after"></div>
          <span class="capture-seat-name"><span id="capture-player-name"></span> · <b id="capture-hand-count"></b></span>
        </div>
      </div>
    </div>`);
}

function showCapture(enemyCard, recipient, done) {
  ensureCaptureOverlay();
  const meta = enemyMeta(enemyCard);
  const afterCount = Math.max(1, recipient?.handCount ?? 1);
  const beforeCount = Math.max(0, afterCount - 1);
  const playerName = recipient?.name ?? 'The slayer';
  const ownHand = recipient?.isYou !== false;
  const stage = $('#capture-stage');

  clearTimeout(captureCountTimer);
  clearTimeout(captureDoneTimer);
  stage.classList.remove('playing');
  $('#capture-card').innerHTML = cardSVG(enemyCard);
  $('#capture-sub').textContent = `${meta.name} joins ${ownHand ? 'your' : `${playerName}'s`} hand`;
  $('#capture-player-name').textContent = playerName;
  $('#capture-hand-count').textContent = beforeCount;
  $('#capture-fan-before').innerHTML = captureFan(beforeCount);
  $('#capture-fan-after').innerHTML = captureFan(afterCount);
  $('#capture-overlay').hidden = false;

  // Retrigger every CSS timeline even when two exact kills happen in a row.
  void stage.offsetWidth;
  stage.classList.add('playing');
  captureCountTimer = setTimeout(() => {
    $('#capture-hand-count').textContent = afterCount;
  }, 2660);
  captureDoneTimer = setTimeout(() => {
    stage.classList.remove('playing');
    $('#capture-overlay').hidden = true;
    done?.();
  }, ROYAL_DEFEAT_MS);
}

// Exact damage recruits an intact royal; excess damage destroys it. Keeping
// the branch here makes it impossible for a captured card to enter the blade
// animation again.
export function showRoyalDefeat(enemyCard, exact, recipient, done) {
  if (exact) showCapture(enemyCard, recipient, done);
  else showGuillotine(enemyCard, done);
}
