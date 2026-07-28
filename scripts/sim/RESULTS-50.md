# 1789 — balance study

_Generated 2026-07-27 from 2016 rulesets swept at 3,000 games each, 163 refined at 30,000._

## What was measured

The goal was a ruleset a table of good players carries **45.0%–55.0%** of the time, as
consistent as possible across table sizes, with any per-size change a simple
directional step. Tables of three and four are allowed to sit a little above
that — up to 60.0% — because they are the ones most likely to mix skill
levels, and a mixed table wins far less often than a uniformly good one (see
the skill section below for how much less).

The reference "good table" plays hidden hands — no bot ever sees another's
cards. What it does see is what the app already makes public (hand counts, La
Prison, the royal, who has lain low) plus the coarse remarks a real table makes
out loud: *I can't defend*, *I need to lie low*, *I got this*, *I can kill it*,
*I can take it clean*, *please kill the royal*. Those are only spoken when they
matter — trouble, or a hand that can settle the fight — so the mundane middle
stays unsaid. Its judgement weights were tuned by coordinate descent rather than
hand-guessed; Regroups it hoards, spending them mostly when the alternative is
losing on the spot.

Every ruleset played the same decks (common random numbers), so differences
between rows are the rules, not the shuffle.

## Where the current defaults sit

| Table | Win rate today |
|---|---|
| 1p | 50.4% |
| 2p | 94.0% |
| 3p | 95.0% |
| 4p | 99.2% |

The game as it currently ships is comfortably easier than the target at every
table with more than one citoyen. Two house rules do most of that work: an exact
kill claimed into the slayer's hand (the bots land several a game, and each is a
10-, 15- or 20-value card arriving free) and Lay Low as a free duck once per
citoyen per royal, which at four players cancels a large share of all the damage
the royals ever deal.

## What the dials can reach

| Table | Hardest ruleset | Easiest ruleset |
|---|---|---|
| 1p | 0.0% | 100.0% |
| 2p | 0.6% | 99.9% |
| 3p | 1.8% | 100.0% |
| 4p | 17.4% | 100.0% |

The target band is comfortably inside the reachable range at every table size.

## Recommended ruleset

Fixed for every table:

- **Exact kill**: to hand
- **Spoils of Victory**: 1
- **Pamphleteer protection**: exposed

Stepping with the number of citoyens:

| Table | Hand size | Regroups | Pamphleteers | Win rate |
|---|---|---|---|---|
| 1p | 9 (+1) | 1 | 2 | **52.7%** |
| 2p | 7 (0) | 0 | 3 | **53.8%** |
| 3p | 5 (-1) | 0 | 1 | **50.8%** |
| 4p | 5 (-1) | 0 | 3 | **51.5%** |

Spread across table sizes: **3.0 points**. 2 rulesets in the grid satisfy the band and the monotonicity rule; this is the tightest.

## How each rule behaves

These are main effects: each figure averages every ruleset in the grid that
sets that dial that way. It shows the direction and rough size of a lever, not
what it is worth at one particular setting — for that see the next section.


**Hand size** — mean win rate over every ruleset setting it this way:

| Table | -1 | 0 | +1 | swing |
|---|---|---|---|---|
| 1p | 15.2% | 36.8% | 56.7% | 41.5 pts |
| 2p | 68.1% | 85.1% | 93.3% | 25.2 pts |
| 3p | 74.0% | 92.0% | 97.7% | 23.8 pts |
| 4p | 86.7% | 96.7% | 99.1% | 12.4 pts |

**Regroups** — mean win rate over every ruleset setting it this way:

| Table | 0 | 1 | 2 | 3 | swing |
|---|---|---|---|---|---|
| 1p | 6.5% | 23.4% | 47.0% | 67.9% | 61.4 pts |
| 2p | 58.5% | 83.1% | 92.3% | 94.7% | 36.2 pts |
| 3p | 70.7% | 89.6% | 95.0% | 96.3% | 25.5 pts |
| 4p | 83.1% | 96.4% | 98.5% | 98.7% | 15.6 pts |

**Pamphleteers** — mean win rate over every ruleset setting it this way:

| Table | 0 | 1 | 2 | 3 | swing |
|---|---|---|---|---|---|
| 1p | 42.4% | 38.9% | 35.3% | 31.3% | 11.1 pts |
| 2p | 85.6% | 84.1% | 81.9% | 78.8% | 6.8 pts |
| 3p | 90.6% | 89.4% | 87.7% | 85.2% | 5.4 pts |
| 4p | 95.5% | 95.0% | 94.1% | 92.8% | 2.7 pts |

**Exact kill** — mean win rate over every ruleset setting it this way:

