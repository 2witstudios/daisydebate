import type { RecordingClass, RecordingEligibility } from '@daisy/protocol';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { endRoundFeed } from './broadcast-operations';
import { openRecordingJobIfEgressRecorded } from './recording-processing-operations';
import {
  moveRecording,
  recordingUnderOpenReport,
  type RecordingDecision,
  type StoredRecording,
} from './recording-move';
import { recordings } from './schema/recordings';

const stored = (row: typeof recordings.$inferSelect): StoredRecording => ({
  id: row.id,
  roundId: row.roundId,
  class: row.recordingClass,
  eligibility: row.eligibility,
  lifecycle: row.lifecycle,
  version: row.version,
});

/** The Recording's durable writes (ADR 0107): PostgreSQL is the one writer. */
export const recordingOperations = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  /** One Recording per Round: a repeat returns the first, whoever asked. */
  async requestRecording(input: {
    readonly id: string;
    readonly roundId: string;
    readonly class: RecordingClass;
    readonly eligibility: RecordingEligibility;
  }): Promise<StoredRecording> {
    await database
      .insert(recordings)
      .values({
        id: input.id,
        roundId: input.roundId,
        recordingClass: input.class,
        eligibility: input.eligibility,
        status: 'requested',
        lifecycle: { status: 'requested' },
      })
      .onConflictDoNothing({ target: recordings.roundId });
    // A Recording asked for after its Broadcast's Egress began knows its sources too.
    await openRecordingJobIfEgressRecorded(database, input.roundId);
    const [row] = await database
      .select()
      .from(recordings)
      .where(eq(recordings.roundId, input.roundId));
    return stored(row!);
  },

  async findRecording(id: string): Promise<StoredRecording | null> {
    const [row] = await database
      .select()
      .from(recordings)
      .where(eq(recordings.id, id));
    return row ? stored(row) : null;
  },

  async findRecordingByRound(roundId: string): Promise<StoredRecording | null> {
    const [row] = await database
      .select()
      .from(recordings)
      .where(eq(recordings.roundId, roundId));
    return row ? stored(row) : null;
  },

  /** Runs the caller's pure decision under the row lock, in its own transaction. */
  applyRecording<Decision extends RecordingDecision>(
    id: string,
    decide: (record: StoredRecording) => Decision,
    expectedVersion?: number,
  ) {
    return database.transaction((tx) =>
      moveRecording(tx, id, decide, expectedVersion),
    );
  },

  /**
   * A participant's removal: the caller's decision under the row lock, told whether an
   * open report holds it as evidence, and when it moves, the end of the Round's open
   * feed in the same transaction.
   */
  applyParticipantRemoval<Decision extends RecordingDecision>(
    id: string,
    decide: (record: StoredRecording, underOpenReport: boolean) => Decision,
    input: { readonly expectedVersion: number; readonly now: string },
  ) {
    return database.transaction(async (tx) => {
      const underOpenReport = await recordingUnderOpenReport(tx, id);
      const applied = await moveRecording(
        tx,
        id,
        (record) => decide(record, underOpenReport),
        input.expectedVersion,
      );
      if (applied.kind === 'decided' && applied.transition.kind === 'moved')
        await endRoundFeed(tx, {
          roundId: applied.record.roundId,
          reason: 'recording_removed_by_participant',
          now: new Date(input.now),
        });
      return applied;
    });
  },

  /** Due deletions, leased with SKIP LOCKED so two workers never share one. */
  claimRecordingDeletions(input: {
    readonly owner: string;
    readonly now: string;
    readonly leaseUntil: string;
    readonly limit: number;
  }) {
    const at = new Date(input.now);
    return database.transaction(async (tx) => {
      const due = await tx
        .select({ id: recordings.id })
        .from(recordings)
        .where(
          and(
            eq(recordings.status, 'removing'),
            lte(recordings.deletionDueAt, at),
            or(isNull(recordings.leaseUntil), lte(recordings.leaseUntil, at)),
          ),
        )
        .orderBy(asc(recordings.deletionDueAt), asc(recordings.id))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      const claims = [];
      for (const { id } of due) {
        const [row] = await tx
          .update(recordings)
          .set({
            leaseOwner: input.owner,
            leaseUntil: new Date(input.leaseUntil),
          })
          .where(eq(recordings.id, id))
          .returning();
        claims.push({ record: stored(row!), attempts: row!.deletionAttempts });
      }
      return claims;
    });
  },

  /**
   * Only the lease's holder releases it: a worker whose lease lapsed and was
   * taken over changes nothing, so the newer holder keeps its claim.
   */
  async deferRecordingDeletion(
    id: string,
    input: {
      readonly owner: string;
      readonly retryAt: string;
      readonly failed: boolean;
    },
  ): Promise<void> {
    await database
      .update(recordings)
      .set({
        deletionDueAt: new Date(input.retryAt),
        deletionAttempts: input.failed
          ? sql`${recordings.deletionAttempts} + 1`
          : 0,
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(recordings.id, id),
          eq(recordings.status, 'removing'),
          eq(recordings.leaseOwner, input.owner),
        ),
      );
  },

  /**
   * Held casual Recordings whose removal is now due: the report behind the hold
   * closed, or its period passed (ADR 0107).
   */
  async listEndedRecordingEvidenceHolds(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly string[]> {
    const rows = await database
      .select({ id: recordings.id })
      .from(recordings)
      .where(
        and(
          eq(recordings.status, 'taken_down'),
          sql`${recordings.lifecycle} ? 'removalOwed'`,
          sql`((${recordings.lifecycle}->'removalOwed'->>'heldUntil')::timestamptz <= ${input.now}::timestamptz
            or not exists (select 1 from content_reports c where c.status = 'open' and (
              (c.target_kind = 'recording' and c.target_id = ${recordings.id})
              or (c.target_kind = 'round' and c.target_id = ${recordings.roundId}))))`,
        ),
      )
      .orderBy(asc(recordings.updatedAt))
      .limit(input.limit);
    return rows.map((row) => row.id);
  },

  async listFailedRecordingsBefore(input: {
    readonly before: string;
    readonly limit: number;
  }): Promise<readonly string[]> {
    const rows = await database
      .select({ id: recordings.id })
      .from(recordings)
      .where(
        and(
          eq(recordings.status, 'failed'),
          // A ranked Recording is kept forever: no timer removes what it left.
          eq(recordings.recordingClass, 'casual'),
          lte(recordings.updatedAt, new Date(input.before)),
          // What a report rests on stays until the report is decided.
          sql`not exists (select 1 from content_reports c where c.status = 'open' and (
            (c.target_kind = 'recording' and c.target_id = ${recordings.id})
            or (c.target_kind = 'round' and c.target_id = ${recordings.roundId})))`,
        ),
      )
      .orderBy(asc(recordings.updatedAt))
      .limit(input.limit);
    return rows.map((row) => row.id);
  },
});
