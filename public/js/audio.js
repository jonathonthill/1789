// MIDI-backed music and procedural sound effects for 1789. Everything is
// synthesized with the Web Audio API so the game works offline on the local LAN.

import { parseMidi } from '/js/midi.js';

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

const MIDI_URL = '/audio/do-you-hear-the-people-sing.mid';
const SAMPLE_URLS = {
  attack: '/audio/sword-clash.wav',
  guillotine: '/audio/guillotine-swish.wav',
};

let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let noiseBuffer = null;
let scheduler = null;
let desiredScene = 'intro';
let activeScene = null;
let midiScore = null;
let midiLoad = null;
let midiEpoch = 0;
let midiEventIndex = 0;
let sampleBuffers = {};
let sampleLoad = null;
let muted = (() => {
  try { return localStorage.getItem('r1789_audio_muted') === 'true'; } catch { return false; }
})();

export function isSupported() { return !!AudioContextClass; }
export function isMuted() { return muted; }

// User-set volumes (0..1) layered on top of the per-scene music level and the
// effects bus. Persisted so a player's mix survives reloads.
const SFX_BASE = 0.52;
// The slider fraction (0..1) is scaled down so the 50% default sits at a gentle
// level: 0.5 * VOL_SCALE lands where the raw 20% setting used to, and 100% only
// reaches 40% of the bus base. (Keys are versioned so the old raw fractions in
// a returning player's storage aren't reinterpreted under the new scale.)
const VOL_SCALE = 0.4;
const clamp01 = v => Math.max(0, Math.min(1, Number(v)));
function loadVol(key, dflt) {
  try { const v = parseFloat(localStorage.getItem(key)); return Number.isFinite(v) ? clamp01(v) : dflt; }
  catch { return dflt; }
}
function persistVol(key, v) { try { localStorage.setItem(key, String(v)); } catch {} }
let musicVol = loadVol('r1789_music_vol_v2', 0.5);
let sfxVol = loadVol('r1789_sfx_vol_v2', 0.5);
function musicSceneGain() { return (desiredScene === 'intro' ? 0.46 : 0.38) * musicVol * VOL_SCALE; }
function applyMusicGain(smooth = 0.18) {
  if (ctx && musicBus && !muted && desiredScene) musicBus.gain.setTargetAtTime(musicSceneGain(), ctx.currentTime, smooth);
}
export function getMusicVolume() { return musicVol; }
export function getSfxVolume() { return sfxVol; }
export function setMusicVolume(v) { musicVol = clamp01(v); persistVol('r1789_music_vol_v2', musicVol); applyMusicGain(0.04); }
export function setSfxVolume(v) { sfxVol = clamp01(v); persistVol('r1789_sfx_vol_v2', sfxVol); if (sfxBus) sfxBus.gain.value = SFX_BASE * sfxVol * VOL_SCALE; }

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
  // The music used to sit around 10–15 dB below the effects. Keep effects crisp,
  // but give the arrangement enough level to read as an actual backing track.
  musicBus.gain.value = .42;
  sfxBus.gain.value = SFX_BASE * sfxVol * VOL_SCALE;
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
  await Promise.all([loadMidi(), loadSamples()]);
  startMusic();
  return true;
}

async function loadMidi() {
  if (midiScore) return midiScore;
  if (!midiLoad) {
    midiLoad = fetch(MIDI_URL)
      .then(res => {
        if (!res.ok) throw new Error(`MIDI request failed (${res.status})`);
        return res.arrayBuffer();
      })
      .then(parseMidi)
      .then(score => {
        if (!score.notes.length) throw new Error('MIDI contains no playable notes');
        midiScore = score;
        return score;
      })
      .catch(err => {
        console.warn('Background MIDI could not be loaded:', err);
        midiLoad = null;
        return null;
      });
  }
  return midiLoad;
}

