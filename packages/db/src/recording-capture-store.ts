import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readBroadcastRoom } from './broadcast-operations';
import { readEntitlementGrants } from './entitlement-grants';
import {
  discardRecordingSources,
  listUnsettledRecordingJobs,
  openRecordingJob,
  queueRecordingJob,
  recordingSourcesRemain,
} from './recording-processing-operations';
import { launchedRoundRows } from './room-read-operations';
import { hydrateRoundRows } from './round-hydration';
import { actors } from './schema/actors';
import { broadcasts } from './schema/broadcasts';
import { mediaParticipants } from './schema/media-sessions';
import { recordingCaptures as captures } from './schema/recording-captures';
import { recordings } from './schema/recordings';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

/**
 * Recording's capture control plane: its own tables, and the Round and the
 * Broadcast as named, read-only inputs. It takes no Round lock, so nothing here
 * can delay a debate or its finalization.
 */
export const createRecordingCaptureStore = (database: BunSQLDatabase) => ({
  /** Running Rounds that should have a Recording and do not yet, with their host's grants. */
  async discoverUnrecorded(limit: number) {
    const rows = await database
      .select({
        roundId: rounds.id,
        competitionType: rounds.competitionType,
        capture: rounds.capture,
        hostActorId: rounds.createdByActorId,
        hostUserId: actors.userId,
      })
      .from(rounds)
      .leftJoin(recordings, eq(recordings.roundId, rounds.id))
      .leftJoin(actors, eq(actors.id, rounds.createdByActorId))
      .where(
        and(
          or(
            eq(rounds.competitionType, 'ranked'),
            sql`${rounds.capture} ->> 'recording' = 'true'`,
          ),
          inArray(rounds.status, ['opening', 'active']),
          isNull(recordings.id),
        ),
      )
      .limit(limit);
    return Promise.all(
      rows.map(async ({ hostUserId, ...row }) => ({
        ...row,
        hostGrants: hostUserId
          ? await readEntitlementGrants(database, hostUserId)
          : [],
      })),
    );
  },

  /** An account's own grants: what the download entitlement reads (WATCH-14). */
  readAccountGrants: (userId: string) =>
    readEntitlementGrants(database, userId),

  /** Every Recording whose capture is unfinished, oldest first, with what it depends on. */
  listOpen: (limit: number) =>
    database
      .select({
        id: recordings.id,
        roundId: recordings.roundId,
        lifecycle: recordings.lifecycle,
        competitionType: rounds.competitionType,
        roundCapture: rounds.capture,
        roundStatus: rounds.status,
        broadcast: {
          id: broadcasts.id,
          egressId: broadcasts.egressId,
          attempt: broadcasts.egressGeneration,
          egressStartedAt: broadcasts.egressStartedAt,
          stoppedAt: broadcasts.stoppedAt,
        },
        own: {
          recordingId: captures.recordingId,
          egressId: captures.egressId,
          attempt: captures.egressGeneration,
          egressStartedAt: captures.egressStartedAt,
          observerRevokedAt: captures.observerRevokedAt,
          revocationFailures: captures.revocationFailures,
        },
      })
      .from(recordings)
      .innerJoin(rounds, eq(rounds.id, recordings.roundId))
      .leftJoin(broadcasts, eq(broadcasts.roundId, recordings.roundId))
      .leftJoin(captures, eq(captures.recordingId, recordings.id))
      .where(
        or(
          inArray(recordings.status, ['requested', 'capturing']),
          and(
            eq(captures.recordingId, recordings.id),
            isNull(captures.endedAt),
          ),
        ),
      )
      .orderBy(asc(recordings.createdAt))
      .limit(limit),

  /** The Round's position and room, for a Recording running its own Egress. */
  async readRound(roundId: string) {
    const round = await hydrateRoundRows(database, roundId);
    return (
      round && { round, roomName: await readBroadcastRoom(database, roundId) }
    );
  },

  async openOwn(input: {
    readonly recordingId: string;
    readonly roundId: string;
  }) {
    await database
      .insert(captures)
      .values(input)
      .onConflictDoNothing({ target: captures.recordingId });
  },

  /** True for the one instance that may act on this capture until the lease ends. */
  async claimOwn(input: {
    readonly recordingId: string;
    readonly now: Date;
    readonly until: Date;
  }) {
    const rows = await database
      .update(captures)
      .set({ reconcileLeaseUntil: input.until })
      .where(
        and(
          eq(captures.recordingId, input.recordingId),
          or(
            isNull(captures.reconcileLeaseUntil),
            lte(captures.reconcileLeaseUntil, input.now),
          ),
        ),
      )
      .returning({ id: captures.recordingId });
    return rows.length === 1;
  },

  async recordOwnEgressStarted(input: {
    readonly recordingId: string;
    readonly egressId: string;
    readonly generation: number;
    readonly stageCredentialHash: string;
    readonly now: Date;
  }) {
    await database
      .update(captures)
      .set({
        egressId: input.egressId,
        egressGeneration: input.generation,
        revocationFailures: 0,
        stageCredentialHash: input.stageCredentialHash,
        egressStartedAt: input.now,
      })
      .where(eq(captures.recordingId, input.recordingId));
  },

  async recordOwnRevoked(input: {
    readonly recordingId: string;
    readonly now: Date;
  }) {
    await database
      .update(captures)
      .set({ observerRevokedAt: input.now, revocationFailures: 0 })
      .where(eq(captures.recordingId, input.recordingId));
  },

  async recordOwnRevocationFailed(recordingId: string) {
    await database
      .update(captures)
      .set({ revocationFailures: sql`${captures.revocationFailures} + 1` })
      .where(eq(captures.recordingId, recordingId));
  },

  async recordOwnRestored(recordingId: string) {
    await database
      .update(captures)
      .set({ observerRevokedAt: null, revocationFailures: 0 })
      .where(eq(captures.recordingId, recordingId));
  },

  async closeOwn(input: { readonly recordingId: string; readonly now: Date }) {
    await database
      .update(captures)
      .set({ endedAt: input.now })
      .where(
        and(
          eq(captures.recordingId, input.recordingId),
          isNull(captures.endedAt),
        ),
      );
  },

  /** What the stage page reads for a Recording's own Egress; null for any other id. */
  async readStage(recordingId: string) {
    const [capture] = await database
      .select()
      .from(captures)
      .where(eq(captures.recordingId, recordingId));
    if (!capture) return null;
    const round = await hydrateRoundRows(database, capture.roundId);
    if (!round) return null;
    const seats = await database
      .select({
        participantId: roundParticipants.id,
        role: roundParticipants.role,
        identity: mediaParticipants.identity,
      })
      .from(roundParticipants)
      .innerJoin(
        mediaParticipants,
        eq(mediaParticipants.roundParticipantId, roundParticipants.id),
      )
      .where(eq(roundParticipants.roundId, capture.roundId));
    const launched = await launchedRoundRows(database, capture.roundId);
    const labels = new Map(launched.participants.map((p) => [p.id, p.label]));
    return {
      capture: {
        stageCredentialHash: capture.stageCredentialHash,
        observerRevokedAt: capture.observerRevokedAt,
        completedAt: capture.endedAt,
        stoppedAt: null,
      },
      round,
      roomName: await readBroadcastRoom(database, capture.roundId),
      seats: seats.flatMap((seat) => {
        const label = labels.get(seat.participantId);
        return label === undefined ? [] : [{ ...seat, label }];
      }),
    };
  },

  openJob: (input: Parameters<typeof openRecordingJob>[1]) =>
    openRecordingJob(database, input),
  queueJob: (input: Parameters<typeof queueRecordingJob>[1]) =>
    queueRecordingJob(database, input),
  discardSources: (recordingId: string) =>
    discardRecordingSources(database, recordingId),
  sourcesRemain: (recordingId: string) =>
    recordingSourcesRemain(database, recordingId),
  listJobs: (limit: number) => listUnsettledRecordingJobs(database, limit),
});
