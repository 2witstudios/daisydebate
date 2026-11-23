import {
  contentReportStatuses,
  contentReportTargetKinds,
} from '@daisy/protocol/content-moderation';
import { listedWord } from './lifecycle-sql';
import {
  recordingLifecycleSchema,
  recordingEligibilitySchema,
  recordingClasses,
  type RecordingClass,
  type RecordingEligibility,
  type RecordingLifecycle,
} from '@daisy/protocol/recording';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

export type StoredRecording = {
  readonly id: string;
  readonly roundId: string;
  readonly class: RecordingClass;
  readonly eligibility: RecordingEligibility;
  readonly lifecycle: RecordingLifecycle;
  readonly version: number;
};

/** The decision the caller runs under the lock; the store knows no rules. */
export type RecordingDecision =
  | { readonly kind: 'moved'; readonly next: RecordingLifecycle }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string };

const recordingRow = z.object({
  id: z.string(),
  round_id: z.string(),
  recording_class: z.enum(recordingClasses),
  eligibility: recordingEligibilitySchema,
  lifecycle: recordingLifecycleSchema,
  version: z.int(),
});
type Row = z.output<typeof recordingRow>;

const storedRow = (row: Row): StoredRecording => ({
  id: row.id,
  roundId: row.round_id,
  class: row.recording_class,
  eligibility: row.eligibility,
  lifecycle: row.lifecycle,
  version: row.version,
});

const COLUMNS = sql.raw(
  'id, round_id, recording_class, eligibility, lifecycle, version',
);

/** A row's lifecycle written with its tag, and a new deletion intent due at once. */
const written = (id: string, next: RecordingLifecycle) => {
  const lifecycle = JSON.stringify(recordingLifecycleSchema.parse(next));
  const deletion =
    next.status === 'removing'
      ? sql`, deletion_due_at=${next.requestedAt}::timestamptz, deletion_attempts=0`
      : next.status === 'removed'
        ? sql`, deletion_due_at=null, lease_owner=null, lease_until=null`
        : sql``;
  return sql`update recordings set lifecycle=${lifecycle}::text::jsonb,
      status=${next.status}, version=version+1, updated_at=clock_timestamp()${deletion}
    where id=${id} returning ${COLUMNS}`;
};

/** Whether an open report names this Recording or its Round: it is evidence until decided. */
export const recordingUnderOpenReport = async (
  tx: Tx,
  id: string,
): Promise<boolean> => {
  const [row] = await query(
    tx,
    z.object({ reported: z.boolean() }),
    sql`select exists(
      select 1 from recordings rec join content_reports c on c.status=${listedWord(contentReportStatuses, 'open')} and (
        (c.target_kind=${listedWord(contentReportTargetKinds, 'recording')} and c.target_id=rec.id)
        or (c.target_kind=${listedWord(contentReportTargetKinds, 'round')} and c.target_id=rec.round_id))
      where rec.id=${id}) as reported`,
  );
  return row?.reported ?? false;
};

/**
 * The one way a Recording's lifecycle is written: the caller's pure decision under
 * the row lock, in the caller's transaction, so racing operations serialize and
 * each sees the last one's result. Only a move writes. A named version that no
 * longer holds answers `stale` before the decision runs.
 */
export const moveRecording = async <Decision extends RecordingDecision>(
  tx: Tx,
  id: string,
  decide: (record: StoredRecording) => Decision,
  expectedVersion?: number,
) => {
  const [row] = await query(
    tx,
    recordingRow,
    sql`select ${COLUMNS} from recordings where id=${id} for update`,
  );
  if (!row) return { kind: 'missing' } as const;
  const record = storedRow(row);
  if (expectedVersion !== undefined && row.version !== expectedVersion)
    return { kind: 'stale', record } as const;
  const transition = decide(record);
  if (transition.kind !== 'moved')
    return { kind: 'decided', record, transition } as const;
  const [updated] = await query(tx, recordingRow, written(id, transition.next));
  if (!updated) throw new Error('Moved recording is missing');
  return {
    kind: 'decided',
    record: storedRow(updated),
    transition,
  } as const;
};
