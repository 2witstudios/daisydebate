import { createAppError } from '@daisy/errors';

/** Why a lane refused work that never ran (ADR 0088). */
type CapacityRefusalReason = 'unconfigured' | 'saturated' | 'expired';
export type CapacityRefusalDetail = {
  readonly lane: string;
  readonly reason: CapacityRefusalReason;
};

const CAPACITY_UNAVAILABLE = 'Database capacity unavailable';
const refusals = new WeakMap<Error, CapacityRefusalDetail>();
/** Errors whose capacity refusal the database boundary already logged. */
const reportedRefusals = new WeakSet<Error>();
/**
 * The member of `error`'s chain (itself or one of at most 16 native Error
 * causes) that `marked` recognises. Only own data-property causes are
 * followed; hostile links and execution recovery detail objects fail
 * closed to ordinary failure reporting.
 */
function causeChainMember(
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
/** The lane and reason of the refusal `error` carries, if it carries one. */
export function capacityRefusalDetail(
  error: unknown,
): CapacityRefusalDetail | undefined {
  const refusal = refusalIn(error);
  return refusal ? refusals.get(refusal) : undefined;
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