async function loadSamples() {
  if (Object.keys(sampleBuffers).length === Object.keys(SAMPLE_URLS).length) return sampleBuffers;
  if (!sampleLoad) {
    sampleLoad = Promise.all(Object.entries(SAMPLE_URLS).map(async ([name, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${name} sample request failed (${res.status})`);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      return [name, buffer];
    }))
      .then(entries => {
        sampleBuffers = Object.fromEntries(entries);
        return sampleBuffers;
      })
      .catch(err => {
        console.warn('Sound-effect samples could not be loaded:', err);
        sampleLoad = null;
        return sampleBuffers;
      });
  }
  return sampleLoad;
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
    midiEpoch = 0;
    midiEventIndex = 0;
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, .18);
    return;
  }
  if (activeScene !== scene) {
    activeScene = scene;
  }
  applyMusicGain();
  startMusic();
}

function startMusic() {
  if (!ctx || muted || !desiredScene || !midiScore || ctx.state !== 'running') return;
  if (activeScene !== desiredScene) {
    activeScene = desiredScene;
  }
  applyMusicGain();
  if (!midiEpoch) {
    midiEpoch = ctx.currentTime + .08;
    midiEventIndex = 0;
  }
  if (!scheduler) scheduler = setInterval(scheduleMusic, 50);
  scheduleMusic();
}

function scheduleMusic() {
  if (!ctx || muted || !activeScene || !midiScore || ctx.state !== 'running') return;
  const horizon = ctx.currentTime + .25;
  // The bundled score is cut on a harmonic boundary; adding tail silence here
  // would turn a seamless musical loop into an audible pause.
  const loopLength = Math.max(1, midiScore.duration);
  let guard = 0;
  while (guard++ < 2000) {
    const event = midiScore.notes[midiEventIndex];
    const time = midiEpoch + event.time;
    if (time > horizon) break;
    if (time >= ctx.currentTime - .04) playMidiNote(event, time);
    midiEventIndex++;
    if (midiEventIndex >= midiScore.notes.length) {
      midiEventIndex = 0;
      midiEpoch += loopLength;
    }
  }
}

function playMidiNote(event, time) {
  const velocity = event.velocity / 127;
  if (event.channel === 9) {
    midiDrum(event.note, time, velocity);
    return;
  }

  const voice = midiVoice(event.program);
  note(
    event.note,
    time,
    Math.min(event.duration, 3.5),
    Math.max(.003, voice.volume * velocity),
    voice.wave,
    musicBus,
    voice,
  );
}

function midiVoice(program) {
  if (program === 47) return { wave: 'sine', volume: .055, attack: .008, release: .18, cutoff: 760 }; // timpani
  if (program === 42) return { wave: 'triangle', volume: .040, attack: .035, release: .13, cutoff: 1050 }; // cello
  if (program === 43) return { wave: 'triangle', volume: .043, attack: .04, release: .16, cutoff: 720 }; // contrabass
  if (program === 48) return { wave: 'sawtooth', volume: .019, attack: .075, release: .23, cutoff: 1350 }; // ensemble
  if (program >= 56 && program <= 59) return { wave: 'sawtooth', volume: .026, attack: .018, release: .07, cutoff: 2100 }; // trumpet
  if (program >= 60 && program <= 67) return { wave: 'triangle', volume: .036, attack: .04, release: .14, cutoff: 1250 }; // horn
  if (program >= 68 && program <= 71) return { wave: 'square', volume: .017, attack: .026, release: .08, cutoff: 1650 }; // oboe
  if (program <= 7) return { wave: 'triangle', volume: .036, attack: .007, release: .07, cutoff: 2600 }; // piano
  return { wave: 'triangle', volume: .032, attack: .018, release: .06, cutoff: 1800 };
}

function midiDrum(midi, time, velocity) {
  if (midi === 35 || midi === 36) {
    sweep(105, 46, time, .16, .050 * velocity, 'sine', musicBus);
  } else if (midi >= 37 && midi <= 40) {
    noise(time, .105, .040 * velocity, 480, 4100, musicBus);
  } else if (midi >= 49) {
    noise(time, .32, .032 * velocity, 1900, 7600, musicBus);
  } else {
    noise(time, .075, .026 * velocity, 1300, 6500, musicBus);
  }
}

function hz(midi) { return 440 * 2 ** ((midi - 69) / 12); }

function note(midi, time, duration, volume, wave = 'triangle', destination = sfxBus, envelope = {}) {
  if (!ctx || !destination) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const attack = Math.min(envelope.attack ?? .018, Math.max(.004, duration * .45));
  const release = envelope.release ?? .025;
  osc.type = wave;
  osc.frequency.setValueAtTime(hz(midi), time);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(envelope.cutoff ?? (wave === 'sine' ? 900 : 1800), time);
  filter.Q.value = .7;
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), time + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration + release);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + duration + release + .03);
}

function sweep(from, to, time, duration, volume, wave = 'sawtooth', destination = sfxBus) {
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
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + duration + .03);
}

function noise(time, duration, volume, highpass = 120, lowpass = 5000, destination = sfxBus) {
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
  source.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(destination);
  source.start(time);
  source.stop(time + duration);
}

function playSample(name, time, volume = 1, offset = 0, duration = null) {
  const buffer = sampleBuffers[name];
  if (!ctx || !buffer || !sfxBus) return false;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(sfxBus);
  const safeOffset = Math.min(offset, Math.max(0, buffer.duration - .01));
  if (duration == null) source.start(time, safeOffset);
  else source.start(time, safeOffset, Math.min(duration, buffer.duration - safeOffset));
  return true;
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
      if (!playSample('attack', t, .62)) note(86, t, .16, .13, 'triangle'); break;
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
      // The sample has 128ms of lead-in and peaks near 500ms. The tuned start
      // puts its peak near 950ms, just after the card begins to separate.
      if (!playSample('guillotine', t + .45, .5)) note(91, t + .95, .08, .1, 'triangle'); break;
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
