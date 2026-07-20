// Procedural music and sound for 1789. Everything is synthesized with the Web
// Audio API so the game stays lightweight and works offline on the local LAN.

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

const SCENES = {
  intro: {
    tempo: 96,
    melody: [74, 77, 81, 82, 81, 77, 74, 69, 74, 77, 81, 86, 84, 81, 77, 74],
    bass:   [38, null, 45, null, 41, null, 45, null, 38, null, 45, null, 43, null, 45, null],
  },
  game: {
    tempo: 72,
    melody: [62, null, 65, 69, null, 67, 65, null, 60, null, 64, 67, null, 65, 64, null,
      62, null, 65, 70, null, 69, 65, null, 60, null, 64, 69, 67, 65, 62, null],
    bass:   [38, null, null, null, 45, null, null, null, 36, null, null, null, 41, null, null, null,
      38, null, null, null, 46, null, null, null, 36, null, null, null, 45, null, null, null],
  },
};

let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let noiseBuffer = null;
let scheduler = null;
let desiredScene = 'intro';
let activeScene = null;
let nextNoteTime = 0;
let step = 0;
let muted = (() => {
  try { return localStorage.getItem('r1789_audio_muted') === 'true'; } catch { return false; }
})();

export function isSupported() { return !!AudioContextClass; }
export function isMuted() { return muted; }

function ensureContext() {
  if (ctx || !AudioContextClass) return;
  ctx = new AudioContextClass();
  master = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = .004;
  compressor.release.value = .22;
  musicBus.gain.value = .15;
  sfxBus.gain.value = .52;
  master.gain.value = muted ? 0 : .72;
  musicBus.connect(master);
  sfxBus.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.destination);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export async function unlock() {
  if (muted || !AudioContextClass) return false;
  ensureContext();
  if (ctx.state !== 'running') {
    try { await ctx.resume(); } catch { return false; }
  }
  master.gain.setTargetAtTime(.72, ctx.currentTime, .03);
  startMusic();
  return true;
}

export async function toggleMuted() {
  muted = !muted;
  try { localStorage.setItem('r1789_audio_muted', String(muted)); } catch {}
  if (!AudioContextClass) return muted;
  if (muted) {
    if (ctx) {
      master.gain.setTargetAtTime(0, ctx.currentTime, .025);
      setTimeout(() => ctx?.suspend().catch(() => {}), 100);
    }
  } else {
    await unlock();
  }
  return muted;
}

export function setScene(scene) {
  desiredScene = scene;
  if (!ctx || muted) return;
  if (!scene) {
    activeScene = null;
    if (scheduler) { clearInterval(scheduler); scheduler = null; }
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, .18);
    return;
  }
  if (activeScene !== scene) {
    activeScene = scene;
    step = 0;
    nextNoteTime = ctx.currentTime + .08;
  }
  musicBus.gain.setTargetAtTime(scene === 'intro' ? .16 : .12, ctx.currentTime, .18);
  startMusic();
}

function startMusic() {
  if (!ctx || muted || !desiredScene || ctx.state !== 'running') return;
  if (activeScene !== desiredScene) {
    activeScene = desiredScene;
    step = 0;
    nextNoteTime = ctx.currentTime + .08;
  }
  if (!scheduler) scheduler = setInterval(scheduleMusic, 50);
  scheduleMusic();
}

function scheduleMusic() {
  if (!ctx || muted || !activeScene || ctx.state !== 'running') return;
  const score = SCENES[activeScene];
  const eighth = 60 / score.tempo / 2;
  if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime + .04;
  while (nextNoteTime < ctx.currentTime + .2) {
    const i = step % score.melody.length;
    const melody = score.melody[i];
    const bass = score.bass[i % score.bass.length];
    if (melody != null) note(melody, nextNoteTime, eighth * .82, activeScene === 'intro' ? .105 : .065, 'triangle', musicBus);
    if (bass != null) note(bass, nextNoteTime, eighth * 1.8, .075, 'sine', musicBus);
    if (activeScene === 'intro' && i % 4 === 0) note(melody - 12, nextNoteTime, eighth * 1.6, .035, 'sine', musicBus);
    nextNoteTime += eighth;
    step++;
  }
}

function hz(midi) { return 440 * 2 ** ((midi - 69) / 12); }

function note(midi, time, duration, volume, wave = 'triangle', destination = sfxBus) {
  if (!ctx || !destination) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(hz(midi), time);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(wave === 'sine' ? 900 : 1800, time);
  filter.Q.value = .7;
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), time + .018);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + duration + .04);
}

function sweep(from, to, time, duration, volume, wave = 'sawtooth') {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + duration);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1500, time);
  filter.frequency.exponentialRampToValueAtTime(280, time + duration);
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(sfxBus);
  osc.start(time);
  osc.stop(time + duration + .03);
}

function noise(time, duration, volume, highpass = 120, lowpass = 5000) {
  if (!ctx || !noiseBuffer) return;
  const source = ctx.createBufferSource();
  const hp = ctx.createBiquadFilter();
  const lp = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer;
  hp.type = 'highpass'; hp.frequency.value = highpass;
  lp.type = 'lowpass'; lp.frequency.value = lowpass;
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
  source.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(sfxBus);
  source.start(time);
  source.stop(time + duration);
}

export function sfx(kind) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const t = ctx.currentTime + .006;
  switch (kind) {
    case 'select':
      note(74, t, .11, .18); note(81, t + .045, .12, .11); break;
    case 'deselect':
      note(69, t, .12, .13); break;
    case 'attack':
      noise(t, .16, .22, 80, 1800); sweep(150, 62, t, .24, .24); note(50, t, .28, .12, 'square'); break;
    case 'sacrifice':
      noise(t, .28, .14, 500, 4200); sweep(360, 90, t, .3, .13, 'triangle'); break;
    case 'shuffle':
      noise(t, .42, .1, 900, 6200); noise(t + .13, .36, .08, 1200, 7000); break;
    case 'draw':
      [69, 74, 77].forEach((m, i) => note(m, t + i * .075, .18, .11, 'triangle')); break;
    case 'enemy':
      [38, 45, 50].forEach((m, i) => note(m, t + i * .045, .7, .12, i === 0 ? 'sawtooth' : 'triangle'));
      noise(t, .22, .08, 60, 900); break;
    case 'guillotine':
      sweep(620, 75, t, .48, .22, 'sawtooth'); noise(t + .39, .14, .32, 80, 2400); break;
    case 'yield':
      note(67, t, .22, .1, 'sine'); note(62, t + .08, .3, .08, 'sine'); break;
    case 'pamphleteer':
      [77, 81, 84, 89].forEach((m, i) => note(m, t + i * .055, .16, .09)); break;
    case 'win':
      [62, 65, 69, 74, 77, 81].forEach((m, i) => note(m, t + i * .1, .5, .13, 'triangle')); break;
    case 'lose':
      [62, 58, 55, 50, 45].forEach((m, i) => note(m, t + i * .14, .45, .11, 'triangle')); break;
    case 'tap':
      note(74, t, .07, .08, 'sine'); break;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (!muted) unlock();
});
