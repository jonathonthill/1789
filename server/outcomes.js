import fs from 'node:fs';
import path from 'node:path';
import { RULE_KEYS } from '../shared/rules.js';

export const OUTCOME_SCHEMA_VERSION = 1;

function finiteInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function lossKind(reason = '') {
  const text = String(reason).toLowerCase();
  if (text.includes('surrender')) return 'surrender';
  if (text.includes('no cards')) return 'no_cards';
  if (text.includes('withstand') || text.includes('damage')) return 'damage';
  return 'other';
}

export function outcomeFromState({ gameId, mode, startedAt, state }) {
  if (!state || (state.phase !== 'won' && state.phase !== 'lost')) {
    throw new Error('Only completed games can be logged.');
  }
  const started = new Date(startedAt);
  const durationSeconds = Number.isNaN(started.getTime())
    ? 0
    : Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
  const royalsDefeated = state.phase === 'won'
    ? 12
    : Math.max(0, 12 - state.castle.length - (state.enemy ? 1 : 0));

  return {
    gameId,
    mode,
    outcome: state.phase === 'won' ? 'win' : 'loss',
    lossKind: state.phase === 'lost' ? lossKind(state.result?.reason) : null,
    playerCount: state.playerCount,
    durationSeconds,
    actionCount: state.actionSeq,
    royalsDefeated,
    tierReached: state.phase === 'won' ? 'K' : (state.enemy?.card?.r ?? null),
    regroupsUsed: state.regroupsUsed,
    pamphleteersUsed: state.pamphleteersUsed,
    cardsRemaining: {
      peuple: state.tavern.length,
      prison: state.discard.length,
      hands: state.players.reduce((total, player) => total + player.hand.length, 0),
    },
    rules: state.rules,
  };
}

function sanitizeRecord(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid outcome.');
  const gameId = String(input.gameId ?? '').trim();
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(gameId)) throw new Error('Invalid game id.');
  const mode = input.mode === 'solo' ? 'solo' : input.mode === 'multiplayer' ? 'multiplayer' : null;
  if (!mode) throw new Error('Invalid game mode.');
  const outcome = input.outcome === 'win' ? 'win' : input.outcome === 'loss' ? 'loss' : null;
  if (!outcome) throw new Error('Invalid result.');
  const cards = input.cardsRemaining && typeof input.cardsRemaining === 'object' ? input.cardsRemaining : {};
  const rules = input.rules && typeof input.rules === 'object' && !Array.isArray(input.rules)
    ? Object.fromEntries(Object.entries(input.rules).filter(([key, value]) => (
      RULE_KEYS.includes(key) && (value == null || ['string', 'number', 'boolean'].includes(typeof value))
    )))
    : {};

  return {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    gameId,
    recordedAt: new Date().toISOString(),
    mode,
    outcome,
    lossKind: outcome === 'loss' && ['surrender', 'no_cards', 'damage', 'other'].includes(input.lossKind)
      ? input.lossKind
      : null,
    playerCount: finiteInteger(input.playerCount, { min: 1, max: 4 }),
    durationSeconds: finiteInteger(input.durationSeconds, { max: 7 * 24 * 60 * 60 }),
    actionCount: finiteInteger(input.actionCount, { max: 10000 }),
    royalsDefeated: finiteInteger(input.royalsDefeated, { max: 12 }),
    tierReached: ['J', 'Q', 'K'].includes(input.tierReached) ? input.tierReached : null,
    regroupsUsed: finiteInteger(input.regroupsUsed, { max: 100 }),
    pamphleteersUsed: finiteInteger(input.pamphleteersUsed, { max: 100 }),
    cardsRemaining: {
      peuple: finiteInteger(cards.peuple, { max: 100 }),
      prison: finiteInteger(cards.prison, { max: 100 }),
      hands: finiteInteger(cards.hands, { max: 100 }),
    },
    rules,
  };
}

export function summarizeOutcomes(records) {
  const completed = records.filter(record => record?.outcome === 'win' || record?.outcome === 'loss');
  const wins = completed.filter(record => record.outcome === 'win').length;
  const group = getValue => Object.fromEntries([...new Set(completed.map(record => String(getValue(record))))].sort().map(value => {
    const rows = completed.filter(record => String(getValue(record)) === value);
    const rowWins = rows.filter(record => record.outcome === 'win').length;
    return [value, { games: rows.length, wins: rowWins, winRate: rows.length ? rowWins / rows.length : 0 }];
  }));
  const average = key => completed.length
    ? completed.reduce((total, record) => total + finiteInteger(record[key]), 0) / completed.length
    : 0;

  return {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    games: completed.length,
    wins,
    losses: completed.length - wins,
    winRate: completed.length ? wins / completed.length : 0,
    averageDurationSeconds: average('durationSeconds'),
    averageRoyalsDefeated: average('royalsDefeated'),
    byMode: group(record => record.mode),
    byPlayerCount: group(record => record.playerCount),
    byDifficulty: group(record => record.rules?.difficulty ?? 'unknown'),
    lossesByKind: completed.filter(record => record.outcome === 'loss').reduce((counts, record) => {
      const kind = record.lossKind ?? 'other';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function outcomesToCsv(records) {
  const columns = [
    ['recordedAt', record => record.recordedAt],
    ['gameId', record => record.gameId],
    ['mode', record => record.mode],
    ['outcome', record => record.outcome],
    ['lossKind', record => record.lossKind],
    ['playerCount', record => record.playerCount],
    ['durationSeconds', record => record.durationSeconds],
    ['actionCount', record => record.actionCount],
    ['royalsDefeated', record => record.royalsDefeated],
    ['tierReached', record => record.tierReached],
    ['regroupsUsed', record => record.regroupsUsed],
    ['pamphleteersUsed', record => record.pamphleteersUsed],
    ['peupleRemaining', record => record.cardsRemaining?.peuple],
    ['prisonRemaining', record => record.cardsRemaining?.prison],
    ['handsRemaining', record => record.cardsRemaining?.hands],
    ['difficulty', record => record.rules?.difficulty],
    ['rules', record => JSON.stringify(record.rules ?? {})],
  ];
  const lines = [columns.map(([name]) => csvCell(name)).join(',')];
  for (const record of records) {
    lines.push(columns.map(([, read]) => csvCell(read(record))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function createOutcomeStore(filePath) {
  let loaded = false;
  let records = [];
  let gameIds = new Set();

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      records = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    gameIds = new Set(records.map(record => record.gameId).filter(Boolean));
  }

  return {
    record(input) {
      load();
      const record = sanitizeRecord(input);
      if (gameIds.has(record.gameId)) return { recorded: false, duplicate: true };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      records.push(record);
      gameIds.add(record.gameId);
      return { recorded: true, duplicate: false, record };
    },
    summary() {
      load();
      return summarizeOutcomes(records);
    },
    list(limit = 100) {
      load();
      const count = finiteInteger(limit, { min: 1, max: 10000 });
      return records.slice(-count).reverse().map(record => JSON.parse(JSON.stringify(record)));
    },
    csv() {
      load();
      return outcomesToCsv(records);
    },
  };
}
