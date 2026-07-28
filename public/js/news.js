// What changed since a citoyen last played.
//
// Shown once on the home screen, before they choose a game. Bump VERSION when
// the rules move again and everyone sees the notice one more time; leave it
// alone for anything that is not a rules change, or the notice cries wolf.

export const VERSION = 3;
const STORE_KEY = 'r1789_rules_seen';

// Written out rather than derived: this is the story of what changed, which is
// not something the rule register knows. Keep it short — a citoyen reads this
// standing up.
const ITEMS = [
  {
    title: 'A Regroup no longer costs the table its hands',
    body: `At a table, a Regroup now deals every citoyen a few cards from Le Peuple —
      nobody gives up a hand they were holding for a reason. Alone it is still a
      fresh start: your hand goes back, the deck is shuffled, and you draw again.`,
  },
  {
    title: 'The Pamphleteer stands alone',
    body: `He shatters a royal's immunity, takes its reprisal, and names who acts
      next. He may no longer bring a companion.`,
  },
  {
    title: 'Spoils of Victory',
    body: `Every fallen royal now leaves the streets richer: each citoyen draws a card,
      never past their hand limit.`,
  },
  {
    title: 'A table-size ladder',
    body: `Hands are 8 alone, 6 at two, and 5 at three or four. Four citoyens face
      three Pamphleteers; every other table faces two.`,
  },
  {
    title: 'The Revolution now opens with its rules',
    body: `Before the first animation, every table sees the exact rules for its number
      of citoyens. The difficulty slider is resting for now while we gather table
      results.`,
  },
];

export function shouldShow() {
  try {
    return Number(localStorage.getItem(STORE_KEY)) !== VERSION;
  } catch { return false; } // no storage, no nagging
}

export function markSeen() {
  try { localStorage.setItem(STORE_KEY, String(VERSION)); } catch { /* nothing to do */ }
}

export function render() {
  return ITEMS.map(i => `
    <div class="news-item">
      <h3>${i.title}</h3>
      <p>${i.body}</p>
    </div>`).join('')
    + `<p class="news-foot">These are the défaut. The host may change them in La Constitution before any game.</p>`;
}
