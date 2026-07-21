import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../public/js/midi.js';

test('bundled background MIDI parses into a playable score', async () => {
  const file = await readFile(new URL('../public/audio/do-you-hear-the-people-sing.mid', import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const score = parseMidi(buffer);

  assert.ok(score.notes.length > 1200);
  assert.ok(Math.abs(score.duration - 116.19036) < 0.001, 'the 61-bar loop duration should be preserved');
  assert.ok(score.notes.every(note => note.duration > 0));
  assert.ok(score.notes.some(note => note.channel === 9), 'percussion channel should be present');

  const programs = new Set(score.notes.map(note => note.program));
  for (const [program, instrument] of [
    [0, 'piano'], [42, 'cello'], [43, 'contrabass'], [47, 'timpani'],
    [48, 'strings'], [56, 'trumpet'], [60, 'French horn'], [68, 'oboe'],
  ]) {
    assert.ok(programs.has(program), `${instrument} program should be present`);
  }
});
