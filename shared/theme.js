// Régicide 1789 — theme data: the agreed naming scheme, enemies, and threats.

export const GAME_TITLE = '1789';

export const TERMS = {
  players: 'Citoyens',
  castle: 'The Ancien Régime',
  tavern: 'Le Peuple',
  discard: 'La Prison',
  jester: 'The Pamphleteer',
  companion: 'Les Renforts',
  yield: 'Lay Low',
};

export const SUIT_META = {
  H: { symbol: '♥', color: 'red',   power: 'Rally Le Peuple',    short: 'Draw',   desc: 'Recruit cards equal to the attack value from Le Peuple, starting with you, round the table, skipping full hands.' },
  D: { symbol: '♦', color: 'red',   power: 'Raid La Prison',     short: 'Return', desc: 'Free prisoners from La Prison, shuffle them, and slip cards equal to the attack value under Le Peuple — liberated citoyens rejoin the cause.' },
  C: { symbol: '♣', color: 'black', power: 'Rise en Masse',      short: '×2 dmg', desc: 'The mob doubles your blow — damage dealt counts twice.' },
  S: { symbol: '♠', color: 'black', power: 'A La Barricade',     short: 'Shield', desc: 'Reduce the enemy’s attack by the attack value played. Barricades stack and hold until the enemy falls.' },
};

// The twelve royals of the Ancien Régime. Keyed by rank+suit.
export const ENEMIES = {
  // Jacks — attack 10, health 20
  JS: {
    name: 'Marquis de Launay', title: 'Governor of the Bastille',
    threats: [
      'The Bastille has stood four hundred years. It will stand four hundred more.',
      'My cannons face the faubourg. Come closer, citoyens.',
      'Barricades? I command the walls of the Bastille itself!',
    ],
  },
  JC: {
    name: 'Baron de Besenval', title: 'Commander of the Royal Troops',
    threats: [
      'My Swiss Guards do not break. Your mob will.',
      'I have thirty thousand men around Paris. You have… enthusiasm.',
      'Rage all you like — fury is my trade, and mine is disciplined.',
    ],
  },
  JD: {
    name: 'Foullon de Doué', title: 'Controller of Finances',
    threats: [
      'If the people are hungry, let them eat hay!',
      'Raid my prisons? Every gaoler in Paris answers to me.',
      'I have taxed your bread, your salt, your windows. Next: your breath.',
    ],
  },
  JH: {
    name: 'Bertier de Sauvigny', title: 'Intendant of Paris',
    threats: [
      'The grain is locked in my storehouses. Rally whom you like — they will starve.',
      'Paris is mine to administer. You are merely… inventory.',
      'Your fallen will not rise for you. I keep excellent records of the dead.',
    ],
  },
  // Queens — attack 15, health 30
  QS: {
    name: 'Madame de Pompadour', title: 'Marquise, Power Behind the Throne',
    threats: [
      'Après nous, le déluge — and you, citoyen, will drown first.',
      'I ruled France from a drawing room. You will not take it from a gutter.',
      'Your barricades are furniture. I have rearranged better rooms than Paris.',
    ],
  },
  QC: {
    name: 'Marie de Médicis', title: 'Queen Regent, Mother of Kings',
    threats: [
      'I have crushed rebellions before your grandfathers drew breath.',
      'A mob is a beast. I have always kept beasts on golden leashes.',
      'Florence taught me poison; France taught me patience. You will meet both.',
    ],
  },
  QD: {
    name: 'Madame du Barry', title: 'Comtesse, Favourite of the King',
    threats: [
      'You would raid la Prison? Your friends look better behind bars.',
      'These diamonds cost more than your entire faubourg. Kneel.',
      'One more moment, executioner — and for you, rabble, not even that.',
    ],
  },
  QH: {
    name: 'Marie Antoinette', title: 'Queen of France',
    threats: [
      'Let them eat cake!',
      'Rally the people? The people adore me. They simply do not know it yet.',
      'I was a queen at nineteen. What were you at nineteen — hungry?',
    ],
  },
  // Kings — attack 20, health 40
  KS: {
    name: 'Louis XIII', title: 'The Just, King of France',
    threats: [
      'The Cardinal broke La Rochelle’s walls. Yours will not slow us.',
      'I razed the castles of rebellious lords. Your barricades amuse me.',
      'Order is iron. I bent France to it once; I shall bend you now.',
    ],
  },
  KC: {
    name: 'Louis XIV', title: 'The Sun King',
    threats: [
      'L’État, c’est moi. Strike France and you strike only me — and I do not fall.',
      'I outshone the world for seventy-two years. Your little fury is a candle.',
      'I built Versailles to humble kings. Imagine what I do to peasants.',
    ],
  },
  KD: {
    name: 'Louis XV', title: 'The Well-Beloved',
    threats: [
      'Après moi, le déluge. And here you are — the flood. How tedious.',
      'I filled the prisons with dissenters. You will not empty them.',
      'France survived my indifference. It will not survive my anger.',
    ],
  },
  KH: {
    name: 'Louis XVI', title: 'King of France and Navarre',
    threats: [
      'A revolt? No, sire — it is a revolution. And I shall end it.',
      'God anointed me. What did the gutter anoint you with?',
      'The people’s hearts belong to their king. Rally them — they will weep for me.',
    ],
  },
};

export function enemyMeta(card) {
  return ENEMIES[`${card.r}${card.s}`];
}

export function enemyThreat(card, variant) {
  const meta = enemyMeta(card);
  return meta.threats[variant % meta.threats.length];
}

export const RANK_TITLES = { J: 'Officer of the Crown', Q: 'Queen', K: 'King' };

export function suitPowerLine(suit) {
  const m = SUIT_META[suit];
  return `${m.symbol} ${m.power} — ${m.desc}`;
}

export const EXCLAIM = {
  win: 'Vive la République!',
  lose: 'The Revolution is crushed.',
  guillotine: 'Guillotiné!',
  converted: 'Won over to the Revolution!',
};
