import {
  publicIntervals,
  recordingJobStateSchema,
  type PublicInterval,
  type RecordingBuildProgress,
  type RecordingJobState,
} from '@daisy/protocol';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { broadcasts } from './schema/broadcasts';
import { roundSegments } from './schema/round-segments';
import { recordingCaptures } from './schema/recording-captures';
import { readPovBuilds } from './recording-pov-reads';
import { recordingPovCaptures } from './schema/recording-pov-captures';
import { recordingProcessingJobs as jobs } from './schema/recording-processing-jobs';
import { recordings } from './schema/recordings';

type Tx = BoundedTransactionContext;

const stateColumns = (state: RecordingJobState) => ({
  state: recordingJobStateSchema.parse(state),
  status: state.status,
  updatedAt: sql`clock_timestamp()`,
});

/** Opened at the first Egress. A repeat keeps the first, so its sources stay named. */
export const openRecordingJob = async (
  tx: Tx,
  input: { readonly recordingId: string; readonly holdPrefix: string },
) => {
  await tx
    .insert(jobs)
    .values({
      ...input,
      status: 'waiting',
      state: { status: 'waiting' },
    })
    .onConflictDoNothing({ target: jobs.recordingId });
};

/** Capture ended: the worker may now read this many attempts. Only from `waiting`. */
/** Committed Round history and how far the control plane was heard from, for a build. */
export const readRecordingPublicHistory = async (
  tx: Tx,
  recordingId: string,
) => {
  const [capture] = await tx
    .select({
      roundId: recordings.roundId,
      broadcast: broadcasts.controlHeartbeatAt,
      own: recordingCaptures.controlHeartbeatAt,
    })
    .from(recordings)
    .leftJoin(broadcasts, eq(broadcasts.roundId, recordings.roundId))
    .leftJoin(
      recordingCaptures,
      eq(recordingCaptures.recordingId, recordings.id),
    )
    .where(eq(recordings.id, recordingId));
  if (!capture) return { segments: [], knownThroughMs: null };
  const segments = await tx
    .select({
      startedAt: roundSegments.startedAt,
      endedAt: roundSegments.endedAt,
      durationMs: roundSegments.durationMs,
    })
    .from(roundSegments)
    .where(eq(roundSegments.roundId, capture.roundId))
    .orderBy(asc(roundSegments.sequence));
  return {
    segments: segments.map((segment) => ({
      startedAtMs: segment.startedAt.getTime(),
      endedAtMs: segment.endedAt?.getTime() ?? null,
      durationMs: segment.durationMs,
    })),
    knownThroughMs: (capture.broadcast ?? capture.own)?.getTime() ?? null,
  };
};

/** Absent on a Recording no POV was captured for, which then lists none. */
const povsOf = async (tx: Tx, recordingId: string) => {
  const povs = await readPovBuilds(tx, recordingId);
  return povs.length > 0 ? { povs: [...povs] } : {};
};

export const queueRecordingJob = async (
  tx: Tx,
  input: {
    readonly recordingId: string;
    readonly attemptCount: number;
    readonly publicIntervals: readonly PublicInterval[];
    readonly ceilingMs: number;
  },
) => {
  await tx
    .update(jobs)
    .set({
      ...stateColumns({
        status: 'queued',
        attemptCount: input.attemptCount,
        publicIntervals: [...input.publicIntervals],
        ceilingMs: input.ceilingMs,
        ...(await povsOf(tx, input.recordingId)),
      }),
      dueAt: sql`clock_timestamp()`,
    })
    .where(
      and(eq(jobs.recordingId, input.recordingId), eq(jobs.status, 'waiting')),
    );
};

/**
 * An operator asked for a failed build again. Its count starts over, and false
 * means nothing could be queued: the sources are gone or going.
 */
export const requeueRecordingJob = async (
  tx: Tx,
  input: {
    readonly recordingId: string;
    readonly attemptCount: number;
    readonly ceilingMs: number;
  },
): Promise<boolean> => {
  // History may have grown since the first build, so a rebuild asks it again.
  const history = await readRecordingPublicHistory(tx, input.recordingId);
  const rows = await tx
    .update(jobs)
    .set({
      ...stateColumns({
        status: 'queued',
        attemptCount: input.attemptCount,
        publicIntervals: [
          ...publicIntervals(history.segments, history.knownThroughMs),
        ],
        ceilingMs: input.ceilingMs,
        ...(await povsOf(tx, input.recordingId)),
      }),
      runsStarted: 0,
      dueAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(jobs.recordingId, input.recordingId),
        inArray(jobs.status, ['waiting', 'queued', 'built', 'failed']),
      ),
    )
    .returning({ id: jobs.recordingId });
  return rows.length === 1;
};

