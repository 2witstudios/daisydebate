import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { and, eq, sql } from 'drizzle-orm';
import { formatRulesSchema, type FormatRules } from '@daisy/protocol';
import { formats } from './schema/formats';
import { debates, type DebateOutcome } from './schema/debates';
import {
  snapshotPhase,
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
    const phase = snapshotPhase(input.snapshot);
    return instrumented(eventSink, 'createDebate', async () => {
      return await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(debates)
          .values({ ...input, phase, createdBy: input.createdBy ?? null })
          .returning();
        if (!row) throw new Error('Debate insert returned no row');
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

/**
 * Null means optimistic conflict or absent record; retry only after
 * re-reading and re-running the domain operation. Lifecycle projections
 * travel in the same UPDATE (ADR 0029): `phase` from the snapshot,
 * `started_at` on the first save that becomes `active`, `completed_at`
 * plus the caller's `outcome` on completion. An outcome is required when
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
  const phase = snapshotPhase(input.snapshot);
  const completing = phase === 'completed';
  const hasOutcome = input.outcome !== undefined;
  if (completing !== hasOutcome)
    throw new Error('An outcome is required exactly when completing');
  const updatedAt = new Date(input.updatedAt);
  const [row] = await database
    .update(debates)
    .set({
      snapshot: input.snapshot,
      version: sql`${debates.version}+1`,
      updatedAt,
      phase,
      // Completion leaves started_at as it is: a debate abandoned from
      // waiting never started, and the CHECK decides what is legal.
      ...(phase === 'waiting' && { startedAt: null }),
      ...(phase === 'active' && {
        startedAt: sql`coalesce(${debates.startedAt}, ${updatedAt})`,
      }),
      completedAt: completing
        ? sql`coalesce(${debates.completedAt}, ${updatedAt})`
        : null,
      outcome: input.outcome ?? null,
    })
    .where(
      and(eq(debates.id, input.id), eq(debates.version, input.expectedVersion)),
    )
    .returning();
  return row ? toDebateRecord(row) : null;
}
