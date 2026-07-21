// Entrance theatrics and the guillotine.
import { cardSVG, victimSVG } from '/js/cards.js';
import { enemyMeta, enemyThreat, SUIT_META, RANK_TITLES, EXCLAIM } from '/shared/theme.js';

const $ = sel => document.querySelector(sel);

let entranceTimer = null;
let typeTimer = null;
let onEntranceDone = null;

export function showEntrance(enemy, done) {
  const meta = enemyMeta(enemy.card);
  const threat = enemyThreat(enemy.card, enemy.threatVariant);
  const sm = SUIT_META[enemy.card.s];
  $('#entrance-card').innerHTML = cardSVG(enemy.card, { subtitle: true });
  $('#entrance-facts').innerHTML =
    `<b>${meta.name}</b> — ${RANK_TITLES[enemy.card.r]} of ${sm.symbol}<br>` +
    `⚔️ Attack ${enemy.attack} · 🛡️ Endurance ${enemy.health - enemy.damage}<br>` +
    `<span class="badge">Immune to ${sm.symbol} ${sm.power}</span>`;
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
  entranceTimer = setTimeout(dismissEntrance, 2200 + threat.length * 26 + 2600);
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
  const x0 = f.left + f.width / 2 - 22, y0 = f.top + f.height / 2 - 31;
  const dx = (t.left + t.width / 2) - (f.left + f.width / 2);
  const dy = (t.top + t.height / 2) - (f.top + f.height / 2);
  for (let i = 0; i < n; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'fly-card';
    ghost.innerHTML = svg;
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

export function showGuillotine(enemyCard, exact, done) {
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
  caption.innerHTML = exact
    ? `${EXCLAIM.converted}<span class="sub">${meta.name} joins the cause — top of Le Peuple</span>`
    : `${EXCLAIM.guillotine}<span class="sub">${meta.name} is no more</span>`;
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
  }, 3100);
}