/**
 * The next job with work: the oldest due whose lease is free. The epoch fences the
 * last owner. The run counts here and comes due again at `retryAtOf`, so one whose
 * process dies before it can say so still spends an attempt and still backs off.
 */
export const claimRecordingJob = async (
  tx: Tx,
  input: {
    readonly owner: string;
    readonly now: Date;
    readonly leaseUntil: Date;
    readonly retryAtOf: (runsStarted: number) => Date;
  },
) => {
  const [free] = await tx
    .select({ id: jobs.recordingId, runsStarted: jobs.runsStarted })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ['queued', 'discarding']),
        lte(jobs.dueAt, input.now),
        or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, input.now)),
      ),
    )
    .orderBy(asc(jobs.dueAt))
    .limit(1)
    .for('update', { skipLocked: true });
  if (!free) return null;
  const [claimed] = await tx
    .update(jobs)
    .set({
      leaseOwner: input.owner,
      leaseUntil: input.leaseUntil,
      leaseEpoch: sql`${jobs.leaseEpoch} + 1`,
      runsStarted: free.runsStarted + 1,
      dueAt: input.retryAtOf(free.runsStarted + 1),
    })
    .where(eq(jobs.recordingId, free.id))
    .returning();
  return claimed!;
};

type Held = {
  readonly recordingId: string;
  readonly owner: string;
  readonly epoch: number;
};

const held = ({ recordingId, owner, epoch }: Held) =>
  and(
    eq(jobs.recordingId, recordingId),
    eq(jobs.leaseOwner, owner),
    eq(jobs.leaseEpoch, epoch),
  );

/**
 * Keeps the job while ffmpeg runs. Null means another worker owns it or its
 * state moved under this run (the web asked to discard), so the run must stop.
 */
export const renewRecordingJob = async (
  tx: Tx,
  input: Held & {
    readonly expected: RecordingJobState['status'];
    readonly leaseUntil: Date;
  },
) => {
  const [row] = await tx
    .update(jobs)
    .set({ leaseUntil: input.leaseUntil })
    .where(and(held(input), eq(jobs.status, input.expected)))
    .returning({ id: jobs.recordingId });
  return row !== undefined;
};

/**
 * How far this run is, only for the current owner of a job still queued, so a
 * former owner cannot overwrite the current run's figures. It moves no `updated_at`:
 * nothing is waiting on it.
 */
export const recordRecordingBuildProgress = async (
  tx: Tx,
  input: Held & { readonly progress: RecordingBuildProgress },
) => {
  await tx
    .update(jobs)
    .set({
      state: sql`${jobs.state} || jsonb_build_object('progress', ${JSON.stringify(input.progress)}::text::jsonb)`,
    })
    .where(and(held(input), eq(jobs.status, 'queued')));
};

/** A run's result, only for the current owner of a job still in the state it read. */
export const finishRecordingRun = async (
  tx: Tx,
  input: Held & {
    readonly expected: RecordingJobState['status'];
    readonly state: RecordingJobState;
  },
) => {
  const rows = await tx
    .update(jobs)
    .set({
      ...stateColumns(input.state),
      leaseOwner: null,
      leaseUntil: null,
      dueAt: null,
    })
    .where(and(held(input), eq(jobs.status, input.expected)))
    .returning({ id: jobs.recordingId });
  return rows.length === 1;
};

/**
 * A run that did not finish: the state stays, and it comes due again later. The
 * claim already counted it; one that did not fail, a shutdown, gives its run back.
 */
export const deferRecordingRun = async (
  tx: Tx,
  input: Held & { readonly retryAt: Date; readonly failed: boolean },
) => {
  const rows = await tx
    .update(jobs)
    .set({
      // Its figures are over: a job waiting for its retry is not at them.
      state: sql`${jobs.state} - 'progress'`,
      leaseOwner: null,
      leaseUntil: null,
      dueAt: input.retryAt,
      ...(input.failed
        ? {}
        : { runsStarted: sql`greatest(${jobs.runsStarted} - 1, 0)` }),
    })
    .where(held(input))
    .returning({ runsStarted: jobs.runsStarted });
  return rows[0]?.runsStarted ?? null;
};