| Table | to hand | Le Peuple | swing |
|---|---|---|---|
| 1p | 44.4% | 28.0% | 16.4 pts |
| 2p | 86.0% | 78.3% | 7.7 pts |
| 3p | 89.7% | 86.1% | 3.6 pts |
| 4p | 94.8% | 93.5% | 1.3 pts |

**Spoils of Victory** — mean win rate over every ruleset setting it this way:

| Table | 0 | 1 | 2 | swing |
|---|---|---|---|---|
| 1p | 22.1% | 37.1% | 49.4% | 27.2 pts |
| 2p | 67.6% | 85.7% | 93.2% | 25.6 pts |
| 3p | 78.1% | 90.9% | 94.7% | 16.6 pts |
| 4p | 90.0% | 95.6% | 97.0% | 7.0 pts |

**Pamphleteer protection** — mean win rate over every ruleset setting it this way:

| Table | exposed | shielded | swing |
|---|---|---|---|
| 1p | 31.3% | 39.9% | 8.5 pts |
| 2p | 79.3% | 84.3% | 5.0 pts |
| 3p | 85.3% | 89.8% | 4.5 pts |
| 4p | 92.6% | 95.3% | 2.7 pts |

## Sensitivity around the recommendation

From the recommended ruleset, moving one dial and leaving everything else
alone. Read off the coarse sweep, so these carry roughly ±1.7 points — enough to
size a lever, not to separate two settings a point apart:

| Dial | Change | 1p | 2p | 3p | 4p |
|---|---|---|---|---|---|
| Hand size | → -1 | 3.5% (−48.7) | 17.4% (−37.2) | — | — |
| Hand size | → 0 | 20.1% (−32.2) | — | 89.4% (+38.5) | 86.5% (+35.1) |
| Hand size | → +1 | — | 81.9% (+27.3) | 97.7% (+46.7) | 96.8% (+45.5) |
| Regroups | → 0 | 12.5% (−39.8) | — | — | — |
| Regroups | → 2 | 85.3% (+33.0) | 97.6% (+43.0) | 93.5% (+42.5) | 95.5% (+44.1) |
| Regroups | → 3 | 97.6% (+45.3) | 97.9% (+43.3) | 94.2% (+43.3) | 96.3% (+44.9) |
| Regroups | → 1 | — | 92.0% (+37.4) | 86.6% (+35.7) | 87.9% (+36.5) |
| Pamphleteers | → 1 | 65.7% (+13.4) | 76.5% (+21.9) | — | 73.1% (+21.7) |
| Pamphleteers | → 3 | 39.5% (−12.8) | — | 23.2% (−27.7) | — |
| Pamphleteers | → 2 | — | 67.1% (+12.5) | 37.0% (−13.9) | 62.0% (+10.6) |
| Exact kill | → Le Peuple | 23.4% (−28.9) | 38.7% (−15.9) | 44.2% (−6.7) | 47.9% (−3.5) |
| Spoils of Victory | → 0 | 30.0% (−22.3) | 23.9% (−30.7) | 20.3% (−30.6) | 26.8% (−24.6) |
| Spoils of Victory | → 2 | 70.6% (+18.3) | 76.2% (+21.6) | 69.8% (+18.9) | 61.9% (+10.5) |
| Pamphleteer protection | → shielded | 68.1% (+15.8) | 78.1% (+23.5) | 60.6% (+9.7) | 75.9% (+24.6) |

## The dials are coarser than the band

This is the most important thing the sweep turned up, and it limits how much
any recommendation is worth.

A Regroup, as this game now plays it, resets the deck for the whole table: every
hand and all of La Prison shuffled back into Le Peuple and dealt out afresh. That
is close to a second game, and it shows up in the numbers as a cliff rather than
a slope. At the recommended settings, granting a single extra Regroup moves the
win rate by **45 points** at 1 players — from 52.7% to 97.6%.

The band is ten points wide. A dial whose smallest step is forty cannot be
tuned into it; it can only be switched off. That is exactly what the
recommendation does — Regroups at zero for every table above solo — and it is
why the ruleset below has no safety valve at all at two, three and four players.
A table dealt a bad opening simply loses.

If you want a genuinely tunable game rather than one balanced on a switch, the
lever to change is not in this grid: make a Regroup weaker so that it becomes a
dial again. Returning only La Prison to Le Peuple, or only the calling citoyen's
hand, would each be a fraction of the current effect and would give the sweep
something it can actually adjust. That is a rules change rather than a settings
change, so it was outside this study — but it is the change I would make first.


## How the bots actually played it

Under the recommended ruleset:

| Table | Exact kills / game | Lay Lows / game | Blows paid | Regroups spent | Spent as last resort |
|---|---|---|---|---|---|
| 1p | 6.7 | 0.0 | 9.6 | 0.90 | 100% |
| 2p | 6.2 | 1.7 | 13.0 | 0.00 | — (none granted) |
| 3p | 5.3 | 3.5 | 15.3 | 0.00 | — (none granted) |
| 4p | 5.4 | 4.2 | 16.6 | 0.00 | — (none granted) |

