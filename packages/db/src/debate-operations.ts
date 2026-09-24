import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  debateSides,
  formatRulesSchema,
  type DebateSnapshot,
  type FormatRules,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { formats } from './schema/formats';
import { debates, type DebateOutcome } from './schema/debates';
import { debateParticipants } from './schema/debate-participants';
import {
  parseSnapshot,
  toDebateRecord,
  type DebateRecord,
  type NewDebate,
} from './debate-record';
import { instrumented, type DatabaseEventSink } from './instrumented';

export type FormatRecord = {
  readonly id: string;
  readonly rules: FormatRules;
  readonly rankedEligible: boolean;
};

/**
 * The debates area (ISSUE-8 AC1): records out, opaque handles in. `createDebate`,
 * `getDebate` and `getFormat` are the production surface; `saveSnapshot` has
 * no production consumer yet (T5) and is deliberately not part of it — see
 * `saveDebateSnapshot` below, composed only by `test-only-operations.ts`.
 */
export const debateOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createDebate(input: NewDebate): Promise<DebateRecord> {
    const snapshot = parseSnapshot(input.id, input.snapshot);
    return instrumented(eventSink, 'createDebate', async () => {
      return await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(debates)
          .values({
            id: input.id,
            createdByActorId: input.createdBy ?? null,
            resolution: input.resolution,
            formatId: input.format,
            snapshot,
            mode: input.mode,
            visibility: input.visibility,
            phase: snapshot.phase,
          })
          .returning();
        if (!row) throw new Error('Debate insert returned no row');
        await projectParticipants(tx, snapshot);
        return toDebateRecord(row);
      });
    });
  },
  /**
   * The canonical rules of a format (ADR 0030). Callers copy them into a
   * new debate's snapshot; a lobby may then override, ranked may not.
   */
  async getFormat(id: string): Promise<FormatRecord | null> {
    return instrumented(eventSink, 'getFormat', async () => {
      const [row] = await database
        .select({
          id: formats.id,
          rules: formats.rules,
          rankedEligible: formats.rankedEligible,
        })
        .from(formats)
        .where(eq(formats.id, id))
        .limit(1);
      if (!row) return null;
      const rules = formatRulesSchema.safeParse(row.rules);
      if (!rules.success) throw new Error('Stored format rules are invalid');
      return {
        id: row.id,
        rules: rules.data,
        rankedEligible: row.rankedEligible,
      };
    });
  },
  async getDebate(id: string): Promise<DebateRecord | null> {
    return instrumented(eventSink, 'getDebate', async () => {
      const [row] = await database
        .select()
        .from(debates)
        .where(eq(debates.id, id))
        .limit(1);
      return row ? toDebateRecord(row) : null;
    });
  },
});

type Tx = Pick<BunSQLDatabase, 'delete' | 'insert' | 'select'>;

/**
 * The seats a snapshot owns: its `participants` carry only these sides.
 * Every other role (today `judge`) is written by its own path, and
 * `ballots` cascade from a judge seat, so a snapshot write never deletes,
 * updates or claims one.
 */
const snapshotRoles = [...debateSides];

/** The database clock of the write (ADR 0033 §3.2), never a caller's time. */
const writeTime = sql`statement_timestamp()`;

/**
 * Rewrites the snapshot's own seats in `debate_participants` to equal its
 * `participants`, inside the caller's snapshot transaction (ADR 0029,
 * ADR 0038): a snapshot participant's id is its actor id and its side is its
 * role; `slot` counts earlier participants on the same side. Debater seats
 * that left the snapshot are deleted; a changed seat bumps its version;
 * `joined_at` is the database time of the write that first seated the actor
 * and is never rewritten. Seats of any other role are left alone, and a
 * snapshot that names an actor already seated in one is refused before
 * anything is written.
 */
export async function projectParticipants(
  tx: Tx,
  snapshot: DebateSnapshot,
): Promise<void> {
  const t = debateParticipants;
  const seats = snapshot.participants.map((participant, index, all) => ({
    debateId: snapshot.id,
    actorId: participant.id,
    role: participant.side,
    slot: all
      .slice(0, index)
      .filter((earlier) => earlier.side === participant.side).length,
    status: participant.ready ? 'ready' : 'joined',
    joinedAt: writeTime,
    updatedAt: writeTime,
  }));
  const actorIds = seats.map((seat) => seat.actorId);
  if (actorIds.length > 0) {
    const [foreign] = await tx
      .select({ actorId: t.actorId })
      .from(t)
      .where(
        and(
          eq(t.debateId, snapshot.id),
          inArray(t.actorId, actorIds),
          notInArray(t.role, snapshotRoles),
        ),
      )
      .limit(1);
    if (foreign)
      throw createAppError(
        'CONFLICT',
        'A snapshot participant already holds another seat',
      );
  }
  await tx
    .delete(t)
    .where(
      and(
        eq(t.debateId, snapshot.id),
        inArray(t.role, snapshotRoles),
        actorIds.length > 0 ? notInArray(t.actorId, actorIds) : undefined,
      ),
    );
  if (seats.length === 0) return;
  await tx
    .insert(t)
    .values(seats)
    .onConflictDoUpdate({
      target: [t.debateId, t.actorId],
      set: {
        role: sql`excluded.role`,
        slot: sql`excluded.slot`,
        status: sql`excluded.status`,
        updatedAt: sql`excluded.updated_at`,
        version: sql`${t.version} + 1`,
      },
      setWhere: sql`(${t.role}, ${t.slot}, ${t.status}) is distinct from (excluded.role, excluded.slot, excluded.status)`,
    });
}

/**
 * Null means optimistic conflict or absent record; retry only after
 * re-reading and re-running the domain operation. Lifecycle projections
 * travel in the same UPDATE (ADR 0029): `phase` from the snapshot,
 * `started_at` on the first save that becomes `active`, `completed_at`
 * plus the caller's `outcome` on completion. Both times are the database
 * clock of this write (ADR 0033 §3.2); the caller's `updatedAt` stamps only
 * the row's `updated_at`. An outcome is required when
 * completing and refused otherwise, before any statement runs.
 *
 * No production consumer calls this yet (T5): it exists for
 * `test-only-operations.ts`, which composes it (wrapped by `instrumented`)
 * for `packages/db`'s own tests. Not part of `createDatabase()`'s return.
 */
export async function saveDebateSnapshot(
  database: BunSQLDatabase,
  input: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly snapshot: unknown;
    readonly updatedAt: string;
    readonly outcome?: DebateOutcome;
  },
): Promise<DebateRecord | null> {
  const snapshot = parseSnapshot(input.id, input.snapshot);
  const { phase } = snapshot;
  const completing = phase === 'completed';
  const hasOutcome = input.outcome !== undefined;
  if (completing !== hasOutcome)
    throw new Error('An outcome is required exactly when completing');
  const updatedAt = new Date(input.updatedAt);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(debates)
      .set({
        snapshot,
        version: sql`${debates.version}+1`,
        updatedAt,
        phase,
        // Completion leaves started_at as it is: a debate abandoned from
        // waiting never started, and the CHECK decides what is legal.
        ...(phase === 'waiting' && { startedAt: null }),
        ...(phase === 'active' && {
          startedAt: sql`coalesce(${debates.startedAt}, ${writeTime})`,
        }),
        completedAt: completing
          ? sql`coalesce(${debates.completedAt}, ${writeTime})`
          : null,
        outcome: input.outcome ?? null,
      })
      .where(
        and(
          eq(debates.id, input.id),
          eq(debates.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) return null;
    await projectParticipants(tx, snapshot);
    return toDebateRecord(row);
  });
}
