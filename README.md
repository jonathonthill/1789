# 1789

The cooperative card game **Regicide**, rethemed for the French Revolution — with period paintings for the twelve royals —
and playable in any browser. 1 player solo, or 2–4 players across devices with a 4-letter salon code.

Overthrow the twelve royals of the Ancien Régime — four Officers of the Crown, four
Queens, four Kings — before a single citoyen falls.

## Quick start

```bash
npm install
npm start          # → http://localhost:3789
```

### Play on your local network (phones, tablets)

1. Start the server on your computer (`npm start`).
2. Find your machine's local IP (`ipconfig getifaddr en0` on macOS).
3. Everyone on the same Wi-Fi opens `http://<that-ip>:3789`.
4. One player taps **Form a Salon** and shares the 4-letter code; the others **Join**.

### Run the tests

```bash
npm test           # engine unit tests covering the rulebook edge cases
```

## Deploying to the internet

The app is a single Node process (Express + Socket.IO, in-memory rooms — no database).
Any host that runs a Dockerfile or a Node server works. Two notes:

- **WebSockets** must be supported (Fly.io, Railway, Render all fine).
- **One instance only** — rooms live in process memory, so don't scale horizontally.
  Free tiers that sleep on idle will drop in-progress games when they sleep.
- **Redeploys are picked up automatically.** The server fingerprints `public/` and
  `shared/` at boot and stamps that build into `index.html` (served `no-store`);
  code assets revalidate on every request and media caches for an hour. An open
  tab re-checks `/version` on load, on socket reconnect, and whenever it returns
  to the foreground, then reloads itself — or offers a reload banner if a solo
  game is in progress. This is what stops mobile Safari sitting on an old build.

```bash
# Fly.io example
fly launch --no-deploy     # accepts the Dockerfile; set internal port 3789
fly deploy
```

`PORT` is honored if the host sets it.

Solo games are saved locally after every action. Closing or leaving the game
adds a **Continue solo revolution** action on the home screen, and refreshing
the same tab resumes automatically. A finished or surrendered game clears its
save. The saved random-state cursor keeps future shuffles identical after a
resume.

## Real-game outcome data

Every completed game is recorded as one anonymous JSON line in
`data/game-outcomes.jsonl`. Records include the result, table size, duration,
actions, royals defeated, resources used, remaining card counts, and the exact
Constitution. They do **not** include player names, room codes, IP addresses,
hands, or the play-by-play log.

The unlinked owner dashboard at `/stats` shows live totals, win rate, average
duration and progress, breakdowns by solo/multiplayer, player count, difficulty
and loss type, plus the 100 most recent games. It can also download every record
as CSV for Google Sheets. The page is absent from the game's navigation and
marked `noindex`; open its address directly when needed. Its records are
anonymous, but the URL itself is not an access-control boundary. Solo outcomes
are held in the browser while offline and retried later; the server
de-duplicates every game id.

Set `OUTCOME_LOG_PATH` to choose another location:

```bash
OUTCOME_LOG_PATH=/var/lib/1789/game-outcomes.jsonl npm start
```

On a hosted deployment, point that path at a persistent disk or volume. Without
one, a redeploy may erase the collected file along with the application image.

## How it's built

| Path | What it is |
|---|---|
| `shared/rules.js` | The rule register — every house rule the engine can obey, its legal values, its default per table size, and whether La Constitution currently offers it. A rule is carried here permanently and exposed with a single `exposed: true`. |
| `shared/engine.js` | Pure rules engine — runs on the server (multiplayer, authoritative) and in the browser (solo). Every rule enforced: tiered hand limits and rewards, suit powers with Raid-before-Rally ordering, shared zero-damage Pamphleteers breaking immunity by vote, Les Renforts combining powers, 2–4 card same-number combos capped at 20, dynamic spade barricades, Lay Low rationed to once per citoyen per tier, exact kills won over into the slayer's hand, captured royals at 10/15/20, a shared Regroup pool, and the house rules of La Constitution. |
| `shared/theme.js` | The French Revolution naming: 12 historical enemies with 3 threat lines each, suit power names, terminology. |
| `server/index.js` | Express + Socket.IO. Salon codes, host-led lobby with 30s disconnect grace, per-player secret views, token-based seamless rejoin, rematch, 2h idle room expiry. |
| `server/outcomes.js` | Anonymous, append-only outcome logging for completed solo and multiplayer games, with duplicate protection and aggregate reporting. |
| `public/` | Vanilla JS frontend. SVG-drawn cards, entrance animations with typewriter threats, guillotine defeats, stage-then-confirm play, contextual help (status strip, long-press explainers, phase-aware rules panel, first-game coach marks). |
| `scripts/sim/` | The balance study: simulated citoyens who play whole games through the real engine, and the sweep that measures a ruleset's win rate. See below. |
| `test/engine.test.js` | `node:test` suite for the engine. |
| `test/sim.test.js` | Checks the simulation's model of the rules against the engine itself. |

