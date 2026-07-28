// Compare royal-power difficulty stops after the exact-kill spoil correction.
//
//   node scripts/sim/strike-study.js --games 10000

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep } from './sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = { games: 10000 };
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
}

const bonuses = [-6, -4, -2, 0, 2, 4, 6];
const cells = [];
for (const tier of ['average', 'good']) {
  for (let players = 1; players <= 4; players++) {
    for (const royalStrikeBonus of bonuses) {
      cells.push({ players, tier, royalStrikeBonus, rules: { royalStrikeBonus } });
    }
  }
}

const weights = JSON.parse(readFileSync(resolve(HERE, 'results/weights.json'), 'utf8'));
const results = await sweep({ cells, games: args.games, weights });

for (const tier of ['average', 'good']) {
  console.log(`\n${tier}`);
  console.log('bonus\t1p\t2p\t3p\t4p');
  for (const bonus of bonuses) {
    const row = [1, 2, 3, 4].map(players => {
      const hit = results.find(r => r.tier === tier && r.players === players && r.royalStrikeBonus === bonus);
      return `${(100 * hit.winRate).toFixed(1)}%`;
    });
    console.log(`${bonus}\t${row.join('\t')}`);
  }
}
