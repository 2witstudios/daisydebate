import type { CompetitionType, RecordingStatus } from '@daisy/protocol';
import { and, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { broadcastStopOf } from './broadcast-operations';
import { historyRows } from './member-history-rows';
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
};

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
const publicScope = (clock: SpectatorClock) =>
  and(
    sql`${visibility} = 'public'`,
    factReleasedSql(rounds.completedAt, roundColumns, clock),
    sql`((${recordings.status} = 'ready' and ${broadcasts.mediaWithheld} is not true) or (${rounds.competitionType} = 'ranked' and ${hasTranscript} and not ${moderationHid}))`,
  );

const seatedScope = (actorId: string | null) =>
  actorId === null
    ? sql`false`
    : sql`exists (select 1 from ${roundParticipants} where ${roundParticipants.roundId} = ${rounds.id} and ${roundParticipants.actorId} = ${actorId})`;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** Title, resolution or a debater's name; a judge is never searchable. */
const searched = (q: string): SQL | undefined => {
  if (q === '') return undefined;
  const like = `%${escapeLike(q)}%`;
  return sql`(${rooms.title} ilike ${like} or ${rounds.resolution} ilike ${like} or exists (
    select 1 from round_participants p
    join actors a on a.id = p.actor_id
    join users u on u.id = a.user_id
    where p.round_id = ${rounds.id} and p.role <> 'judge' and u.username ilike ${like}))`;
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
      : sql`exists (select 1 from round_participants p where p.round_id = c.id and p.actor_id = ${input.viewerActorId})`
    : sql`coalesce((select v.visibility from rooms v where v.id = c.room_id), c.visibility, 'private') = 'public'
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
  readonly database: BunSQLDatabase;
}) => ({
  async listRecordingArchive(input: ArchiveInput) {
    const { query } = input;
    return database.transaction(async (tx) => {
      const page = await tx
        .select({
          id: rounds.id,
          title: rooms.title,
          resolution: rounds.resolution,
          competitionType: rounds.competitionType,
          visibility,
          hostActorId: rounds.createdByActorId,
          completedAt: rounds.completedAt,
          outcome: rounds.outcome,
          status: recordings.status,
          durationMs,
          hasTranscript,
          horizon: sql<
            Date | string | null
          >`${spectatorHorizonSql(roundColumns, input.clock)}`,
          stopped: sql<boolean>`${broadcasts.stoppedAt} is not null`,
          mediaWithheld: broadcasts.mediaWithheld,
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
              : publicScope(input.clock),
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
            .select({ actorId: roundParticipants.actorId })
            .from(roundParticipants)
            .where(eq(roundParticipants.roundId, row.id)),
        ),
      );
      const named = await historyRows(
        tx,
        shown.map((row) => ({
          roundId: row.id,
          completedAt: row.completedAt,
          resolution: row.resolution,
          visibility: 'private',
          outcome: row.outcome,
          role: 'affirmative',
        })),
      );
      return {
        nextBefore:
          page.length > input.limit ? (shown.at(-1)?.id ?? null) : null,
        rows: shown.map((row, index) => ({
          id: row.id,
          title: row.title,
          resolution: row.resolution,
          competitionType: row.competitionType as CompetitionType,
          visibility: row.visibility,
          hostActorId: row.hostActorId,
          completedAtMs: row.completedAt?.getTime() ?? null,
          outcome: row.outcome as string | null,
          status: row.status as RecordingStatus | null,
          durationMs: row.durationMs,
          hasTranscript: row.hasTranscript,
          seatedActorIds: (seats[index] ?? []).map((seat) => seat.actorId),
          debaters: (named[index]?.seats ?? [])
            .filter((seat) => seat.role !== 'judge')
            .map((seat) => ({ role: seat.role as string, label: seat.label })),
          release: {
            releasedThroughMs:
              row.horizon === null ? null : new Date(row.horizon).getTime(),
            stop: broadcastStopOf(row.stopped === true, row.mediaWithheld),
          },
        })),
      };
    });
  },

  async countPublicRecordingArchive(input: { readonly clock: SpectatorClock }) {
    const [row] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(rounds)
      .leftJoin(rooms, eq(rooms.id, rounds.roomId))
      .leftJoin(recordings, eq(recordings.roundId, rounds.id))
      .leftJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
      .where(and(finishedWithSomethingToFind, publicScope(input.clock)));
    return row?.count ?? 0;
  },
});
