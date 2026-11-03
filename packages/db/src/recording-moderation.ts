import { createAppError } from '@daisy/errors';
import {
  capturedMediaMs,
  recordingBuildCeilingMs,
  recordingLifecycleSchema,
  transitionRecording,
  type RecordingTransition,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { RecordingModeration } from './content-moderation-ports';
import { inLiveRoomSql, liveRoomOfR } from './live-room-sql';
import { moveRecording, recordingUnderOpenReport } from './recording-move';
import { requeueRecordingJob } from './recording-processing-operations';

type ReportRow = {
  readonly competition_type: string;
  readonly round_id: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly audience_link_hash: string | null;
  readonly reporter_seated: boolean;
  readonly in_live_room: boolean;
};

type Moved = Awaited<ReturnType<typeof moveRecording<RecordingTransition>>>;

/** A moved Recording answers as a command does; a version gone stale is refused. */
const outcomeOf = (applied: Moved, whenRefused: 'unchanged' | 'conflict') => {
  if (applied.kind === 'missing') return null;
  if (applied.kind === 'stale') throw createAppError('CONFLICT');
  switch (applied.transition.kind) {
    case 'moved':
      return 'applied';
    case 'unchanged':
      return 'unchanged';
    case 'refused':
      if (whenRefused === 'unchanged') return 'unchanged';
      throw createAppError('CONFLICT');
  }
};

/**
 * Moderation's reach into Recording (WATCH-7, REC-1.5). Each runs in the command's
 * transaction, through the Recording's one transition under its row lock. A
 * takedown keeps a ready Recording's media to restore, and every read of it then
 * answers as removed.
 */
export const recordingModeration: RecordingModeration = {
  readReportFacts: async (tx, input) => {
    const rows = await tx.execute(sql`
      select r.competition_type, r.id as round_id, r.visibility, r.audience_link_hash,
        exists(select 1 from round_participants p
          where p.round_id=r.id and p.actor_id=${input.reporterActorId}) as reporter_seated,
        ${inLiveRoomSql(liveRoomOfR, input.reporterActorId)} as in_live_room
      from recordings rec join rounds r on r.id=rec.round_id
      where rec.id=${input.recordingId}`);
    const [row] = rows as unknown as ReportRow[];
    return row
      ? {
          ranked: row.competition_type === 'ranked',
          reporterSeated: row.reporter_seated,
          audience: {
            roundId: row.round_id,
            visibility: row.visibility,
            audienceLinkHash: row.audience_link_hash,
            inLiveRoom: row.in_live_room,
          },
        }
      : null;
  },
  readSubject: async (tx, recordingId) => {
    const [row] = (await tx.execute(
      sql`select lifecycle, version, recording_class from recordings where id=${recordingId}`,
    )) as unknown as {
      readonly lifecycle: unknown;
      readonly version: number;
      readonly recording_class: string;
    }[];
    if (!row) return null;
    const lifecycle = recordingLifecycleSchema.parse(row.lifecycle);
    const heldAsEvidence =
      lifecycle.status === 'taken_down' && lifecycle.removalOwed !== undefined;
    return {
      status: lifecycle.status,
      version: row.version,
      restorable:
        lifecycle.status === 'taken_down' &&
        lifecycle.held !== null &&
        !heldAsEvidence,
      removable:
        lifecycle.status === 'taken_down' &&
        !heldAsEvidence &&
        !(await recordingUnderOpenReport(tx, recordingId)),
      rebuildable:
        lifecycle.status === 'failed' &&
        lifecycle.capture !== undefined &&
        row.recording_class === 'ranked',
      takedownReason:
        lifecycle.status === 'taken_down' ? (lifecycle.reason ?? null) : null,
    };
  },
  takeDown: async (tx, input) =>
    outcomeOf(
      await moveRecording(
        tx,
        input.recordingId,
        (record) =>
          transitionRecording(record, {
            type: 'taken_down',
            at: input.now.toISOString(),
            reason: input.reason,
          }),
        input.expectedVersion,
      ),
      // A removal already under way stands.
      'unchanged',
    ),
  restore: async (tx, input) =>
    outcomeOf(
      await moveRecording(
        tx,
        input.recordingId,
        (record) => transitionRecording(record, { type: 'restored' }),
        input.expectedVersion,
      ),
      'conflict',
    ),
  remove: async (tx, input) => {
    const underOpenReport = await recordingUnderOpenReport(
      tx,
      input.recordingId,
    );
    const at = input.now.toISOString();
    return outcomeOf(
      await moveRecording(
        tx,
        input.recordingId,
        (record) =>
          transitionRecording(record, {
            type: 'removal_requested',
            cause: 'moderation',
            at,
            ...(underOpenReport ? { evidenceHeldUntil: at } : {}),
          }),
        input.expectedVersion,
      ),
      'conflict',
    );
  },
  legallyRemove: async (tx, input) =>
    outcomeOf(
      await moveRecording(
        tx,
        input.recordingId,
        (record) =>
          transitionRecording(record, {
            type: 'removal_requested',
            cause: 'legal_removal',
            at: input.now.toISOString(),
          }),
        input.expectedVersion,
      ),
      'conflict',
    ),
  rebuild: async (tx, input) => {
    const applied = await moveRecording(
      tx,
      input.recordingId,
      (record) => transitionRecording(record, { type: 'rebuild_requested' }),
      input.expectedVersion,
    );
    if (
      applied.kind === 'decided' &&
      applied.transition.kind === 'moved' &&
      applied.record.lifecycle.status === 'processing'
    ) {
      const { capture } = applied.record.lifecycle;
      const queued = await requeueRecordingJob(tx, {
        recordingId: input.recordingId,
        attemptCount: capture.attempts.at(-1)?.attempt ?? 0,
        ceilingMs: recordingBuildCeilingMs(capturedMediaMs(capture)),
      });
      // Thrown, so the Recording does not stay processing with nothing to build.
      if (!queued) throw createAppError('CONFLICT');
    }
    return outcomeOf(applied, 'conflict');
  },
  listRebuildable: async (tx, limit) => {
    const rows = (await tx.execute(sql`select id, round_id, version, lifecycle
      from recordings
      where status='failed' and recording_class='ranked' and lifecycle ? 'capture'
      order by updated_at, id limit ${limit}`)) as unknown as {
      readonly id: string;
      readonly round_id: string;
      readonly version: number;
      readonly lifecycle: unknown;
    }[];
    return rows.flatMap((row) => {
      const lifecycle = recordingLifecycleSchema.parse(row.lifecycle);
      return lifecycle.status === 'failed'
        ? [
            {
              recordingId: row.id,
              roundId: row.round_id,
              reason: lifecycle.reason,
              failedAt: lifecycle.failedAt,
              version: row.version,
            },
          ]
        : [];
    });
  },
  readBroadcastId: async (tx, recordingId) => {
    const [row] = (await tx.execute(sql`select b.id from broadcasts b
      join recordings rec on rec.round_id=b.round_id
      where rec.id=${recordingId}`)) as unknown as { readonly id: string }[];
    return row?.id ?? null;
  },
};
