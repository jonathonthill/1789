// Pure result-screen copy and statistics. Kept free of DOM work so progress
// bands and public counts can be verified alongside the rules engine.

export function royalOutcomeCounts(view) {
  const defeats = Array.isArray(view?.defeatedRoyals) ? view.defeatedRoyals : [];
  return {
    defeated: defeats.length,
    captured: defeats.filter(defeat => defeat.outcome === 'captured').length,
    guillotined: defeats.filter(defeat => defeat.outcome === 'guillotined').length,
  };
}

export function encouragingLossMessage(defeated) {
  if (defeated >= 11) return 'One royal remained. The Republic was within reach.';
  if (defeated >= 8) return 'The Republic is close. The royals are wavering; one more uprising may break them.';
  if (defeated >= 4) return 'The Ancien Régime is shaken. The Revolution has found its strength.';
  return 'The streets remember every stand. Rally the citoyens and rise again.';
}

export function resultScreenContent(view) {
  const won = view?.phase === 'won';
  const counts = royalOutcomeCounts(view);
  const stats = won
    ? [
        { label: 'Won over', value: counts.captured, kind: 'captured' },
        { label: 'Guillotined', value: counts.guillotined, kind: 'guillotined' },
        { label: 'Pamphleteers played', value: view?.pamphleteersUsed ?? 0, kind: 'pamphleteer' },
        { label: 'Retreats played', value: view?.regroupsUsed ?? 0, kind: 'retreat' },
      ]
    : [
        { label: 'Royals defeated', value: counts.defeated, suffix: ' / 12', kind: 'defeated' },
        { label: 'Won over', value: counts.captured, kind: 'captured' },
        { label: 'Guillotined', value: counts.guillotined, kind: 'guillotined' },
      ];

  return {
    won,
    message: won
      ? 'The twelve royals have fallen. The Republic is born.'
      : encouragingLossMessage(counts.defeated),
    reason: won ? '' : (view?.result?.reason ?? ''),
    stats,
  };
}
