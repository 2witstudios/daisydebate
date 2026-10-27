import { createAppError } from '@daisy/errors';

const CAPACITY_UNAVAILABLE = 'Transcript transaction capacity unavailable';
const capacityRefusals = new WeakSet<Error>();
/**
 * Refused-unrun admission identity through at most 16 native Error wrappers.
 * Only own data-property causes are supported; hostile links and execution
 * recovery detail objects fail closed to ordinary failure reporting.
 */
export function isTransactionCapacityRefusal(error: unknown): boolean {
  const seen = new WeakSet<Error>();
  let current = error;
  try {
    for (let depth = 0; depth < 16 && current instanceof Error; depth += 1) {
      if (capacityRefusals.has(current)) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
    }
  } catch {
    // A proxy may refuse descriptor/prototype inspection; never hide its failure.
    return false;
  }
  return false;
}
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
