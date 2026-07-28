# 1789 — balance study

_Generated 2026-07-27 from 2016 rulesets swept at 3,000 games each, 160 refined at 30,000._

## What was measured

The goal was a ruleset a table of good players carries **30.0%–40.0%** of the time, as
consistent as possible across table sizes, with any per-size change a simple
directional step. Tables of three and four are allowed to sit a little above
that — up to 45.0% — because they are the ones most likely to mix skill
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

- **Exact kill**: Le Peuple
- **Spoils of Victory**: 0
- **Pamphleteer protection**: shielded

Stepping with the number of citoyens:

| Table | Hand size | Regroups | Pamphleteers | Win rate |
|---|---|---|---|---|
| 1p | 9 (+1) | 2 | 0 | **39.9%** |
| 2p | 8 (+1) | 0 | 3 | **37.5%** |
| 3p | 6 (0) | 0 | 3 | **43.0%** |
| 4p | 5 (-1) | 0 | 3 | **37.3%** |

Spread across table sizes: **5.8 points**. 9 rulesets in the grid satisfy the band and the monotonicity rule; this is the tightest.


### If you would rather nothing exceeded 40.0%

The ruleset above leans on the allowance for larger tables — it reaches
43.0% at 3 players. This one stays inside 30.0%–40.0% at every
table size, at the cost of a wider spread (8.8 points against 5.8):

| Table | Hand size | Regroups | Pamphleteers | Win rate |
|---|---|---|---|---|
| 1p | 8 (0) | 3 | 0 | **37.6%** |
| 2p | 6 (-1) | 1 | 0 | **30.4%** |
| 3p | 5 (-1) | 1 | 3 | **39.2%** |
| 4p | 5 (-1) | 0 | 3 | **37.3%** |

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
| Hand size | → -1 | 0.8% (−40.3) | 2.2% (−35.6) | 8.9% (−33.7) | — |
| Hand size | → 0 | 10.6% (−30.5) | 15.1% (−22.7) | — | 79.4% (+42.7) |
| Hand size | → +1 | — | — | 78.5% (+36.0) | 95.2% (+58.5) |
| Regroups | → 0 | 0.7% (−40.4) | — | — | — |
| Regroups | → 1 | 8.7% (−32.4) | 80.6% (+42.8) | 83.7% (+41.1) | 80.0% (+43.3) |
| Regroups | → 3 | 77.1% (+36.0) | 91.8% (+54.0) | 92.7% (+50.2) | 95.7% (+59.0) |
| Regroups | → 2 | — | 91.5% (+53.7) | 92.2% (+49.7) | 94.3% (+57.6) |
| Pamphleteers | → 1 | 36.6% (−4.5) | 50.2% (+12.4) | 52.0% (+9.5) | 42.9% (+6.2) |
| Pamphleteers | → 2 | 32.2% (−8.9) | 44.8% (+7.0) | 47.9% (+5.4) | 40.1% (+3.4) |
| Pamphleteers | → 3 | 28.9% (−12.2) | — | — | — |
| Pamphleteers | → 0 | — | 55.1% (+17.3) | 54.3% (+11.8) | 41.3% (+4.6) |
| Exact kill | → to hand | 83.3% (+42.2) | 70.2% (+32.4) | 61.9% (+19.4) | 48.1% (+11.4) |
| Spoils of Victory | → 1 | 80.4% (+39.3) | 86.7% (+48.9) | 86.0% (+43.5) | 70.9% (+34.2) |
| Spoils of Victory | → 2 | 95.5% (+54.4) | 97.8% (+60.0) | 94.7% (+52.2) | 82.6% (+45.9) |
| Pamphleteer protection | → exposed | — | 26.5% (−11.3) | 26.1% (−16.5) | 17.4% (−19.3) |

## The dials are coarser than the band

This is the most important thing the sweep turned up, and it limits how much
any recommendation is worth.

