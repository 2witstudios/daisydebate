import type { ObservationBinding } from '@daisy/db/observation';
import type { ObservationAuthorityReadResult } from './observation-authority';
import type { ObservationPermit } from './observation-permit';

type AuthorityRead = (
  bindings: readonly ObservationBinding[],
) => Promise<readonly ObservationAuthorityReadResult[]>;
export type ScheduledBinding = {
  readonly input: ObservationBinding;
  readonly permit: ObservationPermit;
};
type Attempt = ReturnType<ObservationPermit['begin']>;
const admissionQueue = 100,
  admissionAgeMs = 250,
  renewalBatch = 256,
  renewalLanes = 2;

/** Bounded admission (100 waiting, 250ms age, one batch in flight) and
 * renewal (256-binding batches over two lanes). Attempts begin before the
 * canonical read so invalidations during it fence the result. An aged or
 * failed read settles as unavailable, never as denial.
 */
export function createObservationAuthorityScheduler<
  T extends ScheduledBinding,
>({
  now,
  authority,
  settle,
}: {
  readonly now: () => number;
  readonly authority: {
    readonly admit: AuthorityRead;
    readonly renew: AuthorityRead;
  };
  readonly settle: (
    binding: T,
    attempt: Attempt,
    result: ObservationAuthorityReadResult | undefined,
  ) => void;
}) {
  const queue = new Map<T, number>();
  const renewing = new Set<T>();
  const work = new Set<Promise<void>>();
  let admitting = false,
    lanes = 0,
    closed = false;
  function run(
    read: AuthorityRead,
    batch: readonly T[],
    done: (binding: T) => void,
  ) {
    const attempts = batch.map((binding) => binding.permit.begin());
    const job = read(batch.map((binding) => binding.input))
      .catch(() => [])
      .then((results) => {
        batch.forEach((binding, index) => {
          done(binding);
          if (!closed) settle(binding, attempts[index]!, results[index]);
        });
      });
    work.add(job);
    return job.finally(() => work.delete(job));
  }
  function pump() {
    if (admitting || closed || !queue.size) return;
    const at = now();
    const batch: T[] = [];
    for (const [binding, queuedAt] of queue) {
      queue.delete(binding);
      if (at - queuedAt <= admissionAgeMs) batch.push(binding);
      else settle(binding, binding.permit.begin(), undefined);
    }
    if (!batch.length) return;
    admitting = true;
    void run(authority.admit, batch, () => {}).finally(() => {
      admitting = false;
      pump();
    });
  }
  return {
    /** False when the bounded queue is full: refuse promptly. */
    admit(binding: T) {
      if (closed) return false;
      if (queue.has(binding) || renewing.has(binding)) return true;
      if (queue.size >= admissionQueue) return false;
      queue.set(binding, now());
      queueMicrotask(pump);
      return true;
    },
    pending: (binding: T) => queue.has(binding) || renewing.has(binding),
    renew(due: readonly T[]) {
      const ready = due.filter(
        (binding) => !queue.has(binding) && !renewing.has(binding),
      );
      for (
        let index = 0;
        index < ready.length && lanes < renewalLanes && !closed;
        index += renewalBatch
      ) {
        const batch = ready.slice(index, index + renewalBatch);
        for (const binding of batch) renewing.add(binding);
        lanes++;
        void run(authority.renew, batch, (binding) =>
          renewing.delete(binding),
        ).finally(() => {
          lanes--;
        });
      }
    },
    forget(binding: T) {
      queue.delete(binding);
    },
    stats: () => ({ queued: queue.size, renewing: renewing.size, lanes }),
    async settled() {
      while (work.size) await Promise.allSettled([...work]);
    },
    close() {
      closed = true;
      queue.clear();
    },
  };
}
