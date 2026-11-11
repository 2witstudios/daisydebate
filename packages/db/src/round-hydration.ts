import { createAppError } from '@daisy/errors';
import { isRoundLifecycle, type RoundLifecycle } from '@daisy/protocol';
import { loadRoundOpening, type StoredOpening } from './round-opening-read';
import type {
  CompetitionType,
  DebateRole,
  RoundRules,
  RoundStage,
  RuntimeCheckpoint,
  SegmentType,
} from '@daisy/protocol';
import { asc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

/**
 * A round hydrated for the runtime (ADR 0058 §4): the durable rows plus the
 * frozen rules and the checkpoint, everything `createRoundRuntime` needs.
 */
export type RoundHydration = RoundLifecycle & {
  readonly id: string;
  readonly competitionType: CompetitionType;
  readonly formatId: string;
  readonly formatVersion: number;
  /** Null until a draw's reveal; never null on an active Round. */
  readonly resolution: string | null;
  /** The opening and its secret seed, only while the Round is in it. */
  readonly opening: StoredOpening | null;
  readonly currentStage: RoundStage | null;
  /** When the Round was launched (its row's creation), on the database clock. */
  readonly launchedAt: string;
  readonly rules: RoundRules;
  readonly checkpoint: RuntimeCheckpoint;
  readonly version: number;
  readonly participants: readonly {
    readonly id: string;
    readonly actorId: string;
    readonly role: DebateRole;
    readonly slot: number;
  }[];
  readonly segments: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly type: SegmentType;
    readonly rulesSegmentKey: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly durationMs: number;
    readonly returnedMs: number;
  }[];
};

type Reader = Pick<BunSQLDatabase, 'select'>;

/** A Round's segment rows in order, timestamps as ISO strings. */
export async function segmentRows(
  tx: Reader,
  roundId: string,
): Promise<RoundHydration['segments']> {
  const rows = await tx
    .select({
      id: roundSegments.id,
      sequence: roundSegments.sequence,
      type: roundSegments.type,
      rulesSegmentKey: roundSegments.rulesSegmentKey,
      startedAt: roundSegments.startedAt,
      endedAt: roundSegments.endedAt,
      durationMs: roundSegments.durationMs,
      returnedMs: roundSegments.returnedMs,
    })
    .from(roundSegments)
    .where(eq(roundSegments.roundId, roundId))
    .orderBy(roundSegments.sequence);
  return rows.map((segment) => ({
    ...segment,
    startedAt: segment.startedAt.toISOString(),
    endedAt: segment.endedAt?.toISOString() ?? null,
  }));
}

/** One consistent PostgreSQL snapshot for the Round and its child rows. */
export async function hydrateRoundRows(
  tx: Reader,
  id: string,
): Promise<RoundHydration | null> {
  const [row] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, id))
    .limit(1);
  if (!row) return null;
  const participants = await tx
    .select({
      id: roundParticipants.id,
      actorId: roundParticipants.actorId,
      role: roundParticipants.role,
      slot: roundParticipants.slot,
    })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, id))
    .orderBy(asc(roundParticipants.role), asc(roundParticipants.slot));
  const segments = await segmentRows(tx, id);
  const lifecycle = {
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    outcome: row.outcome,
  };
  // `rounds_lifecycle_check` holds this for every stored row.
  if (!isRoundLifecycle(lifecycle))
    throw createAppError(
      'INVARIANT',
      'Round lifecycle is not one its status holds',
    );
  return {
    ...lifecycle,
    opening: await loadRoundOpening(tx, row),
    id: row.id,
    competitionType: row.competitionType,
    formatId: row.formatId,
    formatVersion: row.formatVersion,
    resolution: row.resolution,
    currentStage: row.currentStage,
    launchedAt: row.createdAt.toISOString(),
    rules: row.rulesSnapshot as RoundHydration['rules'],
    checkpoint: row.runtimeState as RoundHydration['checkpoint'],
    version: row.version,
    participants,
    segments,
  };
}

export async function hydrateRound(
  database: BunSQLDatabase,
  id: string,
): Promise<RoundHydration | null> {
  return database.transaction((tx) => hydrateRoundRows(tx, id), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}