A Regroup, as this game now plays it, resets the deck for the whole table: every
hand and all of La Prison shuffled back into Le Peuple and dealt out afresh. That
is close to a second game, and it shows up in the numbers as a cliff rather than
a slope. At the recommended settings, granting a single extra Regroup moves the
win rate by **59 points** at 4 players — from 37.3% to 95.7%.

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
| 1p | 4.0 | 0.0 | 10.3 | 1.93 | 100% |
| 2p | 3.3 | 1.3 | 9.4 | 0.00 | — (none granted) |
| 3p | 3.2 | 2.2 | 12.8 | 0.00 | — (none granted) |
| 4p | 3.1 | 3.5 | 14.3 | 0.00 | — (none granted) |

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
| 1p | 1.0% | **39.8%** | 36.6% | — | — | — |
| 2p | 0.3% | **37.8%** | 30.1% | 11.4% | 11.4% | 35.5% |
| 3p | 0.2% | **42.9%** | 36.8% | 14.8% | 2.5% | 32.6% |
| 4p | 0.1% | **37.5%** | 32.5% | 15.5% | 4.2% | 19.2% |

## Alternatives

| # | Exact kill | Spoils | Pamphleteer | Hand (1/2/3/4) | Regroups | Pamphleteers | Win rates | Spread |
|---|---|---|---|---|---|---|---|---|
| 1 ★ | Le Peuple | 0 | shielded | 9/8/6/5 | 2/0/0/0 | 0/3/3/3 | 40/38/43/37 | 5.8 |
| 2 | Le Peuple | 0 | shielded | 9/8/6/5 | 2/0/0/0 | 1/3/3/3 | 37/38/43/37 | 6.4 |
| 3 | Le Peuple | 0 | shielded | 8/6/5/5 | 3/1/1/0 | 0/0/3/3 | 38/30/39/37 | 8.8 |
| 4 | Le Peuple | 0 | shielded | 9/6/5/5 | 2/1/1/0 | 0/0/3/3 | 40/30/39/37 | 9.5 |
| 5 | Le Peuple | 0 | shielded | 9/8/6/5 | 2/0/0/0 | 2/3/3/3 | 32/38/43/37 | 10.5 |
| 6 | Le Peuple | 0 | shielded | 8/6/5/5 | 3/1/1/0 | 0/0/2/3 | 38/30/44/37 | 13.6 |
| 7 | Le Peuple | 0 | shielded | 9/6/5/5 | 2/1/1/0 | 0/0/2/3 | 40/30/44/37 | 13.6 |
| 8 | Le Peuple | 0 | shielded | 8/6/5/5 | 3/1/1/0 | 0/0/2/2 | 38/30/44/41 | 13.6 |

## Combinations that cannot reach the band

| Fixed rules | Table sizes that miss | Closest it gets |
|---|---|---|
| exactKillTo=hand drawOnVictory=1 pamphleteerImmune=true | 2, 3, 4 | 1p 34.5%, 2p 42.9% |
| exactKillTo=peuple drawOnVictory=1 pamphleteerImmune=true | 3, 4 | 1p 35.4%, 2p 35.9%, 3p 48.1% |
| exactKillTo=hand drawOnVictory=0 pamphleteerImmune=true | 2, 3, 4 | 1p 35.1%, 2p 40.4%, 3p 28.5%, 4p 48.9% |
| exactKillTo=peuple drawOnVictory=1 pamphleteerImmune=false | 4 | 1p 37.2%, 2p 39.0%, 3p 30.0%, 4p 47.6% |
| exactKillTo=peuple drawOnVictory=2 pamphleteerImmune=true | 2, 3, 4 | 1p 34.4% |
| exactKillTo=peuple drawOnVictory=2 pamphleteerImmune=false | 2, 4 | 1p 36.7%, 2p 40.9%, 3p 36.3% |
| exactKillTo=hand drawOnVictory=2 pamphleteerImmune=true | 2, 3, 4 | 1p 37.9% |
| exactKillTo=hand drawOnVictory=2 pamphleteerImmune=false | 4 | 1p 35.7%, 2p 35.7%, 3p 40.9% |
| exactKillTo=hand drawOnVictory=1 pamphleteerImmune=false | 2, 4 | 1p 31.9%, 2p 29.2%, 3p 37.4% |

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
