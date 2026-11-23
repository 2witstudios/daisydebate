import { deadlineSignal, type Waits } from '@daisy/clock';
import type { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import type { PublicInterval } from '@daisy/protocol/public-interval';
import type {
  RecordingBuildProgress,
  RecordingJobState,
} from '@daisy/protocol/recording-processing';
import { holdLease, pollWork } from '@daisy/worker';
import { RecordingVerificationError } from './build-recording';

const LEASE_MS = 60_000;
const RENEW_MS = 15_000;
const IDLE_MS = 2000;
/** An idle slot polls for a claim at most this rarely; a failing store backs off to it too. */
const IDLE_MAX_MS = 10_000;
const FIRST_RETRY_MS = 60_000;
const LONGEST_RETRY_MS = 60 * 60_000;
/** After this many runs a build is reported failed; a discard never gives up. */
const BUILD_ATTEMPTS = 5;
const PROGRESS_EVERY_MS = 5000;

type Store = ReturnType<typeof createRecordingWorkerStore>;
type Claimed = NonNullable<Awaited<ReturnType<Store['claim']>>>;

export type WorkerEvent =
  | 'recording.processing_failed'
  | 'recording.build_ceiling_exceeded'
  | 'recording.processing_gave_up'
  | 'recording.source_discard_failed';

/** A new step is news at once; within a step, often enough to show it moving. */
export const progressIsNews = (
  last: { readonly step: string; readonly atMs: number } | null,
  step: string,
  atMs: number,
): boolean =>
  last === null || last.step !== step || atMs - last.atMs >= PROGRESS_EVERY_MS;

const rejectedOnAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    });
  });

export const retryDelayMs = (runs: number): number =>
  Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, runs - 1));

/** What a build that threw means now: try again later, or say it could not be done. */
export const afterBuildFailure = (
  runs: number,
  error: unknown,
  at: string,
): Extract<RecordingJobState, { status: 'failed' }> | null =>
  runs < BUILD_ATTEMPTS
    ? null
    : {
        status: 'failed',
        reason:
          error instanceof RecordingVerificationError
            ? 'verification_failed'
            : 'processing_failed',
        failedAt: at,
      };

/**
 * One slot: claims a job, keeps its lease while it runs, and writes the result
 * only if it still owns the job in the state it read. A crash loses nothing: the
 * lease runs out, another slot takes the job and repeats it to the same keys. The
 * claim counts the run and sets when it comes due if it dies, so a build that kills
 * its process runs out of attempts as one that throws does. A job the web moved to
 * discarding stops the build it is running at the next renewal.
 */
