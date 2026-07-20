import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../public/js/midi.js';

test('bundled background MIDI parses into a playable score', async () => {
  const file = await readFile(new URL('../public/audio/do-you-hear-the-people-sing.mid', import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const score = parseMidi(buffer);

  assert.ok(score.notes.length > 300);
  assert.ok(score.duration > 30);
  assert.ok(score.notes.every(note => note.duration > 0));
  assert.ok(score.notes.some(note => note.channel === 9), 'percussion channel should be present');
});
