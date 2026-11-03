import {
  recordingJobStateSchema,
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
import { recordingCaptures } from './schema/recording-captures';
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
/**
 * Every lapse over the sources of this Recording, from whichever capture wrote
 * them. The Recording worker's database role reaches only its jobs, so the web
 * copies them here: capture has ended by now, and a returning control plane has
 * already recorded any lapse before it gets this far.
 */
const readRecordingLapses = async (tx: Tx, recordingId: string) => {
  const [row] = await tx
    .select({
      broadcast: broadcasts.controlLapses,
      own: recordingCaptures.controlLapses,
    })
    .from(recordings)
    .leftJoin(broadcasts, eq(broadcasts.roundId, recordings.roundId))
    .leftJoin(
      recordingCaptures,
      eq(recordingCaptures.recordingId, recordings.id),
    )
    .where(eq(recordings.id, recordingId));
  return [...(row?.broadcast?.lapses ?? []), ...(row?.own?.lapses ?? [])];
};

export const queueRecordingJob = async (
  tx: Tx,
  input: { readonly recordingId: string; readonly attemptCount: number },
) => {
  await tx
    .update(jobs)
    .set({
      ...stateColumns({
        status: 'queued',
        attemptCount: input.attemptCount,
        controlLapses: await readRecordingLapses(tx, input.recordingId),
      }),
      dueAt: sql`clock_timestamp()`,
    })
    .where(
      and(eq(jobs.recordingId, input.recordingId), eq(jobs.status, 'waiting')),
    );
};

/** The next job with work: the oldest due whose lease is free. The epoch fences the last owner. */
export const claimRecordingJob = async (
  tx: Tx,
  input: {
    readonly owner: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  },
) => {
  const [free] = await tx
    .select({ id: jobs.recordingId })
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

/** A run that failed to finish: the state stays, and it comes due again later. */
export const deferRecordingRun = async (
  tx: Tx,
  input: Held & { readonly retryAt: Date; readonly failed: boolean },
) => {
  const rows = await tx
    .update(jobs)
    .set({
      leaseOwner: null,
      leaseUntil: null,
      dueAt: input.retryAt,
      ...(input.failed ? { failures: sql`${jobs.failures} + 1` } : {}),
    })
    .where(held(input))
    .returning({ failures: jobs.failures });
  return rows[0]?.failures ?? null;
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
      )`,
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

/** Whether anything of this Recording may still wait in the hold bucket. */
export const recordingSourcesRemain = async (tx: Tx, recordingId: string) => {
  const [row] = await tx
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.recordingId, recordingId));
  return row !== undefined && row.status !== 'settled';
};
