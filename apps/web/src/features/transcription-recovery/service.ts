import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { WorkerTimers } from '../../lib/worker-timers';
type Work = ReturnType<Database['createTranscriptionRecovery']>;
type Claim = Extract<Awaited<ReturnType<Work['claim']>>, { kind: 'claimed' }>;
type Missing = Awaited<ReturnType<Work['missing']>>[number];
type Entry = {
  readonly claim: Claim;
  readonly abort: AbortController;
  work: Promise<void>;
};
/** Injected local composition. DB fairness, finite spending and original evidence authority remain owning contracts. */
export function startTranscriptionRecoveryService(input: {
  readonly store: Pick<Work, 'missing' | 'claim' | 'renew'>;
  readonly workerId: string;
  readonly enroll: (target: Missing) => Promise<unknown>;
  readonly reserveCapacity: () => (() => void) | null;
  /** Existing one-shot attempt plus qualified selection; this scheduler never grants provider permission. */
  readonly execute: (claim: Claim, signal: AbortSignal) => Promise<unknown>;
  readonly limits: {
    readonly parallel: number;
    readonly claimBatch: number;
    readonly scanMs: number;
    readonly enrollMs: number;
    readonly renewMs: number;
  };
  readonly timers: WorkerTimers;
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const { parallel, claimBatch, scanMs, enrollMs, renewMs } = input.limits;
  if (
    ![parallel, claimBatch].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 64,
    ) ||
    ![scanMs, enrollMs, renewMs].every(
      (value) => Number.isSafeInteger(value) && value >= 100 && value <= 60000,
    )
  )
    throw createAppError('VALIDATION', 'Invalid recognition service bounds');
  const entries = new Map<string, Entry>();
  let stopped = false;
  let scanning: Promise<void> | null = null;
  let enrolling: Promise<void> | null = null;
  let renewing: Promise<void> | null = null;
  const active = (entry: Entry) => entries.get(entry.claim.contextId) === entry;
  const launch = (claim: Claim, free: () => void) => {
    const entry: Entry = {
      claim,
      abort: new AbortController(),
      work: Promise.resolve(),
    };
    entries.set(claim.contextId, entry);
    entry.work = (async () => {
      try {
        await input.execute(claim, entry.abort.signal);
      } catch (error) {
        if (!entry.abort.signal.aborted) input.failed(error, 'execute');
      } finally {
        if (active(entry)) entries.delete(claim.contextId);
        free();
      }
    })();
  };
  const scan = (): Promise<void> => {
    if (stopped || scanning) return scanning ?? Promise.resolve();
    scanning = (async () => {
      for (
        let index = 0;
        index < claimBatch && !stopped && entries.size < parallel;
        index++
      ) {
        const reserved = input.reserveCapacity();
        if (!reserved) break;
        let released = false;
        const free = () => {
          if (!released) {
            released = true;
            reserved();
          }
        };
        try {
          const claim = await input.store.claim({ workerId: input.workerId });
          if (stopped || claim.kind !== 'claimed') {
            free();
            if (claim.kind === 'blocked' && !stopped) continue;
            break;
          }
          if (entries.has(claim.contextId)) {
            free();
            continue;
          }
          launch(claim, free);
        } catch (error) {
          free();
          input.failed(error, 'claim');
          break;
        }
      }
    })()
      .catch((error) => {
        input.failed(error, 'scan');
      })
      .finally(() => {
        scanning = null;
      });
    return scanning;
  };
  const enroll = (): Promise<void> => {
    if (stopped || enrolling) return enrolling ?? Promise.resolve();
    enrolling = (async () => {
      try {
        // The owning query commits its finite pass before this bounded external work.
        const targets = await input.store.missing();
        for (const target of targets) {
          if (stopped) break;
          try {
            await input.enroll(target);
          } catch (error) {
            input.failed(error, 'enroll');
          }
        }
      } catch (error) {
        input.failed(error, 'missing');
      }
    })().finally(() => {
      enrolling = null;
    });
    return enrolling;
  };
  const renew = (): Promise<void> => {
    if (stopped || renewing) return renewing ?? Promise.resolve();
    renewing = Promise.all(
      [...entries.values()].map(async (entry) => {
        if (entry.abort.signal.aborted) return;
        try {
          await input.store.renew(entry.claim);
        } catch (error) {
          if (!active(entry)) return;
          // Abort future execution steps; owning PG fences still serialize commits.
          // Already-authorized in-flight work cannot be recalled. Keep its slot until settlement.
          entry.abort.abort();
          input.failed(error, 'renew');
        }
      }),
    ).then(() => {
      renewing = null;
    });
    return renewing;
  };
  const handles = [
    input.timers.setInterval(scan, scanMs),
    input.timers.setInterval(enroll, enrollMs),
    input.timers.setInterval(renew, renewMs),
  ];
  const started = Promise.all([scan(), enroll()]).then(() => undefined);
  return {
    started,
    async stop() {
      stopped = true;
      for (const handle of handles) input.timers.clearInterval(handle);
      for (const entry of entries.values()) entry.abort.abort();
      await Promise.allSettled([scanning, enrolling, renewing]);
      // A late successful claim is refused by scan's stopped check before launch.
      await Promise.allSettled(
        [...entries.values()].map((entry) => entry.work),
      );
    },
  };
}
