import type {
  CompetitionType,
  DebateRole,
  RoundRules,
  RuntimeCheckpoint,
  SegmentType,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

/**
 * A round hydrated for the runtime (ADR 0058 §4): the durable rows plus the
 * frozen rules and the checkpoint, everything `createRoundRuntime` needs.
 */
export type RoundHydration = {
  readonly id: string;
  readonly competitionType: CompetitionType;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly resolution: string;
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly currentStage: 'countdown' | 'prep' | 'live' | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: 'affirmative' | 'negative' | 'draw' | null;
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
  }[];
};

/** One consistent PostgreSQL snapshot for the Round and its child rows. */
export async function hydrateRound(
  database: BunSQLDatabase,
  id: string,
): Promise<RoundHydration | null> {
  return database.transaction(
    async (tx) => {
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
        .where(eq(roundParticipants.roundId, id));
      const segments = await tx
        .select({
          id: roundSegments.id,
          sequence: roundSegments.sequence,
          type: roundSegments.type,
          rulesSegmentKey: roundSegments.rulesSegmentKey,
          startedAt: roundSegments.startedAt,
          endedAt: roundSegments.endedAt,
          durationMs: roundSegments.durationMs,
        })
        .from(roundSegments)
        .where(eq(roundSegments.roundId, id))
        .orderBy(roundSegments.sequence);
      return {
        id: row.id,
        competitionType: row.competitionType,
        formatId: row.formatId,
        formatVersion: row.formatVersion,
        resolution: row.resolution,
        status: row.status,
        currentStage: row.currentStage,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        outcome: row.outcome,
        rules: row.rulesSnapshot as RoundHydration['rules'],
        checkpoint: row.runtimeState as RoundHydration['checkpoint'],
        version: row.version,
        participants,
        segments: segments.map((segment) => ({
          ...segment,
          startedAt: segment.startedAt.toISOString(),
          endedAt: segment.endedAt?.toISOString() ?? null,
        })),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
