# Special Cards and Victory Animation Plan

## Special-card design

### La Retraite

- Corner index: **R**.
- Suit: a monochrome red cockade drawn as a red outer circle and red centre dot, with the card face showing between them.
- Artwork: isolated clip-art, matching the Pamphleteer and numbered cards. A small group of revolutionaries withdraws toward a barricade and reforms around a raised flag.
- Blue rules box: **LA RETRAITE** / **DISCARD & DRAW**.
- The shared card is not part of a player's hand or any pile.

### Pamphleteer

- Retains its black pen-nib special suit and existing clip-art.
- Pairs visually with the red-cockade La Retraite card, as spades pair with hearts.

## l'Assemblée interaction

1. Multiplayer exposes one **l'Assemblée** button instead of separate Pamphleteer and Regroup buttons.
2. The first modal state says **I move to use…** and shows both special cards with an `×N` availability count.
3. An option at `×0` remains visible but disabled. Other rule/turn restrictions also disable the relevant card.
4. Choosing a card opens the existing motion explanation, voter tally, and Yea/Nay controls.
5. A rejected motion spends nothing and plays no card animation.
6. When a motion carries, the chosen special card appears beneath the royal, just as a remote player's ordinary play does.
7. After a readable pause, the special card flies straight upward and off-screen to show that it has been permanently removed from the game. It never enters In Play, La Prison, or Le Peuple.
8. The card's effect resolves visually after the removal beat, and the shared count updates.
9. Solo keeps direct Pamphleteer and La Retraite controls because there is no Assemblée.

## Royal-defeat sequence

1. Killing cards travel beneath the royal and then to La Prison.
2. The royal receives the guillotine or exact-capture judgment.
3. If the royal was won over, its capture hand remains in the same position and dimensions used by the following reward fans.
4. A distinct **LES DÉPOUILLES** beat plays whenever the viewer actually receives Spoils. It comes before tier advancement and uses an ordinary before/after hand fan with no capacity outlines.
5. On entry to Queens or Kings, a tier-victory overlay plays:
   - all four royals from the completed tier remain in one compact row;
   - an exact defeat carries a cockade, while an overkill is shown as a subtly split card;
   - the captured/guillotined counts sit directly beneath that row;
   - **THE REVOLUTION ADVANCES** and the new tier name bind every following benefit to the level change;
   - only benefits actually received appear: the combined hand-size/card reward, renewed La Retraite, and refreshed Lay Low;
   - each benefit receives its own roughly three-second, skippable phase;
   - reset benefits turn a facedown card over to reveal the renewed card;
   - **HAND SIZE INCREASE** combines the wider hand limit and transition card in one beat: the card flies into the hand while dotted empty-card outlines keep the full capacity visible.
6. The combined hand-size beat deliberately reuses the exact Spoils card-to-hand motion, sizing, positioning, and before/after hand fan, while its copy explicitly ties the larger capacity to the new tier. Only this phase uses dotted outlines: the new capacity opens first, then the transition card adds exactly one card. Any capacity still unfilled remains outlined until this phase ends.
7. Other players' facedown hand counts update at the same narrative beat as their rewards.
8. The next royal entrance begins only after these rewards finish.
9. The fourth King receives the same four-card **KINGS DEFEATED** summary before the victory cutscene.
10. Single-card cinematics use the guillotine's original 118px card size; the guillotine retains its original 200×280 frame, full blade travel, and compact composition.

## Result screens

- Losses show royals defeated out of twelve, won over, and guillotined.
- Loss encouragement advances through 0–3, 4–7, 8–10, and 11-royal progress bands while retaining the concrete loss reason.
- Wins show won over, guillotined, Pamphleteers played, and Retreats played; twelve defeated is implicit in victory.
- Short phone layouts keep the complete result and both navigation actions above the fold.

## Accessibility and replay rules

- Every overlay is skippable and cannot invoke its continuation twice.
- Reconnects and refreshes do not replay historical animations.
- Reduced-motion mode replaces long travel with short fades while preserving ordering and final counts.
- Mobile layouts keep card titles, availability counts, and old/new hand limits legible without scrolling.
