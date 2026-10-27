import { createAppError } from '@daisy/errors';

const CAPACITY_UNAVAILABLE = 'Transcript transaction capacity unavailable';
const capacityRefusals = new WeakSet<Error>();
/** Errors whose capacity refusal the database boundary already logged. */
const reportedRefusals = new WeakSet<Error>();
/**
 * The member of `error`'s chain (itself or one of at most 16 native Error
 * causes) that `marks` holds. Only own data-property causes are followed;
 * hostile links and execution recovery detail objects fail closed to
 * ordinary failure reporting.
 */
function causeChainMember(
  marks: WeakSet<Error>,
  error: unknown,
): Error | undefined {
  const seen = new WeakSet<Error>();
  let current = error;
  try {
    for (let depth = 0; depth < 16 && current instanceof Error; depth += 1) {
      if (marks.has(current)) return current;
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
const causeChainHas = (marks: WeakSet<Error>, error: unknown) =>
  causeChainMember(marks, error) !== undefined;
/** Refused-unrun admission identity, through bounded native cause wrappers. */
export const isTransactionCapacityRefusal = (error: unknown): boolean =>
  causeChainHas(capacityRefusals, error);
/**
 * Records that `db.capacity.refused` was emitted for this rejection. The
 * refusal itself is marked, not the wrapper that carried it, so any other
 * wrapper of the same refusal is recognised as already reported.
 */
export function markCapacityRefusalReported(error: unknown) {
  const refusal = causeChainMember(capacityRefusals, error);
  if (refusal) reportedRefusals.add(refusal);
}
/**
 * A capacity refusal the database boundary already reported, so a caller
 * further out suppresses its duplicate rather than logging it again.
 */
export const isReportedCapacityRefusal = (error: unknown): boolean =>
  causeChainHas(reportedRefusals, error);
/** The one admission refusal `isTransactionCapacityRefusal` recognises. */
export function refuseCapacity() {
  const refusal = createAppError('INFRASTRUCTURE', CAPACITY_UNAVAILABLE);
  capacityRefusals.add(refusal);
  return refusal;
}

/**
 * How long a writer waits for a free slot before the capacity refusal. The
 * process's own maintenance, judging, bot-control, media-recovery and
 * attendance loops share the slots with member requests; their transactions
 * last milliseconds, so a burst is waited out instead of refusing a check-in
 * or a media admission (ISSUE-508).
 */
const ADMISSION_WAIT_MS = 1000;

/**
 * Half the pool's connections as writer slots (each writer reserves two),
 * granted in arrival order: a finishing writer hands its slot to the oldest
 * waiter, and a waiter still queued at the wait is refused and leaves.
 */
export function createTransactionAdmission({
  maxConnections,
  waitMs = ADMISSION_WAIT_MS,
}: {
  readonly maxConnections: number;
  readonly waitMs?: number | undefined;
}) {
  const slots = Number.isSafeInteger(maxConnections)
    ? Math.floor(maxConnections / 2)
    : 0;
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    admit(): Promise<void> {
      if (slots < 1) throw refuseCapacity();
      if (active < slots) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const grant = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(grant), 1);
          reject(refuseCapacity());
        }, waitMs);
        waiting.push(grant);
      });
    },
    leave() {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    },
  };
}
