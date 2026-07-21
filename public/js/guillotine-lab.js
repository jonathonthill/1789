import { victimSVG } from '/js/cards.js';
import { severFall } from '/js/anim.js';
import { enemyMeta, EXCLAIM } from '/shared/theme.js';

const $ = selector => document.querySelector(selector);
const TOTAL_MS = 3000;
const SAMPLE_LEAD_IN_MS = 128;
const SAMPLE_PEAK_MS = 500;

const defaults = Object.freeze({
  bladeDelay: 300,
  bladeDuration: 660,
  splitDelay: 870,
  splitDuration: 1800,
  spread: 34,
  rotation: 27,
  soundDelay: 450,
  volume: 50,
  speed: 1,
  royal: 'JS',
});

let runId = 0;
let audioTimer = null;
let loopTimer = null;
let physicsTimer = null;
let frameId = null;
let replayDebounce = null;
let startedAt = 0;

const sample = new Audio('/audio/guillotine-swish.wav');
sample.preload = 'auto';

function number(id) { return Number($(`#${id}`).value); }

function settings() {
  return {
    bladeDelay: number('blade-delay'),
    bladeDuration: number('blade-duration'),
    splitDelay: number('split-delay'),
    splitDuration: number('split-duration'),
    spread: number('spread'),
    rotation: number('rotation'),
    soundDelay: number('sound-delay'),
    volume: number('volume'),
    speed: number('speed'),
    royal: $('#royal').value,
  };
}

function cardFrom(value) { return { r: value[0], s: value[1] }; }
function scaled(ms, speed) { return `${ms / speed}ms`; }

function updatePreview() {
  const s = settings();
  const root = document.documentElement;
  root.style.setProperty('--lab-blade-delay', scaled(s.bladeDelay, s.speed));
  root.style.setProperty('--lab-blade-duration', scaled(s.bladeDuration, s.speed));
  root.style.setProperty('--lab-split-delay', scaled(s.splitDelay, s.speed));
  root.style.setProperty('--lab-top-duration', scaled(s.splitDuration - 20, s.speed));
  root.style.setProperty('--lab-bottom-duration', scaled(s.splitDuration + 20, s.speed));
  const topSpread = Math.max(0, s.spread - 1);
  const topRotation = s.rotation + 1;
  const bottomRotation = Math.max(0, s.rotation - 1);
  root.style.setProperty('--lab-top-x', `${-topSpread}px`);
  root.style.setProperty('--lab-top-x-wide', `${-(topSpread + 14)}px`);
  root.style.setProperty('--lab-bottom-x', `${s.spread}px`);
  root.style.setProperty('--lab-bottom-x-mid', `${s.spread + 5}px`);
  root.style.setProperty('--lab-bottom-x-wide', `${s.spread + 18}px`);
  root.style.setProperty('--lab-top-rotation', `${-topRotation}deg`);
  root.style.setProperty('--lab-top-rotation-mid', `${-topRotation * .9}deg`);
  root.style.setProperty('--lab-top-rotation-wide', `${-topRotation * 1.2}deg`);
  root.style.setProperty('--lab-bottom-rotation', `${bottomRotation}deg`);
  root.style.setProperty('--lab-bottom-rotation-mid', `${bottomRotation * 1.15}deg`);
  root.style.setProperty('--lab-bottom-rotation-wide', `${bottomRotation * 1.35}deg`);

  $('#blade-delay-out').value = `${s.bladeDelay} ms`;
  $('#blade-duration-out').value = `${s.bladeDuration} ms`;
  $('#split-delay-out').value = `${s.splitDelay} ms`;
  $('#split-duration-out').value = `${s.splitDuration} ms`;
  $('#spread-out').value = `${s.spread} px`;
  $('#rotation-out').value = `${s.rotation}°`;
  $('#sound-delay-out').value = `${s.soundDelay} ms`;
  $('#volume-out').value = `${s.volume}%`;

  const pct = value => `${Math.min(100, Math.max(0, value / TOTAL_MS * 100))}%`;
  $('#marker-blade').style.left = pct(s.bladeDelay);
  $('#marker-audio').style.left = pct(s.soundDelay + SAMPLE_LEAD_IN_MS);
  $('#marker-peak').style.left = pct(s.soundDelay + SAMPLE_PEAK_MS);
  $('#marker-split').style.left = pct(s.splitDelay);

  const drift = s.splitDelay - (s.soundDelay + SAMPLE_PEAK_MS);
  const relation = Math.abs(drift) <= 20
    ? '<strong>Aligned:</strong> separation and audio peak are within 20 ms.'
    : `<strong>${Math.abs(drift)} ms ${drift > 0 ? 'late' : 'early'}:</strong> card separation relative to the audio peak.`;
  $('#lab-readout').innerHTML = `${relation}<br>Audible onset ≈ ${s.soundDelay + SAMPLE_LEAD_IN_MS} ms · Peak ≈ ${s.soundDelay + SAMPLE_PEAK_MS} ms`;
}