/**
 * The jobs the web has something to answer about, with the Recording's state and
 * whether a Broadcast or an own Egress may still be using the sources. A settled
 * job, a discard under way, and pairs that are waiting on someone else are left
 * out, so they cannot crowd out the jobs behind them.
 */
export const listUnsettledRecordingJobs = (
  tx: Tx,
  limit: number,
  after: string | null = null,
) =>
  tx
    .select({
      recordingId: jobs.recordingId,
      state: jobs.state,
      lifecycle: recordings.lifecycle,
      sourcesInUse: sql<boolean>`(
        exists (select 1 from ${broadcasts}
          where ${broadcasts.roundId} = ${recordings.roundId}
            and ${broadcasts.completedAt} is null
            and ${broadcasts.stoppedAt} is null)
        or exists (select 1 from ${recordingCaptures}
          where ${recordingCaptures.recordingId} = ${recordings.id}
            and ${recordingCaptures.endedAt} is null)
        or exists (select 1 from ${recordingPovCaptures}
          where ${recordingPovCaptures.recordingId} = ${recordings.id}
            and ${recordingPovCaptures.endedAt} is null)
      )`,
      povsOpen: sql<boolean>`exists (select 1 from ${recordingPovCaptures}
        where ${recordingPovCaptures.recordingId} = ${recordings.id}
          and ${recordingPovCaptures.endedAt} is null)`,
    })
    .from(jobs)
    .innerJoin(recordings, eq(recordings.id, jobs.recordingId))
    .where(
      and(
        notInArray(jobs.status, ['settled', 'discarding']),
        notInArray(recordings.status, [
          'requested',
          'capturing',
          'taken_down',
          'failed',
        ]),
        not(
          and(eq(jobs.status, 'queued'), eq(recordings.status, 'processing'))!,
        ),
        after === null ? undefined : gt(jobs.recordingId, after),
      ),
    )
    .orderBy(asc(jobs.recordingId))
    .limit(limit);

/**
 * The web tells the worker the sources can go. It also fences a running build:
 * the status has moved, so that run's renewal and result are both refused.
 */
export const discardRecordingSources = async (tx: Tx, recordingId: string) => {
  await tx
    .update(jobs)
    .set({
      ...stateColumns({ status: 'discarding' }),
      dueAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(jobs.recordingId, recordingId),
        ne(jobs.status, 'discarding'),
        ne(jobs.status, 'settled'),
      ),
    );
};

/**
 * Recordings still processing that no operator has yet been alerted about, with
 * what the bound is measured from. A build running long is the point, so unlike
 * `listUnsettledRecordingJobs` this includes the queued.
 */
export const listProcessingRecordingsUnalerted = (
  tx: Tx,
  limit: number,
  after: string | null = null,
) =>
  tx
    .select({ id: recordings.id, lifecycle: recordings.lifecycle })
    .from(recordings)
    .innerJoin(jobs, eq(jobs.recordingId, recordings.id))
    .where(
      and(
        eq(recordings.status, 'processing'),
        isNull(jobs.delayAlertedAt),
        after === null ? undefined : gt(recordings.id, after),
      ),
    )
    .orderBy(asc(recordings.id))
    .limit(limit);

/** True for the one caller that gets to raise the alert, whoever else is sweeping. */
export const markRecordingDelayAlerted = async (
  tx: Tx,
  input: { readonly recordingId: string; readonly at: Date },
): Promise<boolean> => {
  const rows = await tx
    .update(jobs)
    .set({ delayAlertedAt: input.at })
    .where(
      and(eq(jobs.recordingId, input.recordingId), isNull(jobs.delayAlertedAt)),
    )
    .returning({ id: jobs.recordingId });
  return rows.length === 1;
};

/** The job's state, as the web reads it to say how far preparation is. */
export const readRecordingJobState = async (
  tx: Tx,
  recordingId: string,
): Promise<RecordingJobState | null> => {
  const [row] = await tx
    .select({ state: jobs.state })
    .from(jobs)
    .where(eq(jobs.recordingId, recordingId));
  return row?.state ?? null;
};

/** Whether anything of this Recording may still wait in the hold bucket. */
export const recordingSourcesRemain = async (tx: Tx, recordingId: string) => {
  const [row] = await tx
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.recordingId, recordingId));
  return row !== undefined && row.status !== 'settled';
};