The "last resort" column is the sanity check on hoarding: the share of Regroups
spent when no other action on the table avoided losing on the spot.


## How much the answer depends on skill

The band is defined relative to the reference table. A quiet table hears no
remarks at all and takes the biggest safe swing. The mixed columns — one weaker
citoyen seated among good ones, and an evenly split table — are what most real
tables of three or four actually are.

Mixed tables are the widest source of uncertainty in the study, and they dwarf
every rule dial: seating one weaker player costs more win rate than any single
change in the grid. Real players will also land below the reference outright,
which never misreads a signal and never forgets a card it has seen.

Two columns need reading with care. The **deeper-thinking variant** is not a
stronger player: it searches further but its judgement weights were fitted to the
reference policy, so the extra machinery is untuned and it plays slightly worse.
Read it as "a different good player", not as a ceiling — the reference is
already at the practical limit of this bot design. The **never ducking** column
holds the rules constant and simply forbids Lay Low except on an empty hand,
which is how much that one house rule is worth.

| Table | Quiet table | Good table | Deeper-thinking variant | One weaker seat | Half the table weaker | Good, never ducking |
|---|---|---|---|---|---|---|
| 1p | 1.4% | **52.8%** | 55.7% | — | — | — |
| 2p | 1.6% | **54.1%** | 47.8% | 14.1% | 14.1% | 29.9% |
| 3p | 1.4% | **50.8%** | 46.6% | 22.8% | 7.0% | 15.0% |
| 4p | 3.8% | **51.6%** | 47.9% | 33.5% | 19.2% | 12.1% |

## Alternatives

| # | Exact kill | Spoils | Pamphleteer | Hand (1/2/3/4) | Regroups | Pamphleteers | Win rates | Spread |
|---|---|---|---|---|---|---|---|---|
| 1 ★ | to hand | 1 | exposed | 9/7/5/5 | 1/0/0/0 | 2/3/1/3 | 53/54/51/51 | 3.0 |
| 2 | Le Peuple | 0 | exposed | 9/6/5/5 | 3/2/2/1 | 3/2/3/3 | 48/48/55/60 | 11.4 |

## Combinations that cannot reach the band

| Fixed rules | Table sizes that miss | Closest it gets |
|---|---|---|
| exactKillTo=hand drawOnVictory=2 pamphleteerImmune=true | 2, 3, 4 | 1p 50.6% |
| exactKillTo=peuple drawOnVictory=0 pamphleteerImmune=true | 1, 4 | 1p 39.9%, 2p 49.8%, 3p 51.4%, 4p 42.5% |
| exactKillTo=hand drawOnVictory=0 pamphleteerImmune=true | 3 | 1p 50.0%, 2p 49.1%, 3p 61.3%, 4p 48.9% |
| exactKillTo=hand drawOnVictory=1 pamphleteerImmune=true | 4 | 1p 53.2%, 2p 50.5%, 3p 56.8% |
| exactKillTo=peuple drawOnVictory=2 pamphleteerImmune=true | 2, 3, 4 | 1p 49.9%, 2p 59.0% |
| exactKillTo=peuple drawOnVictory=1 pamphleteerImmune=true | 2, 4 | 1p 48.2%, 2p 63.5%, 3p 48.1% |
| exactKillTo=peuple drawOnVictory=2 pamphleteerImmune=false | 4 | 1p 50.3%, 2p 54.7%, 3p 50.8%, 4p 60.4% |
| exactKillTo=hand drawOnVictory=0 pamphleteerImmune=false | 1 | 1p 56.4%, 2p 51.2%, 3p 50.4%, 4p 46.0% |
| exactKillTo=hand drawOnVictory=2 pamphleteerImmune=false | 4 | 1p 48.2%, 2p 52.3%, 3p 56.0%, 4p 63.6% |
| exactKillTo=peuple drawOnVictory=1 pamphleteerImmune=false | 3 | 1p 50.4%, 2p 52.1%, 3p 43.4%, 4p 47.6% |

## Caveats

- The band is relative to the reference bot. There is no measurement of your
  own table to anchor it against, so treat the skill spread above as the real
  uncertainty on any single number.
- The signal channel is noise-free: bots never misread "I can't defend" and never
  say it when it is untrue. Human tables are worse at this, which pushes real win
  rates down.
- Bots hunt exact kills exhaustively. A human sees most of these, not all — so
  rulesets that lean on exact-kill behaviour will play slightly harder in life
  than they do here.
- Everything outside the six swept rules is frozen at what the game ships today.
