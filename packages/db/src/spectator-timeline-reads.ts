import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';
import { ballots } from './schema/ballots';
import { botProfiles } from './schema/bot-profiles';
import { broadcasts } from './schema/broadcasts';
import { recordings } from './schema/recordings';
import { ratingChanges } from './schema/ratings';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';
import { users } from './schema/users';
import { utterances } from './schema/utterances';

/** How many of the newest released captions one snapshot carries. */
const CAPTION_WINDOW = 50;

const debateRoles = ['affirmative', 'negative'] as const;

/** What the horizon rule decides from, in the read's own snapshot. */
export type SpectatorHorizonRead = {
  readonly competitionType: 'ranked' | 'casual';
  readonly roundTerminal: boolean;
  readonly broadcast: null | {
    readonly policy: typeof broadcasts.$inferSelect.releasePolicy;
    readonly releasedThroughMs: number | null;
    readonly completedAtMs: number | null;
    readonly stoppedAtMs: number | null;
  };
};

const ms = (value: Date | null) => value?.getTime() ?? null;

/**
 * The persisted facts of one Round for its audience, or null when no audience
 * exists: a private Round, or one with no Room. Every timed fact is filtered
 * here, by the horizon the caller's rule gives, so what was not released never
 * leaves the database. Rows only: the feature projects them.
 */
export const spectatorTimelineReads = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readSpectatorTimeline(input: {
    readonly roundId: string;
    readonly horizonOf: (facts: SpectatorHorizonRead) => number | null;
  }) {
    return instrumented(eventSink, 'readSpectatorTimeline', () =>
      database.transaction(
        async (tx) => {
          const [round] = await tx
            .select({
              id: rounds.id,
              roomId: rounds.roomId,
              visibility: rounds.visibility,
              status: rounds.status,
              competitionType: rounds.competitionType,
              resolution: rounds.resolution,
              rules: rounds.rulesSnapshot,
              outcome: rounds.outcome,
              startedAt: rounds.startedAt,
              completedAt: rounds.completedAt,
            })
            .from(rounds)
            .where(eq(rounds.id, input.roundId));
          if (
            !round ||
            round.roomId === null ||
            (round.visibility !== 'public' && round.visibility !== 'unlisted')
          )
            return null;
          const competitionType = round.competitionType as 'ranked' | 'casual';
          const [broadcast] = await tx
            .select()
            .from(broadcasts)
            .where(eq(broadcasts.roundId, input.roundId));
          const horizonMs = input.horizonOf({
            competitionType,
            roundTerminal:
              round.status === 'completed' || round.status === 'abandoned',
            broadcast: broadcast
              ? {
                  policy: broadcast.releasePolicy,
                  releasedThroughMs: ms(broadcast.releasedThroughAt),
                  completedAtMs: ms(broadcast.completedAt),
                  stoppedAtMs: ms(broadcast.stoppedAt),
                }
              : null,
          });
          const seats = await tx
            .select({
              side: roundParticipants.role,
              kind: actors.kind,
              username: users.username,
              botName: botProfiles.name,
            })
            .from(roundParticipants)
            .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
            .leftJoin(users, eq(users.id, actors.userId))
            .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
            .where(
              and(
                eq(roundParticipants.roundId, input.roundId),
                inArray(roundParticipants.role, [...debateRoles]),
              ),
            )
            .orderBy(asc(roundParticipants.role));
          const [recording] = await tx
            .select({ status: recordings.status })
            .from(recordings)
            .where(eq(recordings.roundId, input.roundId));
          const shared = {
            round: { ...round, competitionType },
            broadcast: broadcast
              ? {
                  id: broadcast.id,
                  deliveryPath: broadcast.deliveryPath,
                  policy: broadcast.releasePolicy,
                  releasedThroughAt: broadcast.releasedThroughAt,
                  completedAt: broadcast.completedAt,
                  stoppedAt: broadcast.stoppedAt,
                }
              : null,
            recordingStatus: recording?.status ?? null,
            seats,
            horizonMs,
          };
          if (horizonMs === null)
            return {
              ...shared,
              segments: [],
              ballots: [],
              ratings: [],
              captions: [],
              outcomeReleased: false,
            };
          // A fact has left once capture + margin has reached the horizon.
          const reach = new Date(horizonMs - SPECTATOR_MARGIN_MS);
          const released = (capturedAt: unknown) =>
            sql`${capturedAt} <= ${reach.toISOString()}::timestamptz`;
          const outcomeReleased =
            round.completedAt !== null && round.completedAt <= reach;
          const segments = await tx
            .select({
              type: roundSegments.type,
              key: roundSegments.rulesSegmentKey,
              startedAt: roundSegments.startedAt,
              endedAt: roundSegments.endedAt,
              durationMs: roundSegments.durationMs,
            })
            .from(roundSegments)
            .where(
              and(
                eq(roundSegments.roundId, input.roundId),
                released(roundSegments.startedAt),
              ),
            )
            .orderBy(desc(roundSegments.sequence))
            .limit(1);
          const ranked = competitionType === 'ranked';
          const ballotRows =
            ranked && outcomeReleased && round.status === 'completed'
              ? await tx
                  .select({
                    winner: ballots.winner,
                    scores: ballots.scores,
                    reason: ballots.reason,
                  })
                  .from(ballots)
                  .where(
                    and(
                      eq(ballots.roundId, input.roundId),
                      eq(ballots.status, 'submitted'),
                    ),
                  )
                  .orderBy(asc(ballots.id))
              : [];
          const ratingRows =
            ranked && outcomeReleased
              ? await tx
                  .select({
                    side: roundParticipants.role,
                    before: ratingChanges.ratingBefore,
                    after: ratingChanges.ratingAfter,
                  })
                  .from(ratingChanges)
                  .innerJoin(
                    roundParticipants,
                    and(
                      eq(roundParticipants.roundId, ratingChanges.roundId),
                      eq(roundParticipants.actorId, ratingChanges.actorId),
                    ),
                  )
                  .where(
                    and(
                      eq(ratingChanges.roundId, input.roundId),
                      released(ratingChanges.occurredAt),
                    ),
                  )
                  .orderBy(asc(roundParticipants.role))
              : [];
          const captionRows = ranked
            ? await tx
                .select({
                  id: utterances.id,
                  side: roundParticipants.role,
                  text: utterances.text,
                })
                .from(utterances)
                .innerJoin(
                  roundParticipants,
                  eq(roundParticipants.id, utterances.roundParticipantId),
                )
                .where(
                  and(
                    eq(utterances.roundId, input.roundId),
                    eq(utterances.complete, true),
                    inArray(roundParticipants.role, [...debateRoles]),
                    released(utterances.createdAt),
                  ),
                )
                .orderBy(desc(utterances.createdAt), desc(utterances.id))
                .limit(CAPTION_WINDOW)
            : [];
          return {
            ...shared,
            segments,
            ballots: ballotRows,
            ratings: ratingRows,
            captions: [...captionRows].reverse(),
            outcomeReleased,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  },
});

export type SpectatorTimelineRead = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<typeof spectatorTimelineReads>['readSpectatorTimeline']
    >
  >
>;
