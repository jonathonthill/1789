# 1789 — the recommendation

_Drawn from the whole study: a 2,016-ruleset grid, targeted sweeps of the newer
rules, and 40,000-game verification of the ruleset below._

## The ruleset

Fixed at every table:

- **Exact kill** — the royal joins the slayer's hand
- **Spoils of Victory** — 1 card to every citoyen per fallen royal
- **Pamphleteers** — two, **exposed** (they take the reprisal), each free to
  bring **one companion**

Stepping with the number of citoyens:

| | 1p | 2p | 3p | 4p |
|---|---|---|---|---|
| Hand size | 8 | 6 | 5 | 5 |
| Regroups | 2 | 2 | 2 | 2 |
| What a Regroup does | discard and refill your hand | every citoyen draws 3, never past their limit | ← | ← |

Only two things change with the table: hand size, which steps cleanly down, and
what a Regroup does, which differs alone versus together. The count of Regroups
is the same for everyone.

## What it measures

40,000 games per cell (±0.5 points).

| Table | Average players | One citoyen off form half the time | Good players |
|---|---|---|---|
| 1p | **40.3%** | 31.5% | 64.1% |
| 2p | **42.8%** | 37.8% | 83.2% |
| 3p | **39.6%** | 36.6% | 69.0% |
| 4p | **54.3%** | 52.1% | 77.2% |

A ~40% floor from solo through three citoyens, with four floating up to the low
fifties.

## Read this before adopting it

**The reference table is a construction, and it is doing enormous work.** The
"average" citoyen plays the same policy as the "good" one but judges by
hand-reasoned weights rather than fitted ones. That single difference is worth
**24 to 40 points**. Tuned to the good table instead, this ruleset would land at
64–83% — far too easy. Everything here is calibrated to a guess about how well
your group plays, and no measurement of a real table exists to anchor it.

The sensible way to use it: play a few games, count wins, and if you land nearer
70% than 40% the honest conclusion is that your table is the *good* one and the
dials need tightening — most cheaply by taking the Spoils of Victory to 0, which
is worth 25–30 points across the board.

## Why these values

**Why not the rulebook ladder (8/7/6/5).** With Spoils and the companion switched
on, six cards makes a three-player table win 66.9% at the stingiest Regroup
setting, and no Regroup tuning brings it down. Eight/six/five/five is what lets
solo through four sit together. It is harsher than the printed game at two and
three citoyens; that is the price of the generosity added elsewhere.

| Ladder | Spoils | best profile (2p/3p/4p) |
|---|---|---|
| 8/7/6/5 | 1 | 48.6 / **66.9** / 42.5 — three bulges, unfixable |
| 8/7/5/5 | 1 | 48.6 / **21.0** / 42.5 — three collapses |
| **8/6/5/5** | **1** | **42.6 / 39.5 / 54.0** |
| 8/6/5/5 | 0 | 12.7 / 17.0 / 37.4 — too hard without Spoils |

**Why the Regroup differs alone.** A lone citoyen drawing three cards is nothing
like a lone citoyen reshuffling into a fresh hand: the shared draw tops solo out
at 22.7% however generously it is set. Refilling the hand is also what the
rulebook's two flippable Jesters do in its own solo variant, so it is the least
invented rule in the set.

**Why the shared draw at all.** As a table-wide deck reset, one Regroup was worth
30 to 60 points — a switch, not a dial, and the reason every earlier attempt
degenerated to "no Regroups above solo". As a shared draw it steps 2 to 6 points.
That change is what made the game tunable.

**Why Spoils is load-bearing.** Turning it off costs 25–30 points at every table
size. It is the largest single lever in the recommended set, which also makes it
the first thing to reach for if the game plays too easy.

## The difficulty control

One slider — Hard / Medium / Easy — moving Regroups and the Regroup draw
together, plus a separate toggle for the Spoils of Victory. Everything else
(hand sizes, Pamphleteer count and exposure, the companion, exact kill) stays
fixed as the identity of the game rather than a dial.

Solo keeps its own Regroup mechanic — refill your hand — and rides the same
slider positions, since a lone citoyen has no table to protect a hand for.

Spoils **on** (the default):

| Slider | Regroups | Draw | 1p | 2p | 3p | 4p |
|---|---|---|---|---|---|---|
| Hard | 1 | 2 | 14.2% | 21.3% | 27.2% | 48.4% |
| **Medium** | **2** | **3** | **40.2%** | **42.6%** | **39.5%** | **54.0%** |
| Easy | 3 | 4 | 69.5% | 63.7% | 45.1% | 54.9% |

Spoils **off**:

| Slider | Regroups | Draw | 1p | 2p | 3p | 4p |
|---|---|---|---|---|---|---|
| Hard | 1 | 2 | 4.7% | 3.8% | 6.2% | 21.6% |
| Medium | 2 | 3 | 19.4% | 12.7% | 17.0% | 37.4% |
| Easy | 3 | 4 | 45.4% | 32.3% | 30.2% | 44.6% |

Ordered by mean difficulty the six settings space out at roughly 10, 22, 32, 36,
45 and 55 — a real range, with only a slight overlap in the middle.

### Three things the build should know

**Cap the draw at 4.** Above that the dial does nothing: hands are five or six
cards, so a draw of four already fills a depleted hand and the cap eats the rest.
Draw 4, 5, 6 and 8 measure the same to within noise.

**The slider hardly moves a four-player table** — 48% to 55% across its whole
range, against 15% to 67% at two players. Big tables are insensitive to
resupply; they have cards, what kills them is the damage clock. Spoils is the
only control that meaningfully moves them (54% to 37%). If a four-player table
should feel the difficulty setting, the slider has to move hand size as well.

**The toggle outweighs the slider.** Spoils is worth 17 to 30 points, more than
the slider travels at two players, and it hits small tables nearly twice as hard
as large ones. Name it so it reads as a veterans' mode, not a minor option.

## What the code still needs

1. `regroupScope` is global; this recommendation needs it **per table size**, so
   solo can refill while tables draw.
2. `regroupDraw` should offer 1-4 only. Values above 4 are indistinguishable
   from 4 at these hand sizes.
3. La Constitution needs the slider and toggle above rather than raw rule keys.
   The rules behind them (`regroups`, `regroupDraw`, `drawOnVictory`) stay in the
   register; the menu exposes the bundle, not the parts.

This is a new game built on Regicide rather than a reproduction of it, so the
per-table defaults are free to differ from the printed rulebook and no longer
need reconciling with it.

## Standing caveats

- The engine passes the turn after a kill; the rulebook lets the slayer carry on
  against the next royal. That deviation is locked with no rule key and makes
  this version somewhat harder than the numbers suggest.
- Lay Low remains a free duck once per citoyen per royal rather than the
  rulebook's yield-and-still-suffer. It is worth up to 18 points at four players.
- Bots never misread a signal and never forget a card they have seen.
# Historical balance recommendation

> Superseded by the current ruleset: Helper Cards now have value 1, and every
> Regroup returns all hands and La Prison to Le Peuple before fresh hands are
> dealt. The figures below describe the earlier rules used for this study.
