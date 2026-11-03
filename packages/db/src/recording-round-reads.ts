import type { CaptureRule, DebateRole, RoundOutcome } from '@daisy/protocol';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readBroadcastRelease } from './broadcast-operations';
import type { SpectatorClock } from './spectator-release-sql';
import { historyRows } from './member-history-rows';
import { audienceTranscript } from './round-ballot-reads';
import { readTranscriptFreeze } from './frozen-transcript';
import { ballots } from './schema/ballots';
import { mediaRoomRotations } from './schema/media-sessions';
import { roundCommands } from './schema/round-commands';
import { roundSegments } from './schema/round-segments';
import { roundParticipants } from './schema/round-participants';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { rooms } from './schema/rooms';
import { rounds } from './schema/rounds';

/** A debater's side, read for the record; a judge's name is never read here. */
const debaterSides = ['affirmative', 'negative'] as const;

/**
 * The Round as Recording reads it: named, read-only inputs (ADR 0107). Recording
 * never writes any of this. Visibility follows the Room. Who may see each part is
 * decided by the caller, so `readRecordingTranscript` and
 * `readRecordingBallots` are called only for a viewer who holds that permission.
 */
export const recordingRoundReadOperations = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRecordingRound(roundId: string) {
    return database.transaction(async (tx) => {
      const [round] = await tx
        .select({
          id: rounds.id,
          title: rooms.title,
          resolution: rounds.resolution,
          competitionType: rounds.competitionType,
          roomVisibility: rooms.visibility,
          roundVisibility: rounds.visibility,
          audienceLinkHash: rounds.audienceLinkHash,
          hostActorId: rounds.createdByActorId,
          status: rounds.status,
          completedAt: rounds.completedAt,
          outcome: rounds.outcome,
        })
        .from(rounds)
        .leftJoin(rooms, eq(rooms.id, rounds.roomId))
        .where(eq(rounds.id, roundId));
      if (!round) return null;
      const seats = await tx
        .select({
          id: roundParticipants.id,
          actorId: roundParticipants.actorId,
          role: roundParticipants.role,
        })
        .from(roundParticipants)
        .where(eq(roundParticipants.roundId, roundId))
        .orderBy(asc(roundParticipants.role), asc(roundParticipants.slot));
      const named = round.completedAt
        ? await historyRows(tx, [
            {
              roundId,
              completedAt: round.completedAt,
              resolution: round.resolution,
              visibility: 'private',
              outcome: round.outcome as RoundOutcome | null,
              role: 'affirmative',
            },
          ])
        : [];
      const debaterSeats = seats.filter((seat) =>
        (debaterSides as readonly string[]).includes(seat.role),
      );
      const debaters = (named[0]?.seats ?? []).filter((seat) =>
        (debaterSides as readonly string[]).includes(seat.role),
      );
      return {
        id: round.id,
        title: round.title,
        resolution: round.resolution,
        competitionType: round.competitionType,
        visibility:
          round.roomVisibility ?? round.roundVisibility ?? ('private' as const),
        audienceLinkHash: round.audienceLinkHash,
        hostActorId: round.hostActorId,
        status: round.status,
        completedAtMs: round.completedAt?.getTime() ?? null,
        outcome: round.outcome as RoundOutcome | null,
        seats: seats.map((seat) => ({
          id: seat.id,
          actorId: seat.actorId,
          role: seat.role as DebateRole,
        })),
        /** Both lists are ordered by role then slot, so they pair up. */
        debaters: debaters.map((seat, index) => ({
          ...seat,
          roundParticipantId: debaterSeats[index]?.id ?? null,
        })),
      };
    });
  },

  readRecordingBroadcastRelease: (roundId: string, clock: SpectatorClock) =>
    readBroadcastRelease(database, roundId, clock),

  /** The frozen transcript with its revision and honest coverage; null before one. */
  async readRecordingTranscript(roundId: string, captureRule: CaptureRule) {
    return database.transaction(async (tx) => {
      const freeze = await readTranscriptFreeze(tx, roundId);
      if (!freeze) return null;
      const transcript = await audienceTranscript(
        tx,
        roundId,
        true,
        captureRule,
      );
      return transcript && { revision: freeze.revision, ...transcript };
    });
  },

  /** Only the public ballot fields; feedback and the judge's seat are never read. */
  readRecordingBallots: (roundId: string) =>
    database
      .select({
        winner: ballots.winner,
        scores: ballots.scores,
        reason: ballots.reason,
      })
      .from(ballots)
      .where(eq(ballots.roundId, roundId))
      .orderBy(asc(ballots.submittedAt), asc(ballots.id)),

  /**
   * What a finished video is measured against: the Round's public segments, the
   * private prep it took between them, and when its media room moved.
   */
  async readRecordingCoverageFacts(roundId: string) {
    const [segments, preps, rotations] = await Promise.all([
      database
        .select({
          startedAt: roundSegments.startedAt,
          endedAt: roundSegments.endedAt,
        })
        .from(roundSegments)
        .where(eq(roundSegments.roundId, roundId))
        .orderBy(asc(roundSegments.sequence)),
      database
        .select({ appliedAt: roundCommands.appliedAt })
        .from(roundCommands)
        .where(
          and(
            eq(roundCommands.roundId, roundId),
            eq(roundCommands.type, 'start_prep'),
          ),
        )
        .orderBy(asc(roundCommands.appliedAt)),
      database
        .select({ rotatedAt: mediaRoomRotations.rotatedAt })
        .from(mediaRoomRotations)
        .where(eq(mediaRoomRotations.roundId, roundId))
        .orderBy(asc(mediaRoomRotations.rotatedAt)),
    ]);
    return {
      segments: segments.map((row) => ({
        startedAtMs: row.startedAt.getTime(),
        endedAtMs: row.endedAt?.getTime() ?? null,
      })),
      prepStartsAtMs: preps.map((row) => row.appliedAt.getTime()),
      rotationsAtMs: rotations.map((row) => row.rotatedAt.getTime()),
    };
  },

  /** Accepted floor authority, for the speech timeline of a finished video. */
  async readRecordingFloorIntervals(roundId: string) {
    const rows = await database
      .select({
        roundParticipantId: roundSpeakingIntervals.roundParticipantId,
        startedAt: roundSpeakingIntervals.startedAt,
        endedAt: roundSpeakingIntervals.endedAt,
      })
      .from(roundSpeakingIntervals)
      .innerJoin(
        roundParticipants,
        eq(roundParticipants.id, roundSpeakingIntervals.roundParticipantId),
      )
      .where(
        and(
          eq(roundSpeakingIntervals.roundId, roundId),
          inArray(roundParticipants.role, [...debaterSides]),
        ),
      )
      .orderBy(asc(roundSpeakingIntervals.startedAt));
    return rows.map((row) => ({
      roundParticipantId: row.roundParticipantId,
      startedAtMs: row.startedAt.getTime(),
      endedAtMs: row.endedAt?.getTime() ?? null,
    }));
  },
});
