import type { Waits } from '@daisy/clock';
import {
  holdLease,
  pollWork,
  type Lease,
  type LoopPass,
  type WorkWake,
} from '@daisy/worker';
import { LIVE_IDLE_MAX_MS } from '../../lib/worker-idle';
import { isAppError } from '@daisy/errors';
import {
  judgingPolicy,
  judgingWorkKinds,
  type JudgingWorkKind,
} from '@daisy/protocol/judging-policy';
import { type JudgingTerminalReason } from '@daisy/protocol/round-judging-attempt';
type Target = { readonly roundId: string; readonly judgeParticipantId: string };
type Found = Target & { readonly holdsBallot?: boolean };
type Claim = { readonly scope: Target; readonly token: string };
type Entry<C> = {
  readonly workKind: JudgingWorkKind;
  readonly claim: C;
  readonly freeCapacity: () => void;
  readonly abort: AbortController;
  /** The job's lease, renewed apart from the paid call so it never queues behind it. */
  readonly lease: Lease<undefined>;
  running: boolean;
  work: Promise<void>;
  /** Consecutive refused submissions of a saved ballot. */
  refusals: number;
};
/** Submissions of a saved ballot tried in a row before the slot is released (ISSUE-463). */
const MAX_SUBMISSION_REFUSALS = 3;
const awaitingAttendance = (error: unknown) =>
  isAppError(error) && error.reason === 'attendance-unsettled';
