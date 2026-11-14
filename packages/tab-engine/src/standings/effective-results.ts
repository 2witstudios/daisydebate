import { canonicalOrder } from '@daisy/seeded-random';
import type {
  FormatDescriptor,
  Id,
  ResultOf,
  StageHistory,
} from '../shapes/competition';

/**
 * The results a fold reads: for each fixture of a tab round at or before the
 * cutoff, the latest correction of its result. A correction is a result that
 * supersedes another; the latest is the one nothing supersedes. Nothing is
 * recomputed: a correction counts the next time a fold is called.
 */
export const effectiveResults = <Format extends FormatDescriptor>(
  history: StageHistory<Format>,
  cutoff: number,
): ResultOf<Format>[] => {
  const roundOf = new Map(history.fixtures.map((f) => [f.id, f.tabRound]));
  const superseded = new Set(
    history.results.flatMap((r) => (r.supersedes === null ? [] : [r.supersedes])),
  );
  const depth = (result: ResultOf<Format>, byId: ReadonlyMap<Id, ResultOf<Format>>) => {
    let steps = 0;
    for (let at = result; at.supersedes !== null; steps += 1) {
      const earlier = byId.get(at.supersedes);
      if (earlier === undefined) break;
      at = earlier;
    }
    return steps;
  };
  const byId = new Map(history.results.map((r) => [r.id, r]));
  const latest = new Map<Id, ResultOf<Format>>();
  for (const result of canonicalOrder(history.results)) {
    const round = roundOf.get(result.fixture);
    if (round === undefined || round > cutoff || superseded.has(result.id)) continue;
    const held = latest.get(result.fixture);
    if (held === undefined || depth(result, byId) >= depth(held, byId))
      latest.set(result.fixture, result);
  }
  return canonicalOrder([...latest.values()]);
};
