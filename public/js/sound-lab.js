// Sound Lab — plays every effect the game can make (through the real
// audio.js synthesis, so what you hear here is what you'd hear in-game) plus
// the two cutscene videos' own soundtracks, measures each one's loudness,
// and suggests a per-sound trim so everything sits at the same level. Lab
// state (trims, measurements) is in-memory only; nothing here is persisted
// or fed back into the game — read the numbers back into audio.js by hand.
import * as audio from '/js/audio.js';

const $ = sel => document.querySelector(sel);

const SFX_ROWS = audio.SFX_KINDS.map(kind => ({ id: `sfx-${kind}`, label: kind, kind: 'sfx', sfxKind: kind }));
const VIDEO_ROWS = [
  { id: 'video-begin', label: 'Begin cutscene', kind: 'video', url: '/video/begin.mp4', hint: 'game-start video' },
  { id: 'video-victory', label: 'Victory cutscene', kind: 'video', url: '/video/victory.mp4', hint: 'win video' },
];
const ROWS = [...SFX_ROWS, ...VIDEO_ROWS];

const state = {};
for (const row of ROWS) state[row.id] = { dbfs: null, trim: 1, suggestedTrim: null };

// ── a small, separate Web Audio graph just for the two video soundtracks —
// independent of audio.js's own context, so trims here never touch the game.
let fileCtx = null;
const fileNodes = {};
function ensureFileGraph() {
  if (fileCtx) return;
  fileCtx = new (window.AudioContext || window.webkitAudioContext)();
  for (const row of VIDEO_ROWS) {
    const el = $(`#${row.id}`);
    const source = fileCtx.createMediaElementSource(el);
    const gain = fileCtx.createGain();
    gain.gain.value = state[row.id].trim;
    source.connect(gain).connect(fileCtx.destination);
    fileNodes[row.id] = { el, gain };
  }
}

// ── loudness measurement ────────────────────────────────────────────────
// Video: decode the file directly and take the RMS across the whole buffer —
// instant, exact, no playback needed.
async function measureVideo(row) {
  const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
  let dbfs = -Infinity;
  try {
    const res = await fetch(row.url);
    const buf = await res.arrayBuffer();
    const audioBuf = await tmpCtx.decodeAudioData(buf);
    let sumSquares = 0, count = 0;
    for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) { sumSquares += data[i] * data[i]; count++; }
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, count));
    if (rms > 0) dbfs = 20 * Math.log10(rms);
  } catch (err) {
    console.warn(`Could not decode ${row.url} for measurement:`, err);
  } finally {
    tmpCtx.close();
  }
  return dbfs;
}

// Synthesized sfx can't be decoded ahead of time — play it for real through
// audio.js and listen in on the effects bus while it runs.
function measureSfxLive(kind, trim, ms = 1600) {
  const analyser = audio.getSfxAnalyser();
  if (!analyser) return Promise.resolve(-Infinity);
  const data = new Float32Array(analyser.fftSize);
  let sumSquares = 0, samples = 0;
  const start = performance.now();
  audio.sfx(kind, trim);
  return new Promise(resolve => {
    (function poll() {
      analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i++) { sumSquares += data[i] * data[i]; samples++; }
      if (performance.now() - start < ms) {
        requestAnimationFrame(poll);
      } else {
        const rms = Math.sqrt(sumSquares / Math.max(1, samples));
        resolve(rms > 0 ? 20 * Math.log10(rms) : -Infinity);
      }
    })();
  });
}

async function measureRow(row) {
  const s = state[row.id];
  setRowBusy(row, true);
  s.dbfs = row.kind === 'video' ? await measureVideo(row) : await measureSfxLive(row.sfxKind, s.trim);
  setRowBusy(row, false);
  renderRow(row);
  return s.dbfs;
}

