import { youthRoundPublic } from './media-release-standing';
import { currentRoundParticipant } from './round-current-participant';
import { isJudgeSeat } from '@daisy/protocol';
import { and, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { broadcastStopOf } from './broadcast-operations';
import { namedSeats } from './member-history-rows';
import { outcomeOfColumns } from './round-outcome-columns';
import { broadcasts } from './schema/broadcasts';
import { recordings } from './schema/recordings';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { rooms } from './schema/rooms';
import { rounds } from './schema/rounds';
import {
  factReleasedSql,
  spectatorHorizonSql,
  type SpectatorClock,
} from './spectator-release-sql';
import { youthRoundSql } from './youth-round-sql';
import { operatorWithheldSql } from './broadcast-withheld-sql';
import { inTransaction, type TxSource } from './tx';

export type ArchiveInput = {
  readonly query: {
    readonly scope: 'all' | 'mine';
    readonly mode: 'any' | 'ranked' | 'casual';
    readonly q: string;
    readonly sort: 'newest' | 'longest';
    readonly before: string;
  };
  readonly viewerActorId: string | null;
  readonly clock: SpectatorClock;
  readonly limit: number;
  /** The youth-publishing release flag, read by the caller (ADR 0151). */
  readonly youthPublishing: boolean;
};

/**
 * A Youth Round's Recording that one of its debaters shared and that still
 * stands, with publishing open (ADR 0151); every other Youth Round is private
 * (ADR 0150).
 */
const youthShared = (round: SQL, youthPublishing: boolean): SQL =>
  youthPublishing
    ? sql`exists (select 1 from youth_round_publications yp
        where yp.round_id = ${round} and ${youthRoundPublic(sql`yp`)})`
    : sql`false`;

const visibility = sql<
  'public' | 'unlisted' | 'private'
>`coalesce(${rooms.visibility}, ${rounds.visibility}, 'private')`;

const hasTranscript = sql<boolean>`exists (select 1 from ${roundTranscriptFreezes} where ${roundTranscriptFreezes.roundId} = ${rounds.id})`;

const roundColumns = {
  id: rounds.id,
  status: rounds.status,
  competitionType: rounds.competitionType,
  completedAt: rounds.completedAt,
};

/**
 * A Round that finished, or one abandoned that left a Recording to find. An abandoned
 * Round with nothing recorded has nothing to archive.
 */
const finishedWithSomethingToFind = or(
  eq(rounds.status, 'completed'),
  and(eq(rounds.status, 'abandoned'), isNotNull(recordings.id)),
);

/** Moderation hid the footage: its Round leaves the archive, whatever else remains. */
const moderationHid = sql<boolean>`coalesce(${recordings.status} = 'taken_down' or ${recordings.lifecycle}->>'cause' in ('moderation', 'legal_removal'), false)`;

/**
 * A public Round with something the audience may have: ready video or ranked
 * text. A ranked Round whose Recording was taken down is not listed, even with its
 * transcript (point guard, 2026-11-03).
 */
const publicScope = (clock: SpectatorClock, youthPublishing: boolean) =>
  and(
    sql`${visibility} = 'public'`,
    // A Youth Round is private (ADR 0150, 0157) until a debater shares it (ADR 0151).
    sql`(not ${youthRoundSql(sql`${rounds.id}`)} or ${youthShared(sql`${rounds.id}`, youthPublishing)})`,
    factReleasedSql(rounds.completedAt, roundColumns, clock),
    // Only an operator's stop withholds the video (ADR 0157).
    sql`((${recordings.status} = 'ready' and not ${operatorWithheldSql(sql`${broadcasts}`)}) or (${rounds.competitionType} = 'ranked' and ${hasTranscript} and not ${moderationHid}))`,
  );

const seatedScope = (actorId: string | null) =>
  actorId === null
    ? sql`false`
    : sql`exists (select 1 from ${roundParticipants} where ${roundParticipants.roundId} = ${rounds.id} and ${roundParticipants.actorId} = ${actorId} and ${currentRoundParticipant(roundParticipants.id)})`;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** Title, resolution or a debater's name; a judge is never searchable. */
const searched = (q: string): SQL | undefined => {
  if (q === '') return undefined;
  const like = `%${escapeLike(q)}%`;
  return sql`(${rooms.title} ilike ${like} or ${rounds.resolution} ilike ${like} or exists (
    select 1 from round_participants p
    join actors a on a.id = p.actor_id
    join users u on u.id = a.user_id
    where p.round_id = ${rounds.id} and p.seat_kind <> 'judge' and u.username ilike ${like}))`;
};

const durationMs = sql<
  number | null
>`(${recordings.lifecycle}->'media'->>'durationMs')::int`;

const sortKeys = {
  newest: rounds.completedAt,
  longest: sql`coalesce(${durationMs}, -1)`,
} as const;

const cursorRound = {
  id: sql`c.id`,
  status: sql`c.status`,
  competitionType: sql`c.competition_type`,
  completedAt: sql`c.completed_at`,
};

/**
 * A cursor outside the viewer's scope reads as a missing one, so polling a live or
 * private Round's id learns nothing of when it ended.
 */
const cursorInScope = (input: ArchiveInput): SQL =>
  input.query.scope === 'mine'
    ? input.viewerActorId === null
      ? sql`false`
      : sql`exists (select 1 from round_participants p where p.round_id = c.id and p.actor_id = ${input.viewerActorId} and public.daisy_round_participant_is_current(p.id))`
    : sql`coalesce((select v.visibility from rooms v where v.id = c.room_id), c.visibility, 'private') = 'public'
        and (not ${youthRoundSql(sql`c.id`)} or ${youthShared(sql`c.id`, input.youthPublishing)})
        and ${factReleasedSql(sql`c.completed_at`, cursorRound, input.clock)}`;

/** Compared in SQL against the cursor's own row, so no precision is lost in JS. */
const afterCursor = (input: ArchiveInput): SQL | undefined => {
  const { before, sort } = input.query;
  if (before === '') return undefined;
  return sort === 'newest'
    ? sql`(${rounds.completedAt}, ${rounds.id}) < (select c.completed_at, c.id from rounds c where c.id = ${before} and ${cursorInScope(input)})`
    : sql`(coalesce(${durationMs}, -1), ${rounds.id}) < (
        select coalesce((r.lifecycle->'media'->>'durationMs')::int, -1), c.id
        from rounds c left join recordings r on r.round_id = c.id where c.id = ${before} and ${cursorInScope(input)})`;
};

/**
 * The archive, paged and filtered in SQL. This is a narrowing, not the authority:
 * the feature decides each row again for the viewer before showing it.
 */
export const recordingArchiveReadOperations = ({
  database,
}: {
  readonly database: TxSource;
}) => ({
  async listRecordingArchive(input: ArchiveInput) {
    const { query } = input;
    return inTransaction(database, async (tx) => {
      const page = await tx
        .select({
          id: rounds.id,
          title: rooms.title,
          resolution: rounds.resolution,
          competitionType: rounds.competitionType,
          visibility,
          hostActorId: rounds.createdByActorId,
          completedAt: rounds.completedAt,
          winningSide: rounds.winningSide,
          ranking: rounds.ranking,
          rules: rounds.rulesSnapshot,
          capture: rounds.capture,
          youthRound: youthRoundSql(sql`${rounds.id}`).mapWith(Boolean),
          youthPublic: youthShared(
            sql`${rounds.id}`,
            input.youthPublishing,
          ).mapWith(Boolean),
          status: recordings.status,
          durationMs,
          hasTranscript,
          horizon: sql<
            Date | string | null
          >`${spectatorHorizonSql(roundColumns, input.clock)}`,
          stopped: sql<boolean>`${broadcasts.stoppedAt} is not null`,
          mediaWithheld: operatorWithheldSql(sql`${broadcasts}`).mapWith(
            Boolean,
          ),
        })
        .from(rounds)
        .leftJoin(rooms, eq(rooms.id, rounds.roomId))
        .leftJoin(recordings, eq(recordings.roundId, rounds.id))
        .leftJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
        .where(
          and(
            finishedWithSomethingToFind,
            query.scope === 'mine'
              ? seatedScope(input.viewerActorId)
              : publicScope(input.clock, input.youthPublishing),
            query.mode === 'any'
              ? undefined
              : eq(rounds.competitionType, query.mode),
            searched(query.q),
            afterCursor(input),
          ),
        )
        .orderBy(desc(sortKeys[query.sort]), desc(rounds.id))
        .limit(input.limit + 1);
      const shown = page.slice(0, input.limit);
      const seats = await Promise.all(
        shown.map((row) =>
          tx
            .select({
              actorId: roundParticipants.actorId,
              seatKind: roundParticipants.seatKind,
            })
            .from(roundParticipants)
            .where(
              and(
                eq(roundParticipants.roundId, row.id),
                currentRoundParticipant(roundParticipants.id),
              ),
            ),
        ),
      );
      const named = await namedSeats(
        tx,
        shown.map((row) => row.id),
      );
      return {
        nextBefore:
          page.length > input.limit ? (shown.at(-1)?.id ?? null) : null,
        rows: shown.map((row, index) => ({
          id: row.id,
          title: row.title,
          resolution: row.resolution,
          competitionType: row.competitionType,
          visibility: row.visibility,
          hostActorId: row.hostActorId,
          completedAtMs: row.completedAt?.getTime() ?? null,
          capture: row.capture,
          /** A Youth Round reaches only its own seated people's list (PYL-5, ADR 0157). */
          youthRound: row.youthRound === true,
          /** Shared by a debater, with publishing open (ADR 0151). */
          youthPublic: row.youthPublic === true,
          sides: row.rules.sides,
          outcome: outcomeOfColumns(row, row.rules),
          status: row.status,
          durationMs: row.durationMs,
          hasTranscript: row.hasTranscript,
          seatedActorIds: (seats[index] ?? []).map((seat) => seat.actorId),
          /** The judge and moderator seats' actors: who an officials' Recording is for. */
          officialActorIds: (seats[index] ?? [])
            .filter(
              (seat) =>
                seat.seatKind === 'judge' || seat.seatKind === 'moderator',
            )
            .map((seat) => seat.actorId),
          debaters: (named.get(row.id) ?? [])
            .filter((seat) => !isJudgeSeat(seat.seat))
            .map((seat) => ({ seat: seat.seat, label: seat.label })),
          release: {
            releasedThroughMs:
              row.horizon === null ? null : new Date(row.horizon).getTime(),
            stop: broadcastStopOf(row.stopped === true, row.mediaWithheld),
          },
        })),
      };
    });
  },

  async countPublicRecordingArchive(input: {
    readonly clock: SpectatorClock;
    readonly youthPublishing: boolean;
  }) {
    const [row] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(rounds)
      .leftJoin(rooms, eq(rooms.id, rounds.roomId))
      .leftJoin(recordings, eq(recordings.roundId, rounds.id))
      .leftJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
      .where(
        and(
          finishedWithSomethingToFind,
          publicScope(input.clock, input.youthPublishing),
        ),
      );
    return row?.count ?? 0;
  },
});
