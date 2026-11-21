import { and, eq, sql } from 'drizzle-orm';
import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  type RatingDivision,
  type RatingStyle,
  type RoundOutcome,
  type SeatRef,
} from '@daisy/protocol';
import { roundOutcomeSql } from './round-outcome-sql';
import { seatOfColumns, type SeatColumns } from './seat-columns';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readOfficialRatingLadderCatalog } from './official-standing-lobbies';
import {
  readLobbyPublishedRatings,
  type LobbyRatingSelection,
  type PublishStandings,
} from './standings';
import { lobbies as standingLobbies } from './schema/lobbies';
import { ratingDivisionForAgeRule } from '@daisy/protocol';
import {
  outcomeReleasedSql,
  roundAliasR,
  type SpectatorClock,
} from './spectator-release-sql';

type CardRatingRow = {
  readonly actorId: string;
  /** The ladder's style and division (ADR 0147). */
  readonly ladder: RatingStyle;
  readonly ladderId: string;
  readonly lobbyId: string;
  readonly division: RatingDivision;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
  readonly lastRatedAt: string | null;
};

type CardRecordRow = {
  readonly actorId: string;
  readonly status: string;
  readonly outcome: RoundOutcome | null;
  readonly seat: SeatRef;
  readonly rounds: number;
};

const readCardRatings = (
  database: BunSQLDatabase,
  actorIds: readonly string[],
  clock: SpectatorClock,
  publish?: PublishStandings,
  pool?: LobbyRatingSelection,
): Promise<readonly CardRatingRow[]> =>
  database.transaction(
    async (tx) => {
      const lobbies = pool
        ? (
            await tx
              .select({
                lobbyId: standingLobbies.id,
                ageRule: sql<LobbyAgeRule>`${standingLobbies.ageRule}`,
              })
              .from(standingLobbies)
              .where(
                and(
                  eq(standingLobbies.id, pool.lobbyId),
                  eq(standingLobbies.kind, 'standing'),
                ),
              )
          ).map((lobby) => ({ ...lobby, id: pool.ladderId }))
        : await readOfficialRatingLadderCatalog(tx);
      const requested = new Set(actorIds);
      const ratings: CardRatingRow[] = [];
      for (const lobby of lobbies) {
        const active = await readLobbyPublishedRatings(
          tx,
          pool
            ? { ...pool, clock, leaguePublication: true }
            : { lobbyId: lobby.lobbyId, ladderId: lobby.id, clock },
          publish,
        );
        if (!active) continue;
        const lastPosted = new Map<string, string>();
        for (const { actorId, occurredAt } of active.standings.changes)
          if (
            requested.has(actorId) &&
            occurredAt > (lastPosted.get(actorId) ?? '')
          )
            lastPosted.set(actorId, occurredAt);
        for (const row of active.standings.ratings) {
          if (!requested.has(row.actorId)) continue;
          ratings.push({
            actorId: row.actorId,
            rating: row.rating,
            deviation: row.deviation,
            volatility: row.volatility,
            lastRatedAt: lastPosted.get(row.actorId) ?? null,
            ladder: 'freestyle',
            ladderId: active.ladderId,
            lobbyId: lobby.lobbyId,
            division: ratingDivisionForAgeRule(lobby.ageRule),
          });
        }
      }
      return ratings;
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );

const actorIdArray = (actorIds: readonly string[]) =>
  sql`array[${sql.join(
    actorIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;

/**
 * What each person's card may show (ADR 0103, ADR 0142): their rating on each
 * Daisy ladder in the active season, and the shape of their public record,
 * taken as a named read of Ratings and Rounds. One read for a page of people.
 * Both wait for the spectator timeline,
 * so a card never tells the outcome of a Round still on its delay.
 */
export const memberCardOperations = ({
  database,
  ratingDatabase = database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly ratingDatabase?: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Public Rounds only, in either lobby, for any viewer. */
  readMemberCards: (
    actorIds: readonly string[],
    clock: SpectatorClock,
    publish?: PublishStandings,
  ) =>
    instrumented(eventSink, 'readMemberCards', async () => {
      if (actorIds.length === 0) return { ratings: [], records: [] };
      const ids = actorIdArray(actorIds);
      const recordsRead = database.execute(sql`
        select p.actor_id as "actorId", r.status, ${roundOutcomeSql('r')} as outcome,
          p.seat_kind as "seatKind", p.side, p.slot, count(*)::int as rounds
        from round_participants p join rounds r on r.id = p.round_id
        where p.actor_id = any(${ids}) and r.room_id is not null and r.visibility = 'public'
          and ${outcomeReleasedSql(roundAliasR, clock)}
        group by p.actor_id, r.status, 3, p.seat_kind, p.side, p.slot`);
      const [ratings, records] = (await Promise.all([
        readCardRatings(ratingDatabase, actorIds, clock, publish),
        recordsRead,
      ])) as unknown as [
        CardRatingRow[],
        (Omit<CardRecordRow, 'seat'> & SeatColumns)[],
      ];
      return {
        ratings,
        records: records.map(({ seatKind, side, slot, ...row }) => ({
          ...row,
          seat: seatOfColumns({ seatKind, side, slot }),
        })),
      };
    }),
  /**
   * The card's ratings alone, for one batch of seated actors (a Room's
   * seats, SEAT-7): the same released active-season read, without records.
   */
  readMemberCardRatings: (
    actorIds: readonly string[],
    clock: SpectatorClock,
    publish?: PublishStandings,
    pool?: LobbyRatingSelection,
  ) =>
    instrumented(eventSink, 'readMemberCardRatings', async () =>
      actorIds.length === 0
        ? []
        : readCardRatings(ratingDatabase, actorIds, clock, publish, pool),
    ),
});
