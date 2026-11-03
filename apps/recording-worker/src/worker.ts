import type { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import type {
  PublicInterval,
  RecordingBuildProgress,
  RecordingJobState,
} from '@daisy/protocol';
import { RecordingVerificationError } from './build-recording';

const LEASE_MS = 60_000;
const RENEW_MS = 15_000;
const IDLE_MS = 2000;
const FIRST_RETRY_MS = 60_000;
const LONGEST_RETRY_MS = 60 * 60_000;
/** After this many failed runs a build is reported failed; a discard never gives up. */
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

export const retryDelayMs = (failures: number): number =>
  Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1));

/** What a build that threw means now: try again later, or say it could not be done. */
export const afterBuildFailure = (
  failures: number,
  error: unknown,
  at: string,
): Extract<RecordingJobState, { status: 'failed' }> | null =>
  failures < BUILD_ATTEMPTS
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
 * lease runs out, another slot takes the job and repeats it to the same keys. A
 * job the web moved to discarding stops the build it is running at the next renewal.
 */
export const runWorker = async (deps: {
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
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly report: (event: WorkerEvent) => void;
}) => {
  const { store, owner } = deps;
  const iso = () => new Date(deps.now()).toISOString();

  /**
   * Keeps the lease until released, and aborts the moment the job is no longer
   * ours: fenced, moved to discarding, or this process stopping. A run past its
   * ceiling aborts too, marked as overrun: that one counts as a failed attempt.
   */
  const holdLease = (job: Claimed, ceilingMs?: number) => {
    const lost = new AbortController();
    const startedAtMs = deps.now();
    let released = false;
    let overran = false;
    void (async () => {
      while (!released) {
        await deps.sleep(RENEW_MS);
        if (released) return;
        if (ceilingMs !== undefined && deps.now() - startedAtMs > ceilingMs) {
          overran = true;
          lost.abort();
          return;
        }
        const ours =
          !deps.stopped() &&
          (await store
            .renew({
              recordingId: job.recordingId,
              owner,
              epoch: job.leaseEpoch,
              expected: job.status,
              leaseUntil: new Date(deps.now() + LEASE_MS),
            })
            // A blip is not a lost lease: the next renewal decides.
            .catch(() => true));
        if (!ours) {
          lost.abort();
          return;
        }
      }
    })();
    return {
      signal: lost.signal,
      overran: () => overran,
      release: () => {
        released = true;
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
        deps.now() + (failed ? retryDelayMs(job.failures + 1) : 0),
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
    ceilingMs?: number,
  ) => {
    const workDir = deps.workDirOf(job.recordingId, owner);
    const lease = holdLease(job, ceilingMs);
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
      // A job taken away or a shutdown is nobody's failure: no backoff, no report.
      else if (lease.signal.aborted || deps.stopped()) {
        await defer(job, false);
        return;
      }
      deps.report('recording.processing_failed');
      const gaveUp = afterBuildFailure(job.failures + 1, error, iso());
      if (gaveUp) {
        deps.report('recording.processing_gave_up');
        await finish(job, gaveUp);
      } else await defer(job, true);
    } finally {
      lease.release();
      await deps.removeWorkDir(workDir);
    }
  };

  const runStrip = async (
    job: Claimed,
    intervals: readonly PublicInterval[],
  ) => {
    const lease = holdLease(job);
    try {
      await deps.strip(job.holdPrefix, intervals);
      await finish(job, { status: 'stripped', strippedAt: iso() });
    } catch {
      deps.report('recording.source_discard_failed');
      await defer(job, true);
    } finally {
      lease.release();
    }
  };

  const runDiscard = async (job: Claimed) => {
    const lease = holdLease(job);
    try {
      while ((await deps.discardPage(job.holdPrefix)) > 0)
        if (lease.signal.aborted) return;
      await finish(job, { status: 'settled', settledAt: iso() });
    } catch {
      deps.report('recording.source_discard_failed');
      await defer(job, true);
    } finally {
      lease.release();
    }
  };

  while (!deps.stopped()) {
    // A database blip must not end this slot: report it and try again.
    const job = await store
      .claim({
        owner,
        now: new Date(deps.now()),
        leaseUntil: new Date(deps.now() + LEASE_MS),
      })
      .catch(() => {
        deps.report('recording.processing_failed');
        return null;
      });
    if (!job) {
      await deps.sleep(IDLE_MS);
      continue;
    }
    const { state } = job;
    await (
      state.status === 'queued'
        ? runBuild(
            job,
            state.attemptCount,
            state.publicIntervals,
            state.ceilingMs,
          )
        : state.status === 'stripping'
          ? runStrip(job, state.publicIntervals)
          : runDiscard(job)
    ).catch(() => deps.report('recording.processing_failed'));
  }
};
