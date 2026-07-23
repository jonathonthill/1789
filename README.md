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

```bash
# Fly.io example
fly launch --no-deploy     # accepts the Dockerfile; set internal port 3789
fly deploy
```

`PORT` is honored if the host sets it.

## How it's built

| Path | What it is |
|---|---|
| `shared/engine.js` | Pure rules engine — runs on the server (multiplayer, authoritative) and in the browser (solo). Every rule enforced: suit powers with Raid-before-Rally ordering, enemy immunity + Pamphleteer cancellation, 2–4 card same-number combos capped at 20, Sans-Culotte pairing, dynamic spade barricades, yield restrictions, exact-kill conversion, captured royals at 10/15/20, solo medals, and personal two-player Regroups. |
| `shared/theme.js` | The French Revolution naming: 12 historical enemies with 3 threat lines each, suit power names, terminology. |
| `server/index.js` | Express + Socket.IO. Salon codes, host-led lobby with 30s disconnect grace, per-player secret views, token-based seamless rejoin, rematch, 2h idle room expiry. |
| `public/` | Vanilla JS frontend. SVG-drawn cards, entrance animations with typewriter threats, guillotine defeats, stage-then-confirm play, contextual help (status strip, long-press explainers, phase-aware rules panel, first-game coach marks). |
| `test/engine.test.js` | `node:test` suite for the engine. |

### Asset maintenance

The production soundtrack is generated from the tracked 61-bar piano reduction:

```bash
python3 scripts/arrange-background-midi.py \
  "Do You Hear The People Sing - verse and chorus 61-bar loop.mid" \
  public/audio/do-you-hear-the-people-sing.mid
```

`/card-check.html` and `/guillotine-lab.html` are local visual-QA tools. They are
kept in the repository for card and animation tuning, but excluded from the
production Docker image.

### Theme glossary

Tavern deck → **Le Peuple** · Discard → **La Prison** · Castle deck → **The Ancien Régime**
· Jester → **The Pamphleteer** · Animal Companion → **Sans-Culotte** · Yield → **Lay Low**
· ♥ Rally Le Peuple · ♦ Raid La Prison · ♣ Rise en Masse · ♠ A La Barricade

Rules reference: `RegicideRulesA4.pdf` (original game by Paul Abrahams, Luke Badger,
Andy Richdale). This is a fan retheme for personal play.
