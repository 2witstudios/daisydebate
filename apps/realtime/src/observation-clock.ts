/** The candidate's 100ms safety margin also bounds trusted wall/monotonic
 * disagreement. A process must reconstruct its incarnation and authority after
 * uncertainty; an old clock or permit cannot become trusted by realigning.
 */
export function createObservationClock({
  monotonicNow,
  wallNow,
  onUncertainty,
}: {
  readonly monotonicNow: () => number;
  readonly wallNow: () => number;
  readonly onUncertainty: () => void;
}) {
  const initialMonotonic = monotonicNow(),
    initialWall = wallNow();
  let lastMonotonic = initialMonotonic,
    lastWall = initialWall,
    uncertain = false;
  return {
    now() {
      if (uncertain) return NaN;
      const monotonic = monotonicNow(),
        wall = wallNow();
      if (
        ![initialMonotonic, initialWall, monotonic, wall].every(
          Number.isFinite,
        ) ||
        monotonic < lastMonotonic ||
        wall < lastWall ||
        Math.abs(wall - initialWall - (monotonic - initialMonotonic)) > 100
      ) {
        uncertain = true;
        onUncertainty();
        return NaN;
      }
      lastMonotonic = monotonic;
      lastWall = wall;
      return monotonic;
    },
  };
}
