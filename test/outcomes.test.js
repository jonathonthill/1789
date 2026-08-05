import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutcomeStore, outcomeFromState, summarizeOutcomes } from '../server/outcomes.js';
import { newGame, surrenderGame } from '../shared/engine.js';

test('outcomeFromState produces an anonymous completed-game record', () => {
  const state = newGame(['A name that must not be stored'], { seed: 7 });
  surrenderGame(state, 0);
  const outcome = outcomeFromState({
    gameId: '12345678-1234-4123-8123-123456789012',
    mode: 'solo',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    state,
  });

  assert.equal(outcome.outcome, 'loss');
  assert.equal(outcome.lossKind, 'surrender');
  assert.equal(outcome.playerCount, 1);
  assert.ok(outcome.durationSeconds >= 4);
  assert.doesNotMatch(JSON.stringify(outcome), /A name that must not be stored/);
});

test('outcome store appends JSONL and ignores a duplicate game id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r1789-outcomes-'));
  const file = path.join(dir, 'outcomes.jsonl');
  const store = createOutcomeStore(file);
  const record = {
    gameId: '12345678-1234-4123-8123-123456789012', mode: 'solo', outcome: 'win',
    playerCount: 1, durationSeconds: 60, actionCount: 20, royalsDefeated: 12,
    tierReached: 'K', regroupsUsed: 1, pamphleteersUsed: 1,
    cardsRemaining: { peuple: 3, prison: 30, hands: 7 },
    rules: { difficulty: 'medium', playerName: 'must be stripped' },
  };

  assert.equal(store.record(record).recorded, true);
  assert.equal(store.record(record).duplicate, true);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /must be stripped/);
  assert.equal(store.summary().games, 1);
  assert.equal(store.summary().winRate, 1);
});

test('summary groups real games by mode and player count', () => {
  const summary = summarizeOutcomes([
    { outcome: 'win', mode: 'solo', playerCount: 1, durationSeconds: 100, royalsDefeated: 12, rules: { difficulty: 'easy' } },
    { outcome: 'loss', lossKind: 'damage', mode: 'multiplayer', playerCount: 3, durationSeconds: 50, royalsDefeated: 4, rules: { difficulty: 'hard' } },
  ]);
  assert.equal(summary.games, 2);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.averageRoyalsDefeated, 8);
  assert.deepEqual(summary.byPlayerCount['3'], { games: 1, wins: 0, winRate: 0 });
  assert.deepEqual(summary.byDifficulty.easy, { games: 1, wins: 1, winRate: 1 });
  assert.deepEqual(summary.lossesByKind, { damage: 1 });
});