function stopRun() {
  runId++;
  clearTimeout(audioTimer);
  clearTimeout(loopTimer);
  clearTimeout(physicsTimer);
  cancelAnimationFrame(frameId);
  sample.pause();
  sample.currentTime = 0;
}

function updateTimecode(thisRun, speed) {
  if (thisRun !== runId) return;
  const elapsed = (performance.now() - startedAt) * speed;
  const shown = Math.min(TOTAL_MS, elapsed);
  $('#lab-timecode').textContent = `${(shown / 1000).toFixed(2)} s`;
  $('#timeline-fill').style.width = `${shown / TOTAL_MS * 100}%`;
  if (elapsed < TOTAL_MS) frameId = requestAnimationFrame(() => updateTimecode(thisRun, speed));
}

function replay() {
  stopRun();
  const thisRun = runId;
  const s = settings();
  updatePreview();

  const card = cardFrom(s.royal);
  const meta = enemyMeta(card);
  const victim = $('#g-victim');
  const blade = $('#g-blade');
  const caption = $('#g-caption');
  victim.innerHTML = victimSVG(card);
  caption.innerHTML = `${EXCLAIM.guillotine}<span class="sub">${meta.name} is no more</span>`;

  blade.classList.remove('drop');
  victim.classList.remove('severed');
  caption.classList.remove('show');
  for (const t of victim.querySelectorAll('.vh-tumble')) t.style.transform = '';
  void blade.offsetWidth;
  blade.classList.add('drop');
  victim.classList.add('severed');
  caption.classList.add('show');
  clearTimeout(physicsTimer);
  physicsTimer = setTimeout(() => {
    if (thisRun === runId) severFall(victim, { speed: s.speed });
  }, s.splitDelay / s.speed);

  sample.volume = s.volume / 100;
  sample.playbackRate = s.speed;
  audioTimer = setTimeout(() => {
    if (thisRun !== runId || s.volume === 0) return;
    sample.currentTime = 0;
    sample.play().catch(() => {});
  }, s.soundDelay / s.speed);

  startedAt = performance.now();
  $('#lab-timecode').textContent = '0.00 s';
  $('#timeline-fill').style.width = '0%';
  frameId = requestAnimationFrame(() => updateTimecode(thisRun, s.speed));

  if ($('#loop').checked) {
    loopTimer = setTimeout(replay, (TOTAL_MS + 550) / s.speed);
  }
}

function scheduleReplay() {
  updatePreview();
  clearTimeout(replayDebounce);
  replayDebounce = setTimeout(replay, 140);
}

function reset() {
  $('#blade-delay').value = defaults.bladeDelay;
  $('#blade-duration').value = defaults.bladeDuration;
  $('#split-delay').value = defaults.splitDelay;
  $('#split-duration').value = defaults.splitDuration;
  $('#spread').value = defaults.spread;
  $('#rotation').value = defaults.rotation;
  $('#sound-delay').value = defaults.soundDelay;
  $('#volume').value = defaults.volume;
  $('#speed').value = defaults.speed;
  $('#royal').value = defaults.royal;
  replay();
}

async function copySettings() {
  const s = settings();
  const text = `Guillotine lab: blade ${s.bladeDelay}ms delay / ${s.bladeDuration}ms fall; split ${s.splitDelay}ms / ${s.splitDuration}ms fall; spread ${s.spread}px; rotation ${s.rotation}deg; sound ${s.soundDelay}ms at ${s.volume}%.`;
  try {
    await navigator.clipboard.writeText(text);
    $('#copy-settings').textContent = 'Copied';
    setTimeout(() => { $('#copy-settings').textContent = 'Copy settings'; }, 1300);
  } catch {
    $('#copy-settings').textContent = 'Copy failed';
  }
}

document.querySelectorAll('input[type="range"], select').forEach(control => {
  control.addEventListener('input', scheduleReplay);
});
$('#replay').addEventListener('click', replay);
$('#reset').addEventListener('click', reset);
$('#copy-settings').addEventListener('click', copySettings);
$('#loop').addEventListener('change', replay);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || /INPUT|SELECT|BUTTON/.test(document.activeElement?.tagName)) return;
  event.preventDefault();
  replay();
});

updatePreview();
replay();
