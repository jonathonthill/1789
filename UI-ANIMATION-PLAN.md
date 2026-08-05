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
3. On entry to Queens or Kings, a tier-victory overlay plays:
   - clip-art inspired by the forward motion and flag composition of *Liberty Leading the People*, without reproducing the painting;
   - **THE REVOLUTION ADVANCES** and the new tier name;
   - the hand limit changes visibly from its old value to its new value;
   - a facedown hand fan opens an additional slot before any transition card arrives.
4. A distinct **LES DÉPOUILLES** beat follows whenever the viewer actually receives Spoils. A mystery card flies from Le Peuple into a before/after hand fan, matching the capture visual language.
5. Tier-transition draws remain distinct from Spoils and occur in the tier-advance beat.
6. Other players' facedown hand counts update at the same narrative beat as their rewards.
7. The next royal entrance begins only after these rewards finish.

## Accessibility and replay rules

- Every overlay is skippable and cannot invoke its continuation twice.
- Reconnects and refreshes do not replay historical animations.
- Reduced-motion mode replaces long travel with short fades while preserving ordering and final counts.
- Mobile layouts keep card titles, availability counts, and old/new hand limits legible without scrolling.