### Tuning the difficulty (currently paused)

`scripts/sim/` plays complete games through the real engine to measure how often
a table of good players wins under a given ruleset. The simulated citoyens hold
hidden hands — no bot ever sees another's cards. They see what the app makes
public, plus the coarse remarks a real table makes out loud ("I can't defend",
"I got this", "please kill the royal"), and they only speak when it matters.

```bash
node scripts/sim/tune.js    --games 1500 --passes 3      # fit the reference bot
node scripts/sim/sweep.js   --games 3000 --weights results/weights.json
node scripts/sim/analyze.js candidates                   # narrow to the live region
node scripts/sim/sweep.js   --games 30000 --cells results/candidates.json --out results/refined.json
node scripts/sim/report.js                               # writes scripts/sim/RESULTS.md
```

Retargeting does not need a new sweep — every ruleset in the grid has already
been measured, so a different question is a different `--band`:

```bash
node scripts/sim/report.js --band 0.45-0.55 --free pamphleteers --out RESULTS-50.md
```

`--free` names dials allowed to zigzag with table size rather than stepping one
way only; near a 50% target that constraint, not the win rates, is what rules
most of the grid out. Findings live in `scripts/sim/RESULTS.md` (30–40% target)
and `RESULTS-50.md` (50%). Every ruleset plays the same decks, so differences
between rows are the rules and not the shuffle.

The live Constitution currently uses the Medium ladder and does not expose the
difficulty slider. The slider remains in the rule register for a later revisit.

### Asset maintenance

The production soundtrack is generated from the tracked 61-bar piano reduction:

```bash
python3 scripts/arrange-background-midi.py \
  "Do You Hear The People Sing - verse and chorus 61-bar loop.mid" \
  public/audio/do-you-hear-the-people-sing.mid
```

`/card-check.html`, `/guillotine-lab.html`, and `/sound-lab.html` are local QA
tools (card art, guillotine animation timing, and sound-effect/video loudness
respectively). They are kept in the repository for tuning, but excluded from
the production Docker image.

### Theme glossary

Tavern deck → **Le Peuple** · Discard → **La Prison** · Castle deck → **The Ancien Régime**
· Jester → **The Pamphleteer** · Animal Companion → **Les Renforts** · Yield → **Lay Low**

**Les Renforts** are the 1-value Helper Cards marked **A**. Every table has two
Pamphleteers. They sit beside the table as shared, single-use resources: they
deal zero damage and
break immunity without spending the active citoyen's turn; multiplayer use
requires a majority vote.

Hand limits rise through Officers / Queens / Kings: **5/6/7** with one or two
citoyens, and **4/5/6** with three or four. At four players, every royal has 5
additional endurance.
Solo draws two Spoils per royal. Every citoyen also draws one tier Spoil upon
entering Queens and Kings; for multiplayer tables, which draw no per-royal
Spoils, this is the tier's only reward. Lay Low refreshes
at Queens and Kings. Every table holds one Regroup, handed back on entering
Queens and Kings if it was spent — it refreshes rather than accumulates, so
there is one to spend per tier and nothing to bank. At multiplayer tables it is
shared and requires a majority vote.
· ♥ Rally Le Peuple · ♦ Raid La Prison · ♣ Rise en Masse · ♠ A La Barricade

Rules reference: `RegicideRulesA4.pdf` (original game by Paul Abrahams, Luke Badger,
Andy Richdale). This is a fan retheme for personal play.