function computeSuggestions() {
  const measured = ROWS.map(r => state[r.id].dbfs).filter(Number.isFinite);
  if (!measured.length) return;
  const target = Math.min(...measured); // the quietest sound is the ceiling everything else comes down to
  for (const row of ROWS) {
    const s = state[row.id];
    if (!Number.isFinite(s.dbfs)) { s.suggestedTrim = null; continue; }
    // s.dbfs already reflects the current trim — recover the untrimmed
    // ("raw") level so the suggestion is relative to that, not compounded.
    const rawDbfs = s.dbfs - 20 * Math.log10(s.trim || 1);
    const deltaDb = target - rawDbfs; // <= 0: match-the-quietest never boosts
    s.suggestedTrim = Math.max(0, Math.min(1, 10 ** (deltaDb / 20)));
    renderRow(row);
  }
  renderReport();
}

// ── playback ─────────────────────────────────────────────────────────────
function playRow(row) {
  const s = state[row.id];
  if (row.kind === 'video') {
    ensureFileGraph();
    const { el, gain } = fileNodes[row.id];
    gain.gain.value = s.trim;
    el.currentTime = 0;
    el.play().catch(() => {});
  } else {
    audio.sfx(row.sfxKind, s.trim);
  }
  flashRow(row);
}

function flashRow(row) {
  const tr = $(`#row-${row.id}`);
  tr.classList.add('playing');
  setTimeout(() => tr.classList.remove('playing'), 260);
}

// ── UI ───────────────────────────────────────────────────────────────────
function dbLabel(db) {
  if (db == null || !Number.isFinite(db)) return db === -Infinity ? 'silent' : '—';
  return `${db.toFixed(1)} dB`;
}

function rowTemplate(row) {
  const tr = document.createElement('tr');
  tr.id = `row-${row.id}`;
  tr.className = 'sound-row';
  tr.innerHTML = `
    <td class="col-name">${row.label}${row.hint ? `<small>${row.hint}</small>` : ''}</td>
    <td class="col-level">—</td>
    <td class="col-suggested">—</td>
    <td class="col-trim">
      <div class="range-row">
        <input class="trim-slider" type="range" min="0" max="200" step="1" value="100">
        <output class="trim-out">100%</output>
      </div>
    </td>
    <td class="col-actions">
      <button class="btn ghost btn-play" type="button">Play</button>
      <button class="btn ghost btn-measure" type="button">Measure</button>
      <button class="btn ghost btn-suggested" type="button">Use suggested</button>
    </td>
  `;
  tr.querySelector('.btn-play').addEventListener('click', () => playRow(row));
  tr.querySelector('.btn-measure').addEventListener('click', () => measureRow(row).then(renderReport));
  tr.querySelector('.btn-suggested').addEventListener('click', () => {
    const s = state[row.id];
    if (s.suggestedTrim == null) return;
    s.trim = s.suggestedTrim;
    renderRow(row);
    renderReport();
  });
  const slider = tr.querySelector('.trim-slider');
  slider.addEventListener('input', () => {
    state[row.id].trim = Number(slider.value) / 100;
    tr.querySelector('.trim-out').textContent = `${slider.value}%`;
    renderReport();
  });
  return tr;
}

function renderRow(row) {
  const s = state[row.id];
  const tr = $(`#row-${row.id}`);
  const levelEl = tr.querySelector('.col-level');
  levelEl.textContent = dbLabel(s.dbfs);
  levelEl.classList.toggle('silent', s.dbfs === -Infinity);
  const suggestedEl = tr.querySelector('.col-suggested');
  suggestedEl.textContent = s.suggestedTrim == null ? '—' : `trim to ${Math.round(s.suggestedTrim * 100)}%`;
  const slider = tr.querySelector('.trim-slider');
  slider.value = Math.round(s.trim * 100);
  tr.querySelector('.trim-out').textContent = `${Math.round(s.trim * 100)}%`;
}

