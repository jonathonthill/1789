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

export function showGuillotine(enemyCard, exact, done) {
  const meta = enemyMeta(enemyCard);
  $('#g-victim').innerHTML = victimSVG(enemyCard);
  const victim = $('#g-victim');
  const blade = $('#g-blade');
  const caption = $('#g-caption');
  victim.classList.remove('severed');
  blade.classList.remove('drop');
  caption.classList.remove('show');
  caption.innerHTML = exact
    ? `${EXCLAIM.converted}<span class="sub">${meta.name} joins the cause — top of Le Peuple</span>`
    : `${EXCLAIM.guillotine}<span class="sub">${meta.name} is no more</span>`;
  $('#guillotine-overlay').hidden = false;
  // force reflow so the animation classes retrigger
  void blade.offsetWidth;
  blade.classList.add('drop');
  victim.classList.add('severed');
  caption.classList.add('show');
  setTimeout(() => {
    $('#guillotine-overlay').hidden = true;
    done?.();
  }, 2300);
}
