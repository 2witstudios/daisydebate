/** TEST-only independent transport intervals. Database completion totals are a separate input. */
export function observeCaptureIntervals(
  intervals: readonly {
    readonly began: number;
    readonly ended: number | null;
  }[],
) {
  if (
    intervals.some(
      (i) =>
        !Number.isFinite(i.began) ||
        (i.ended !== null && (!Number.isFinite(i.ended) || i.ended <= i.began)),
    )
  )
    return { complete: false, completed: null, peak: null, active: null };
  const edges = intervals
    .flatMap((i) => [
      { at: i.began, delta: 1 },
      ...(i.ended === null ? [] : [{ at: i.ended, delta: -1 }]),
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  const counts = edges.reduce(
    (state, edge) => ({
      active: state.active + edge.delta,
      peak: Math.max(state.peak, state.active + edge.delta),
    }),
    { active: 0, peak: 0 },
  );
  return {
    complete: counts.active === 0,
    completed: intervals.filter((i) => i.ended !== null).length,
    ...counts,
  };
}