function setRowBusy(row, busy) {
  const tr = $(`#row-${row.id}`);
  tr.querySelectorAll('button').forEach(b => { b.disabled = busy; });
}

function setAllBusy(busy) {
  document.querySelectorAll('.sound-toolbar button, .sound-table button').forEach(b => { b.disabled = busy; });
}

function renderReport() {
  const lines = ROWS.map(row => {
    const s = state[row.id];
    const trimPct = `${Math.round(s.trim * 100)}%`.padStart(5);
    return `${row.label.padEnd(20)} measured ${dbLabel(s.dbfs).padStart(9)}   trim ${trimPct}`;
  });
  $('#lab-readout').textContent = lines.join('\n');
}

async function measureAll() {
  setAllBusy(true);
  $('#progress').textContent = '';
  for (let i = 0; i < ROWS.length; i++) {
    $('#progress').textContent = `Measuring ${ROWS[i].label}… (${i + 1}/${ROWS.length})`;
    await measureRow(ROWS[i]);
  }
  $('#progress').textContent = 'Done.';
  computeSuggestions();
  setAllBusy(false);
  setTimeout(() => { $('#progress').textContent = ''; }, 2500);
}

function playAllTogether() {
  for (const row of ROWS) playRow(row);
}

function applyAllSuggested() {
  for (const row of ROWS) {
    const s = state[row.id];
    if (s.suggestedTrim != null) s.trim = s.suggestedTrim;
    renderRow(row);
  }
  renderReport();
}

function resetTrims() {
  for (const row of ROWS) {
    state[row.id].trim = 1;
    renderRow(row);
  }
  renderReport();
}

// ── boot ─────────────────────────────────────────────────────────────────
function sectionLabel(text) {
  const tr = document.createElement('tr');
  tr.className = 'section-label';
  tr.innerHTML = `<td colspan="5">${text}</td>`;
  return tr;
}
$('#rows-sfx').appendChild(sectionLabel('Sound effects'));
for (const row of SFX_ROWS) $('#rows-sfx').appendChild(rowTemplate(row));
$('#rows-video').appendChild(sectionLabel('Cutscene video audio'));
for (const row of VIDEO_ROWS) $('#rows-video').appendChild(rowTemplate(row));
renderReport();

$('#btn-enable').addEventListener('click', async () => {
  $('#btn-enable').disabled = true;
  $('#btn-enable').textContent = 'Enabling…';
  await audio.unlock();
  audio.setScene(null); // silent by default — the music toggle turns it on
  ensureFileGraph();
  $('#unlock-gate').hidden = true;
  $('#lab-body').hidden = false;
});

$('#measure-all').addEventListener('click', measureAll);
$('#play-all').addEventListener('click', playAllTogether);
$('#apply-suggested').addEventListener('click', applyAllSuggested);
$('#reset-trims').addEventListener('click', resetTrims);
$('#copy-report').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#lab-readout').textContent);
    $('#copy-report').textContent = 'Copied';
    setTimeout(() => { $('#copy-report').textContent = 'Copy report'; }, 1300);
  } catch {
    $('#copy-report').textContent = 'Copy failed';
  }
});

$('#toggle-music').addEventListener('change', e => {
  audio.setScene(e.target.checked ? 'game' : null);
});
$('#music-vol').addEventListener('input', e => {
  audio.setMusicVolume(e.target.value / 100);
  $('#music-vol-out').value = `${e.target.value}%`;
});
$('#sfx-vol').addEventListener('input', e => {
  audio.setSfxVolume(e.target.value / 100);
  $('#sfx-vol-out').value = `${e.target.value}%`;
});
$('#music-vol-out').value = `${Math.round(audio.getMusicVolume() * 100)}%`;
$('#sfx-vol-out').value = `${Math.round(audio.getSfxVolume() * 100)}%`;
$('#music-vol').value = Math.round(audio.getMusicVolume() * 100);
$('#sfx-vol').value = Math.round(audio.getSfxVolume() * 100);
