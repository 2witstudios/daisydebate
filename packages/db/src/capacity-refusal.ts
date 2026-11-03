import { createAppError } from '@daisy/errors';

/** Why a lane refused work that never ran (ADR 0088). */
type CapacityRefusalReason = 'unconfigured' | 'saturated' | 'expired';
export type CapacityRefusalDetail = {
  readonly lane: string;
  readonly reason: CapacityRefusalReason;
  /**
   * The lane when it refused: waiters still queued, connections taken, and how
   * long the oldest running work had held its slot. One long hold with few
   * waiters is a stuck holder; many waiters behind short holds is a burst.
   */
  readonly pressure?: {
    readonly pending: number;
    readonly running: number;
    readonly oldestAgeMs: number;
  };
  /** Connections held when it refused, by the operation that asked for each. */
  readonly holders?: Readonly<Record<string, number>>;
};

const CAPACITY_UNAVAILABLE = 'Database capacity unavailable';
type RefusalRegistry = {
  readonly refusals: WeakMap<Error, CapacityRefusalDetail>;
  /** Errors whose capacity refusal the database boundary already logged. */
  readonly reportedRefusals: WeakSet<Error>;
};
const REGISTRY = Symbol.for('daisy.db.capacity-refusals');
const host = globalThis as typeof globalThis & {
  [REGISTRY]?: RefusalRegistry;
};
/**
 * One registry per process, not per module copy: Next can bundle a page apart
 * from the process app, so the copy that reads a refusal may not be the one
 * that minted it (ISSUE-927). A table keeps each refusal's frozen detail and
 * reported mark off the error, which wrappers and reporters see.
 */
const { refusals, reportedRefusals } = (host[REGISTRY] ??= {
  refusals: new WeakMap(),
  reportedRefusals: new WeakSet(),
});
/**
 * The member of `error`'s chain (itself or one of at most 16 native Error
 * causes) that `marked` recognises. Only own data-property causes are
 * followed; hostile links and execution recovery detail objects fail
 * closed to ordinary failure reporting.
 */
export function causeChainMember(
  marked: (error: Error) => boolean,
  error: unknown,
): Error | undefined {
  const seen = new WeakSet<Error>();
  let current = error;
  try {
    for (let depth = 0; depth < 16 && current instanceof Error; depth += 1) {
      if (marked(current)) return current;
      if (seen.has(current)) return undefined;
      seen.add(current);
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
    }
  } catch {
    // A proxy may refuse descriptor/prototype inspection; never hide its failure.
    return undefined;
  }
  return undefined;
}
const refusalIn = (error: unknown) =>
  causeChainMember((candidate) => refusals.has(candidate), error);

/** Refused-unrun admission identity, through bounded native cause wrappers. */
export const isCapacityRefusal = (error: unknown): boolean =>
  refusalIn(error) !== undefined;
/**
 * A refusal asking again can clear. `unconfigured` cannot: a lane missing from
 * the profile, or work heavier than the lane, is the same on every request.
 */
export const isTemporaryRefusal = (error: unknown): boolean => {
  const reason = capacityRefusalDetail(error)?.reason;
  return reason === 'saturated' || reason === 'expired';
};
/** The lane and reason of the refusal `error` carries, if it carries one. */
export function capacityRefusalDetail(
  error: unknown,
): CapacityRefusalDetail | undefined {
  const refusal = refusalIn(error);
  return refusal ? refusals.get(refusal) : undefined;
}
/** A refusal's loggable fields: which lane, why, and how that lane stood. */
export function capacityRefusalFields(error: unknown) {
  const detail = capacityRefusalDetail(error);
  return (
    detail && { cause: `${detail.lane}.${detail.reason}`, ...detail.pressure }
  );
}
/**
 * Records that `db.capacity.refused` was emitted for this rejection. The
 * refusal itself is marked, not the wrapper that carried it, so any other
 * wrapper of the same refusal is recognised as already reported.
 */
export function markCapacityRefusalReported(error: unknown) {
  const refusal = refusalIn(error);
  if (refusal) reportedRefusals.add(refusal);
}
/**
 * The one report of what held a refusing lane: one line per operation, largest
 * first. A refusal is reported once, by whichever boundary reaches it first.
 */
export function reportCapacityHolders(
  error: unknown,
  log: (
    event: 'db.capacity.holder',
    fields: {
      readonly operation: string;
      readonly cause: string;
      readonly running: number;
    },
    message: string,
  ) => void,
) {
  const detail = capacityRefusalDetail(error);
  if (!detail || isReportedCapacityRefusal(error)) return;
  markCapacityRefusalReported(error);
  for (const [operation, running] of Object.entries(detail.holders ?? {}).sort(
    ([, a], [, b]) => b - a,
  ))
    log(
      'db.capacity.holder',
      { operation, cause: detail.lane, running },
      'Operation holding the refusing lane',
    );
}
/**
 * A capacity refusal the database boundary already reported, so a caller
 * further out suppresses its duplicate rather than logging it again.
 */
export const isReportedCapacityRefusal = (error: unknown): boolean =>
  causeChainMember((candidate) => reportedRefusals.has(candidate), error) !==
  undefined;
/** The one admission refusal `isCapacityRefusal` recognises: retryable INFRASTRUCTURE. */
export function refuseCapacity(
  detail: CapacityRefusalDetail = { lane: 'unknown', reason: 'saturated' },
) {
  const refusal = createAppError('INFRASTRUCTURE', CAPACITY_UNAVAILABLE);
  refusals.set(refusal, Object.freeze({ ...detail }));
  return refusal;
}
