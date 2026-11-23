import type { MediaCaptureStore } from '@daisy/db/stores/media-capture';
import type { Waits } from '@daisy/clock';
import { createAppError, isAppError } from '@daisy/errors';
import { holdLease, repeatEvery, type Lease } from '@daisy/worker';
type Work = ReturnType<MediaCaptureStore['createTranscriptionRecovery']>;
type Claim = Extract<Awaited<ReturnType<Work['claim']>>, { kind: 'claimed' }>;
type Missing = Awaited<ReturnType<Work['missing']>>[number];
type Entry = {
  readonly claim: Claim;
  readonly abort: AbortController;
  readonly lease: Lease<undefined>;
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
    /** How long an execution's lease holds after a renewal that held. */
    readonly leaseMs: number;
  };
  readonly waits: Waits;
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const { parallel, claimBatch, scanMs, enrollMs, renewMs, leaseMs } =
    input.limits;
  if (
    ![parallel, claimBatch].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 64,
    ) ||
    ![scanMs, enrollMs, renewMs, leaseMs].every(
      (value) => Number.isSafeInteger(value) && value >= 100 && value <= 60000,
    ) ||
    leaseMs <= renewMs
  )
    throw createAppError('VALIDATION', 'Invalid recognition service bounds');
  const entries = new Map<string, Entry>();
  let stopped = false;
  // Read live: stop() can run during any await, which narrowing cannot see.
  const isStopped = () => stopped;
  let scanning: Promise<void> | null = null;
  let enrolling: Promise<void> | null = null;
  const active = (entry: Entry) => entries.get(entry.claim.contextId) === entry;
  const launch = (claim: Claim, free: () => void, claimedAtMs: number) => {
    let refusal: unknown = null;
    // A stale execution (another worker, epoch or token) is a loss; any other
    // failure is retried until the lease would lapse.
    const lease = holdLease({
      waits: input.waits,
      facts: undefined,
      renewEveryMs: renewMs,
      retryMs: renewMs,
      horizonMs: leaseMs,
      claimedAtMs,
      renew: async () => {
        await input.store.renew(claim);
        return { kind: 'held', facts: undefined };
      },
      // Only classifies: the refusal is reported once the lease has ended.
      lossOf: (error) => {
        if (!isAppError(error) || error.code !== 'CONFLICT') return null;
        refusal = error;
        return 'taken';
      },
      failed: (error) => input.failed(error, 'renew'),
    });
    const entry: Entry = {
      claim,
      abort: new AbortController(),
      lease,
      work: Promise.resolve(),
    };
    entries.set(claim.contextId, entry);
    // Abort future execution steps; owning PG fences still serialize commits.
    // Already-authorized in-flight work cannot be recalled. Keep its slot until settlement.
    void lease.ended.then((end) => {
      if (end === 'stopped' || !active(entry)) return;
      entry.abort.abort();
      // A failure sink that throws never escapes into the lease's ending.
      try {
        if (refusal !== null) input.failed(refusal, 'renew');
      } catch {
        /* Reported again by the next failure. */
      }
    });
    entry.work = (async () => {
      try {
        await input.execute(claim, entry.abort.signal);
      } catch (error) {
        if (!entry.abort.signal.aborted) input.failed(error, 'execute');
      } finally {
        await lease.stop();
        if (active(entry)) entries.delete(claim.contextId);
        free();
      }
    })();
  };
  const mayClaim = () => !stopped && entries.size < parallel;
  const scan = (): Promise<void> => {
    if (stopped || scanning) return scanning ?? Promise.resolve();
    scanning = (async () => {
      for (let index = 0; index < claimBatch && mayClaim(); index++) {
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
          const claimedAtMs = input.waits.nowMs();
          const claim = await input.store.claim({ workerId: input.workerId });
          if (isStopped() || claim.kind !== 'claimed') {
            free();
            if (claim.kind === 'blocked' && !isStopped()) continue;
            break;
          }
          if (entries.has(claim.contextId)) {
            free();
            continue;
          }
          launch(claim, free, claimedAtMs);
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
          if (isStopped()) break;
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
  const cadences = [
    repeatEvery({
      waits: input.waits,
      everyMs: scanMs,
      runOnStart: true,
      run: scan,
      failed: (error) => input.failed(error, 'scan'),
    }),
    repeatEvery({
      waits: input.waits,
      everyMs: enrollMs,
      runOnStart: true,
      run: enroll,
      failed: (error) => input.failed(error, 'missing'),
    }),
  ];
  const started = Promise.all(
    cadences.map(({ initial }) => initial ?? Promise.resolve()),
  ).then(() => undefined);
  return {
    started,
    async stop() {
      stopped = true;
      for (const entry of entries.values()) entry.abort.abort();
      await Promise.allSettled([
        ...cadences.map((cadence) => cadence.stop()),
        scanning,
        enrolling,
        ...[...entries.values()].map((entry) => entry.lease.stop()),
      ]);
      // A late successful claim is refused by scan's stopped check before launch.
      await Promise.allSettled(
        [...entries.values()].map((entry) => entry.work),
      );
    },
  };
}
