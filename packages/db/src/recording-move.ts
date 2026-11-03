import {
  recordingLifecycleSchema,
  type RecordingClass,
  type RecordingEligibility,
  type RecordingLifecycle,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';

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

type Row = {
  readonly id: string;
  readonly round_id: string;
  readonly recording_class: RecordingClass;
  readonly eligibility: RecordingEligibility;
  readonly lifecycle: unknown;
  readonly version: number;
};

const storedRow = (row: Row): StoredRecording => ({
  id: row.id,
  roundId: row.round_id,
  class: row.recording_class,
  eligibility: row.eligibility,
  lifecycle: recordingLifecycleSchema.parse(row.lifecycle),
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

/**
 * The one way a Recording's lifecycle is written: the caller's pure decision under
 * the row lock, in the caller's transaction, so racing operations serialize and
 * each sees the last one's result. Only a move writes. A named version that no
 * longer holds answers `stale` before the decision runs.
 */
export const moveRecording = async <Decision extends RecordingDecision>(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  id: string,
  decide: (record: StoredRecording) => Decision,
  expectedVersion?: number,
) => {
  const [row] = (await tx.execute(
    sql`select ${COLUMNS} from recordings where id=${id} for update`,
  )) as unknown as Row[];
  if (!row) return { kind: 'missing' } as const;
  const record = storedRow(row);
  if (expectedVersion !== undefined && row.version !== expectedVersion)
    return { kind: 'stale', record } as const;
  const transition = decide(record);
  if (transition.kind !== 'moved')
    return { kind: 'decided', record, transition } as const;
  const [updated] = (await tx.execute(
    written(id, transition.next),
  )) as unknown as Row[];
  return {
    kind: 'decided',
    record: storedRow(updated!),
    transition,
  } as const;
};
