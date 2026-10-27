import { isAppError } from '@daisy/errors';
import type { WorkerTimers } from '../round-bots/worker-timers';
type Target = { readonly roundId: string; readonly judgeParticipantId: string };
type Claim = { readonly scope: Target; readonly token: string };
type Entry<C> = {
  readonly claim: C;
  readonly freeCapacity: () => void;
  readonly abort: AbortController;
  running: boolean;
  work: Promise<void>;
  /** Consecutive refused submissions of a saved ballot. */
  refusals: number;
};
/** Submissions of a saved ballot tried in a row before the slot is released (ISSUE-463). */
const MAX_SUBMISSION_REFUSALS = 3;
/** Lease renewal never queues behind provider execution or attendance settlement. */
export function startRoundJudgingService<C extends Claim>(input: {
  readonly store: {
    readonly scanRoundJudgingJobs: (
      limit: number,
    ) => Promise<readonly Target[]>;
    readonly claimRoundJudgingJob: (target: Target) => Promise<C>;
    readonly renewRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<unknown>;
    readonly verifyRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<{ readonly pendingBallot: unknown | null }>;
  };
  /** Reserve before the durable claim; refusal must not leave a lease behind. */
  readonly reserveCapacity: () => (() => void) | null;
  /** Uses the entry's reserved slot, including saved-ballot retries. */
  readonly execute: (claim: C, signal: AbortSignal) => Promise<unknown>;
  readonly limits: {
    readonly parallel: number;
    readonly scanBatch: number;
    readonly scanMs: number;
    readonly renewMs: number;
  };
  readonly timers: WorkerTimers;
  /** `stage` names the work that failed: execute, scan or renew. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const entries = new Map<string, Entry<C>>();
  let stopped = false,
    scanning: Promise<void> | null = null,
    renewing: Promise<void> | null = null;
  const key = (target: Target) =>
    `${target.roundId}:${target.judgeParticipantId}`;
  const remove = (entry: Entry<C>) => {
    const target = key(entry.claim.scope);
    // A delayed renewal belongs to its original claim, never its replacement.
    if (entries.get(target) === entry) entries.delete(target);
    entry.freeCapacity();
  };
  const release = (entry: Entry<C>) => {
    entry.abort.abort();
    if (!entry.running) remove(entry);
  };
  const execute = (entry: Entry<C>) => {
    if (entry.running || entry.abort.signal.aborted) return;
    entry.running = true;
    entry.work = (async () => {
      try {
        await input.execute(entry.claim, entry.abort.signal);
        release(entry);
      } catch (error) {
        if (entry.abort.signal.aborted) return;
        try {
          const state = await input.store.verifyRoundJudgingJob(
            entry.claim.scope,
            entry.claim.token,
          );
          // A saved ballot is retried on the next scan, a bounded number of
          // times in a row; then it is reported and the slot released.
          if (state.pendingBallot && ++entry.refusals < MAX_SUBMISSION_REFUSALS)
            return;
        } catch {
          /* A lost authority never becomes a retry permission. */
        }
        release(entry);
        input.failed(error, 'execute');
      } finally {
        entry.running = false;
        if (entry.abort.signal.aborted) remove(entry);
      }
    })();
  };
  const scan = (): Promise<void> => {
    if (stopped || scanning) return scanning ?? Promise.resolve();
    scanning = (async () => {
      try {
        for (const entry of entries.values()) execute(entry);
        const targets = await input.store.scanRoundJudgingJobs(
          input.limits.scanBatch,
        );
        for (const target of targets) {
          if (stopped || entries.size >= input.limits.parallel) break;
          if (entries.has(key(target))) continue;
          const freeCapacity = input.reserveCapacity();
          if (!freeCapacity) break;
          try {
            const claim = await input.store.claimRoundJudgingJob(target);
            if (stopped) {
              freeCapacity();
              break;
            }
            const entry: Entry<C> = {
              claim,
              freeCapacity,
              abort: new AbortController(),
              running: false,
              work: Promise.resolve(),
              refusals: 0,
            };
            entries.set(key(target), entry);
            execute(entry);
          } catch {
            freeCapacity();
            /* Discovery is advisory; another process may win the claim. */
          }
        }
      } catch (error) {
        input.failed(error, 'scan');
      } finally {
        scanning = null;
      }
    })();
    return scanning;
  };
  const renew = (): Promise<void> => {
    if (stopped || renewing) return renewing ?? Promise.resolve();
    renewing = Promise.all(
      [...entries.values()].map(async (entry) => {
        if (entry.abort.signal.aborted) return;
        try {
          await input.store.renewRoundJudgingJob(
            entry.claim.scope,
            entry.claim.token,
          );
        } catch (error) {
          // A lease lost to completion or another claimant is a release, not
          // a fault. Any other failure leaves the paid call running; the next
          // renewal tries again (ISSUE-462).
          if (isAppError(error) && error.code === 'CONFLICT') release(entry);
          else input.failed(error, 'renew');
        }
      }),
    ).then(() => {
      renewing = null;
    });
    return renewing;
  };
  const discovery = input.timers.setInterval(scan, input.limits.scanMs);
  const heartbeat = input.timers.setInterval(renew, input.limits.renewMs);
  const started = scan();
  return {
    started,
    async stop() {
      stopped = true;
      input.timers.clearInterval(discovery);
      input.timers.clearInterval(heartbeat);
      for (const entry of entries.values()) release(entry);
      await Promise.allSettled([
        scanning,
        renewing,
        ...[...entries.values()].map((entry) => entry.work),
      ]);
    },
  };
}
