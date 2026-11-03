import { and, asc, eq, exists, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { readBroadcastRoom } from './broadcast-operations';
import { hydrateRoundRows } from './round-hydration';
import { actors } from './schema/actors';
import { mediaParticipants } from './schema/media-sessions';
import { recordingPovCaptures as povs } from './schema/recording-pov-captures';
import { recordings } from './schema/recordings';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

type Pov = {
  readonly recordingId: string;
  readonly roundParticipantId: string;
};

const thisPov = (input: Pov) =>
  and(
    eq(povs.recordingId, input.recordingId),
    eq(povs.roundParticipantId, input.roundParticipantId),
  );

/**
 * The control plane of each debater's own capture: its own table, and the Round and
 * its seats as named, read-only inputs. It takes no Round lock, so nothing here can
 * delay a debate or its finalization.
 */
export const createRecordingPovStore = (database: BunSQLDatabase) => ({
  /** Recordings capturing now, or with a POV still to stop: one page. */
  listOpen: (limit: number, after: string | null = null) =>
    database
      .select({
        id: recordings.id,
        roundId: recordings.roundId,
        lifecycle: recordings.lifecycle,
        roundStatus: rounds.status,
      })
      .from(recordings)
      .innerJoin(rounds, eq(rounds.id, recordings.roundId))
      .where(
        and(
          or(
            eq(recordings.status, 'capturing'),
            exists(
              database
                .select({ one: sql`1` })
                .from(povs)
                .where(
                  and(
                    eq(povs.recordingId, recordings.id),
                    isNull(povs.endedAt),
                  ),
                ),
            ),
          ),
          after === null ? undefined : gt(recordings.id, after),
        ),
      )
      .orderBy(asc(recordings.id))
      .limit(limit),

  /** What says whether a Round is recorded, for the seat's camera at admission. */
  async readCapturePlan(roundId: string) {
    const [row] = await database
      .select({
        competitionType: rounds.competitionType,
        capture: rounds.capture,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId));
    return row ?? null;
  },

  /** The Round's position and room. */
  async readRound(roundId: string) {
    const round = await hydrateRoundRows(database, roundId);
    return (
      round && { round, roomName: await readBroadcastRoom(database, roundId) }
    );
  },

  /** Every seat of the Round with its identity in the media session, if it has one. */
  readSeats: (roundId: string) =>
    database
      .select({
        roundParticipantId: roundParticipants.id,
        role: roundParticipants.role,
        kind: actors.kind,
        identity: mediaParticipants.identity,
      })
      .from(roundParticipants)
      .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
      .leftJoin(
        mediaParticipants,
        eq(mediaParticipants.roundParticipantId, roundParticipants.id),
      )
      .where(eq(roundParticipants.roundId, roundId)),

  listPovs: (recordingId: string) =>
    database.select().from(povs).where(eq(povs.recordingId, recordingId)),

  async open(
    input: Pov & { readonly roundId: string; readonly camera: boolean },
  ) {
    await database.insert(povs).values(input).onConflictDoNothing();
  },

  /** True for the one instance that may act on this POV until the lease ends. */
  async claim(input: Pov & { readonly now: Date; readonly until: Date }) {
    const rows = await database
      .update(povs)
      .set({ reconcileLeaseUntil: input.until })
      .where(
        and(
          thisPov(input),
          or(
            isNull(povs.reconcileLeaseUntil),
            lte(povs.reconcileLeaseUntil, input.now),
          ),
        ),
      )
      .returning({ id: povs.recordingId });
    return rows.length === 1;
  },

  /** Keeps the claim across a call that outlasts it; null `until` gives it back. */
  async hold(input: Pov & { readonly until: Date | null }) {
    await database
      .update(povs)
      .set({ reconcileLeaseUntil: input.until })
      .where(thisPov(input));
  },

  /**
   * One Egress per attempt: the first report wins, and false tells any other to stop
   * what it started. A new Egress has been revoked by nothing yet.
   */
  async recordStarted(
    input: Pov & {
      readonly egressId: string;
      readonly room: string;
      readonly generation: number;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const rows = await database
      .update(povs)
      .set({
        egressId: input.egressId,
        egressRoom: input.room,
        egressGeneration: input.generation,
        egressStartedAt: input.now,
        observerRevokedAt: null,
        revocationFailures: 0,
      })
      .where(
        and(thisPov(input), eq(povs.egressGeneration, input.generation - 1)),
      )
      .returning({ id: povs.recordingId });
    return rows.length === 1;
  },

  async recordRevoked(input: Pov & { readonly now: Date }) {
    await database
      .update(povs)
      .set({ observerRevokedAt: input.now, revocationFailures: 0 })
      .where(thisPov(input));
  },

  async recordRevocationFailed(input: Pov) {
    await database
      .update(povs)
      .set({ revocationFailures: sql`${povs.revocationFailures} + 1` })
      .where(thisPov(input));
  },

  async recordRestored(input: Pov) {
    await database
      .update(povs)
      .set({ observerRevokedAt: null, revocationFailures: 0 })
      .where(thisPov(input));
  },

  /** The tallest yet: a camera that dropped later does not lower the label. */
  async recordCameraHeight(input: Pov & { readonly height: number }) {
    await database
      .update(povs)
      .set({
        cameraHeight: sql`greatest(coalesce(${povs.cameraHeight}, 0), ${input.height})`,
      })
      .where(thisPov(input));
  },

  async close(input: Pov & { readonly now: Date }) {
    await database
      .update(povs)
      .set({ endedAt: input.now })
      .where(and(thisPov(input), isNull(povs.endedAt)));
  },

  /**
   * The Egress this capture still runs. A closed capture runs none, so anything left
   * is a stray; null when no such capture exists.
   */
  async readEgress(input: Pov) {
    const [row] = await database
      .select({ egressId: povs.egressId, endedAt: povs.endedAt })
      .from(povs)
      .where(thisPov(input));
    if (!row) return null;
    return { egressId: row.endedAt === null ? row.egressId : null };
  },
});