export const startRecordingSlot = (deps: {
  readonly owner: string;
  readonly store: Pick<
    Store,
    'claim' | 'renew' | 'finish' | 'defer' | 'recordProgress'
  >;
  readonly build: (
    job: {
      readonly recordingId: string;
      readonly holdPrefix: string;
      readonly attemptCount: number;
      readonly publicIntervals: readonly PublicInterval[];
    },
    run: {
      readonly workDir: string;
      readonly signal: AbortSignal;
      readonly progress: (progress: RecordingBuildProgress) => void;
    },
  ) => Promise<RecordingJobState>;
  /** One bounded page of deletes; zero means the prefix lists empty. */
  readonly discardPage: (prefix: string) => Promise<number>;
  /** A failed Recording's hold cut to what history proves public. */
  readonly strip: (
    holdPrefix: string,
    intervals: readonly PublicInterval[],
  ) => Promise<void>;
  readonly workDirOf: (recordingId: string, owner: string) => string;
  readonly removeWorkDir: (path: string) => Promise<void>;
  /** Wall-clock milliseconds, for the instants the store records. */
  readonly now: () => number;
  /** Monotonic time and waits: the slot's pacing, its lease and a run's ceiling. */
  readonly waits: Waits;
  readonly report: (event: WorkerEvent) => void;
}) => {
  const { store, owner } = deps;
  const iso = () => new Date(deps.now()).toISOString();

  /**
   * Keeps the lease until released, and aborts the moment the job is no longer
   * ours: fenced or moved to discarding (a renewal that finds it so), lapsed
   * (no renewal held within the lease), or this slot stopping. A run past its
   * ceiling aborts too, marked as overrun: that one counts as a failed attempt.
   */
  const leaseOf = (
    job: Claimed,
    stop: AbortSignal,
    claimedAtMs: number,
    ceilingMs?: number,
  ) => {
    const lease = holdLease({
      waits: deps.waits,
      facts: undefined,
      claimedAtMs,
      renewEveryMs: RENEW_MS,
      retryMs: RENEW_MS,
      horizonMs: LEASE_MS,
      renew: async () =>
        (await store.renew({
          recordingId: job.recordingId,
          owner,
          epoch: job.leaseEpoch,
          expected: job.status,
          leaseUntil: new Date(deps.now() + LEASE_MS),
        }))
          ? { kind: 'held', facts: undefined }
          : { kind: 'lost', reason: 'taken' },
      // A blip is not a lost lease: the lease holds until it would lapse.
      failed: () => undefined,
    });
    const ceiling =
      ceilingMs === undefined ? null : deadlineSignal(deps.waits, ceilingMs);
    return {
      signal: AbortSignal.any([
        lease.signal,
        stop,
        ...(ceiling ? [ceiling.signal] : []),
      ]),
      overran: () => ceiling?.signal.aborted ?? false,
      /** The store's finish or defer hands the job back; the lease is only stopped. */
      release: async () => {
        ceiling?.clear();
        await lease.stop();
      },
    };
  };

  const finish = (job: Claimed, state: RecordingJobState) =>
    store.finish({
      recordingId: job.recordingId,
      owner,
      epoch: job.leaseEpoch,
      expected: job.status,
      state,
    });

  const defer = (job: Claimed, failed: boolean) =>
    store.defer({
      recordingId: job.recordingId,
      owner,
      epoch: job.leaseEpoch,
      retryAt: new Date(
        deps.now() + (failed ? retryDelayMs(job.runsStarted) : 0),
      ),
      failed,
    });

  /**
   * Writes a build's figures one at a time, at most every few seconds within a step.
   * A write that fails is dropped: the next one says more, and the build goes on.
   */
  const progressWriter = (job: Claimed) => {
    let written: { step: string; atMs: number } | null = null;
    let writing: Promise<unknown> = Promise.resolve();
    return (progress: RecordingBuildProgress) => {
      const atMs = deps.now();
      if (!progressIsNews(written, progress.step, atMs)) return;
      written = { step: progress.step, atMs };
      writing = writing
        .then(() =>
          store.recordProgress({
            recordingId: job.recordingId,
            owner,
            epoch: job.leaseEpoch,
            progress,
          }),
        )
        .catch(() => undefined);
    };
  };

  const runBuild = async (
    job: Claimed,
    attemptCount: number,
    intervals: readonly PublicInterval[],
    stop: AbortSignal,
    claimedAtMs: number,
    ceilingMs?: number,
  ) => {
    // Every attempt started and none answered: the last one died with its process.
    if (job.runsStarted > BUILD_ATTEMPTS) {
      deps.report('recording.processing_gave_up');
      await finish(job, {
        status: 'failed',
        reason: 'processing_failed',
        failedAt: iso(),
      });
      return;
    }
    const workDir = deps.workDirOf(job.recordingId, owner);
    const lease = leaseOf(job, stop, claimedAtMs, ceilingMs);
    try {
      const state = await Promise.race([
        deps.build(
          {
            recordingId: job.recordingId,
            holdPrefix: job.holdPrefix,
            attemptCount,
            publicIntervals: intervals,
          },
          { workDir, signal: lease.signal, progress: progressWriter(job) },
        ),
        // What ffmpeg cannot be told, such as an upload: the run still stops here.
        rejectedOnAbort(lease.signal),
      ]);
      await finish(job, state);
    } catch (error) {
      if (lease.overran()) deps.report('recording.build_ceiling_exceeded');
      // A job taken away or a shutdown is nobody's failure: its run is given back.
      else if (lease.signal.aborted) {
        await defer(job, false);
        return;
      }
      deps.report('recording.processing_failed');
      const gaveUp = afterBuildFailure(job.runsStarted, error, iso());
      if (gaveUp) {
        deps.report('recording.processing_gave_up');
        await finish(job, gaveUp);
      } else await defer(job, true);
    } finally {
      await lease.release();
      await deps.removeWorkDir(workDir);
    }
  };

  const runStrip = async (
    job: Claimed,
    intervals: readonly PublicInterval[],
    stop: AbortSignal,
    claimedAtMs: number,
  ) => {
    const lease = leaseOf(job, stop, claimedAtMs);
    try {
      await deps.strip(job.holdPrefix, intervals);
      await finish(job, { status: 'stripped', strippedAt: iso() });
    } catch {
      deps.report('recording.source_discard_failed');
      await defer(job, true);
    } finally {
      await lease.release();
    }
  };

  const runDiscard = async (
    job: Claimed,
    stop: AbortSignal,
    claimedAtMs: number,
  ) => {
    const lease = leaseOf(job, stop, claimedAtMs);
    try {
      while ((await deps.discardPage(job.holdPrefix)) > 0)
        if (lease.signal.aborted) return;
      await finish(job, { status: 'settled', settledAt: iso() });
    } catch {
      deps.report('recording.source_discard_failed');
      await defer(job, true);
    } finally {
      await lease.release();
    }
  };

  return pollWork({
    waits: deps.waits,
    backoff: { busyMs: IDLE_MS, idleMaxMs: IDLE_MAX_MS },
    // A database blip must not end this slot: the pass fails, is reported, and backs off.
    pass: async (stop) => {
      const claimedAtMs = deps.waits.nowMs();
      const job = await store.claim({
        owner,
        now: new Date(deps.now()),
        leaseUntil: new Date(deps.now() + LEASE_MS),
        retryAtOf: (runs) => new Date(deps.now() + retryDelayMs(runs)),
      });
      if (!job) return 'idle';
      const { state } = job;
      await (
        state.status === 'queued'
          ? runBuild(
              job,
              state.attemptCount,
              state.publicIntervals,
              stop,
              claimedAtMs,
              state.ceilingMs,
            )
          : state.status === 'stripping'
            ? runStrip(job, state.publicIntervals, stop, claimedAtMs)
            : runDiscard(job, stop, claimedAtMs)
      ).catch(() => deps.report('recording.processing_failed'));
      return 'worked';
    },
    failed: () => deps.report('recording.processing_failed'),
  });
};