/** Lease renewal never queues behind provider execution or attendance settlement. */
export function startRoundJudgingService<C extends Claim>(input: {
  readonly store: {
    readonly scanRoundJudgingJobs: (
      limit: number,
      workKind: JudgingWorkKind,
    ) => Promise<readonly Found[]>;
    readonly claimRoundJudgingJob: (target: Target) => Promise<C>;
    readonly renewRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<
      | { readonly kind: 'renewed' }
      | { readonly kind: 'ended'; readonly reason: JudgingTerminalReason }
    >;
    readonly verifyRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<{
      readonly progress: { readonly kind: 'ballot_held' | 'stage_due' };
    }>;
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
    /** How long a job's lease holds after a renewal that held. */
    readonly leaseMs: number;
  };
  readonly waits: Waits;
  /** Judging work was created; scan now (ADR 0154). */
  readonly wake?: WorkWake | undefined;
  /** A renewal found the job over and ended it, for this reason. */
  readonly jobEnded?: (reason: JudgingTerminalReason) => void;
  /** `stage` names the work that failed: execute, scan or renew. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const entries = new Map<string, Entry<C>>();
  let stopped = false;
  // Read live: stop() can run during any await, which narrowing cannot see.
  const isStopped = () => stopped;
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
    void entry.lease.stop();
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
          if (
            state.progress.kind === 'ballot_held' &&
            ++entry.refusals < MAX_SUBMISSION_REFUSALS
          )
            return;
        } catch {
          /* A lost authority never becomes a retry permission. */
        }
        release(entry);
        // A ballot waiting on attendance is a state the Round reports, not a fault.
        if (!awaitingAttendance(error)) input.failed(error, 'execute');
      } finally {
        entry.running = false;
        if (entry.abort.signal.aborted) remove(entry);
      }
    })();
  };
  /**
   * One discovery pass; it worked while any judging is held or found. A kind
   * whose scan is refused is reported and the others go on at pace, since
   * held ballots retry on scan passes; when every kind is refused the pass
   * throws, so the loop reports it and backs off, ignoring wakes.
   */
  const scan = async (): Promise<LoopPass> => {
    if (stopped) return 'idle';
    let found = 0;
    let refusal: { reason: unknown } | undefined;
    const visited = new Set(entries.keys());
    for (const entry of entries.values()) execute(entry);
    const discoveries = await Promise.allSettled(
      judgingWorkKinds.map((kind) =>
        input.store.scanRoundJudgingJobs(input.limits.scanBatch, kind),
      ),
    );
    const refused = discoveries.find((result) => result.status === 'rejected');
    if (refused?.status === 'rejected') {
      if (discoveries.every((result) => result.status === 'rejected'))
        refusal = { reason: refused.reason };
      else input.failed(refused.reason, 'scan');
    }
    const targets = discoveries.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? result.value.filter(
            (target) =>
              Boolean(target.holdsBallot) ===
              (judgingWorkKinds[index] === 'submission'),
          )
        : [],
    );
    for (const target of targets) {
      if (isStopped()) break;
      if (visited.has(key(target))) continue;
      const workKind: JudgingWorkKind = target.holdsBallot
        ? 'submission'
        : 'generation';
      const parallel =
        workKind === 'submission'
          ? judgingPolicy.submissionParallel
          : input.limits.parallel;
      if (
        [...entries.values()].filter((entry) => entry.workKind === workKind)
          .length >= parallel
      )
        continue;
      if (entries.has(key(target))) continue;
      if (
        [...entries.values()].some(
          (entry) => entry.claim.scope.roundId === target.roundId,
        )
      )
        continue;
      // Submitting a held ballot buys nothing, so it takes no provider slot.
      const freeCapacity = target.holdsBallot
        ? () => {}
        : input.reserveCapacity();
      // A later held reply needs no provider slot; still visit it.
      if (!freeCapacity) continue;
      try {
        const claimedAtMs = input.waits.nowMs();
        const claim = await input.store.claimRoundJudgingJob(target);
        if (isStopped()) {
          // A successful durable claim recovers by lease expiry. This
          // process has not started execution; never clear an unfenced lease.
          freeCapacity();
          break;
        }
        const ended = { reason: null as JudgingTerminalReason | null };
        // Canonical finality or privacy ended the job, or the lease was lost
        // to completion or another claimant: each is a release, not a fault.
        // Any other failure leaves the paid call running, retried until the
        // lease would lapse (ISSUE-462).
        const lease = holdLease({
          waits: input.waits,
          facts: undefined,
          renewEveryMs: input.limits.renewMs,
          retryMs: input.limits.renewMs,
          horizonMs: input.limits.leaseMs,
          renew: async () => {
            const renewed = await input.store.renewRoundJudgingJob(
              claim.scope,
              claim.token,
            );
            if (renewed.kind === 'renewed')
              return { kind: 'held', facts: undefined };
            ended.reason = renewed.reason;
            return { kind: 'lost', reason: 'released' };
          },
          claimedAtMs,
          // Completion or privacy is a release; a token another claimant
          // rotated (AUTHORIZATION) means the job was taken.
          lossOf: (error) =>
            !isAppError(error)
              ? null
              : error.code === 'CONFLICT'
                ? 'released'
                : error.code === 'AUTHORIZATION'
                  ? 'taken'
                  : null,
          failed: (error) => input.failed(error, 'renew'),
        });
        const entry: Entry<C> = {
          workKind,
          claim,
          freeCapacity,
          abort: new AbortController(),
          lease,
          running: false,
          work: Promise.resolve(),
          refusals: 0,
        };
        entries.set(key(target), entry);
        void lease.ended.then((end) => {
          if (end === 'stopped') return;
          release(entry);
          if (ended.reason !== null) input.jobEnded?.(ended.reason);
        });
        visited.add(key(target));
        execute(entry);
      } catch {
        freeCapacity();
        /* Discovery is advisory; another process may win the claim. */
      }
    }
    found = targets.length;
    if (refusal) throw refusal.reason;
    return entries.size > 0 || found > 0 ? 'worked' : 'idle';
  };
  const discovery = pollWork({
    pass: scan,
    backoff: { busyMs: input.limits.scanMs, idleMaxMs: LIVE_IDLE_MAX_MS },
    waits: input.waits,
    failed: (error) => input.failed(error, 'scan'),
    wake: input.wake,
  });
  return {
    started: discovery.started,
    async stop() {
      stopped = true;
      const scanning = discovery.stop();
      const live = [...entries.values()];
      // Never clear an unfenced lease: each is stopped, not released.
      for (const entry of live) release(entry);
      await Promise.allSettled([
        scanning,
        ...live.map((entry) => entry.lease.stop()),
        ...live.map((entry) => entry.work),
      ]);
    },
  };
}
