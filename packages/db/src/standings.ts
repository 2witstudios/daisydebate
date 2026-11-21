import { createAppError } from '@daisy/errors';
import {
  ratingStyles,
  sideKeySchema,
  type SideKey,
  type WinnerOutcome,
} from '@daisy/protocol';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readOfficialRatingLadderCatalog } from './official-standing-lobbies';
import { isDebatingSeatSql } from './seat-columns';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { formatPresets } from './schema/format-presets';
import { formats } from './schema/formats';
import { ladders } from './schema/ladders';
import { lobbies } from './schema/lobbies';
import { organizations } from './schema/organizations';
import { ratingChanges, ratings } from './schema/ratings';
import { seasons } from './schema/seasons';
import { users } from './schema/users';
import { listSeasonRecords, type SeasonRecord } from './season-record';
import { factReleasedSql, type SpectatorClock } from './spectator-release-sql';
import { releasedStandings } from './standings-release';
import { scopeTransaction } from './tenant-scope';
import {
  certifiedRatingActors,
  loadLeagueCertifiedRatingInputs,
  type CertifiedRatingResults,
} from './tab/league-certified-rating-inputs';
import type { TabTransaction } from './tab/tab-transaction';

/**
 * The leaderboard's reads (ADR 0055): the seasons a ladder can show, the
 * ranked formats, and one format and ladder's rows for a set of seasons.
 * Rows only: what they add up to (record, movement, rank) is the feature's
 * pure `summarizeStandings`.
 */

/** A debater's current state on the ladder in one season. */
export type StandingRating = {
  readonly seasonId: string;
  readonly actorId: string;
  /** Null for an actor with no account. */
  readonly username: string | null;
  /** The account is closed; its name stays on the ladder (ADR 0087). */
  readonly accountClosed: boolean;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

/** One ledger posting, with the debater's side and the debate's winning side. */
export type StandingChange = {
  readonly seasonId: string;
  readonly actorId: string;
  readonly roundId: string;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly deviationBefore: number;
  readonly deviationAfter: number;
  readonly occurredAt: string;
  /** A rating compares the two sides (ADR 0055): the preset's pair. */
  readonly side: SideKey;
  readonly outcome: WinnerOutcome;
};

export type StandingsRead = {
  readonly ratings: readonly StandingRating[];
  readonly changes: readonly StandingChange[];
  readonly certified?: readonly StandingCertification[];
  readonly publicResults?: {
    readonly replaySeasonIds: readonly string[];
    readonly rooms: readonly RoomRatingPosting[];
    readonly people: readonly StandingPerson[];
  };
};

type StandingPerson = Pick<
  StandingRating,
  'actorId' | 'username' | 'accountClosed'
>;
type RoomRatingPosting = Pick<
  StandingChange,
  'seasonId' | 'roundId' | 'actorId' | 'occurredAt' | 'side' | 'outcome'
>;

type StandingCertification = {
  readonly seasonId: string;
  readonly records: CertifiedRatingResults;
  readonly people: readonly StandingPerson[];
};

const publishedCertifications = async (
  tx: TabTransaction,
  input: {
    readonly lobbyId: string;
    readonly seasonIds: readonly string[];
    readonly publicAt: string;
    readonly leaguePublication?: boolean;
  },
): Promise<StandingCertification[]> => {
  const [owner] = await tx
    .select({ id: organizations.id })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .where(
      and(
        eq(lobbies.id, input.lobbyId),
        input.leaguePublication ? undefined : eq(organizations.official, true),
        isNull(lobbies.closedAt),
        isNull(organizations.closedAt),
      ),
    );
  if (!owner) return [];
  const seasonRows = await listSeasonRecords(tx, input.lobbyId);
  const published: StandingCertification[] = [];
  for (const { id: seasonId } of seasonRows) {
    if (!input.seasonIds.includes(seasonId)) continue;
    const records = await loadLeagueCertifiedRatingInputs(tx, {
      organizationId: owner.id,
      seasonId,
      publicAt: input.publicAt,
    });
    if (records.length === 0) continue;
    const ids = [...new Set(certifiedRatingActors(records))];
    const people =
      ids.length === 0
        ? []
        : await tx
            .select({
              actorId: actors.id,
              username: users.username,
              closedAt: users.deletedAt,
            })
            .from(actors)
            .leftJoin(users, eq(users.id, actors.userId))
            .where(inArray(actors.id, ids));
    published.push({
      seasonId,
      records,
      people: people.map(({ closedAt, ...person }) => ({
        ...person,
        accountClosed: closedAt !== null,
      })),
    });
  }
  return published;
};

/**
 * A posting's side and outcome as a rated result. A ledger row is only ever
 * written for a debater's side of a Round a side won, so anything else is
 * corrupt data and is refused rather than guessed.
 */
export function ratedSeat(
  side: string | null,
  winningSide: string | null,
): Pick<StandingChange, 'side' | 'outcome'> {
  const seat = sideKeySchema.safeParse(side);
  const winner = sideKeySchema.safeParse(winningSide);
  if (!seat.success || !winner.success)
    throw createAppError(
      'INTERNAL',
      'A ledger posting has no rated seat or outcome',
    );
  return { side: seat.data, outcome: { kind: 'winner', side: winner.data } };
}

export const standingsOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Ratings hidden from a member until their current judging assignment is ruled. */
  async readRatingBlindings(viewerActorId: string): Promise<readonly string[]> {
    const rows =
      await database.execute(sql`select distinct opponent.actor_id from round_participants judge
      join rounds r on r.id=judge.round_id
      join round_participants opponent on opponent.round_id=r.id and ${isDebatingSeatSql(sql`opponent.seat_kind`)}
      where judge.actor_id=${viewerActorId} and judge.seat_kind='judge' and r.status in ('opening','active')
      and not exists(select 1 from ballots b where b.judge_participant_id=judge.id)`);
    return (rows as unknown as { actor_id: string }[]).map(
      (row) => row.actor_id,
    );
  },

  /** The seasons a ladder can show, newest start first. */
  listLadderSeasons(lobbyId?: string): Promise<readonly SeasonRecord[]> {
    return instrumented(eventSink, 'listLadderSeasons', () =>
      listSeasonRecords(database, lobbyId),
    );
  },

  /** Standing lobbies offered on the public leaderboard, with their published ladders. */
  listOfficialRatingLadders() {
    return readOfficialRatingLadderCatalog(database);
  },

  /**
   * Formats that rate, by name: the ones with a current approved preset.
   * Ranked availability is constructed from presets (ADR 0058 §4), so a
   * format without one never reaches a ladder.
   */
  listRankedFormats(): Promise<
    readonly { readonly id: string; readonly name: string }[]
  > {
    return instrumented(eventSink, 'listRankedFormats', () =>
      database
        .selectDistinct({ id: formats.id, name: formats.name })
        .from(formats)
        .innerJoin(
          formatPresets,
          and(
            eq(formatPresets.formatId, formats.id),
            isNull(formatPresets.supersededAt),
            eq(formatPresets.rankedEligible, true),
            eq(formatPresets.formatVersion, formats.currentVersion),
            inArray(formats.id, [...ratingStyles]),
          ),
        )
        .orderBy(asc(formats.name)),
    );
  },

  /**
   * One ladder's ratings and ledger rows in the given seasons, as
   * the audience may know them at `now`: a posting waits for its Round's
   * spectator timeline, and a rating stands where its last released posting
   * left it. `revealRoundId` names a Round the caller already holds an
   * authorized read of, whose own postings need no wait.
   */
  readStandings(input: StandingsInput): Promise<StandingsRead> {
    return instrumented(eventSink, 'readStandings', () =>
      input.seasonIds.length === 0
        ? Promise.resolve({ ratings: [], changes: [] })
        : database.transaction((tx) => readStandingsWithin(tx, input), {
            isolationLevel: 'repeatable read',
            accessMode: 'read only',
          }),
    );
  },
});

type StandingsInput = {
  readonly ladderId: string;
  readonly lobbyId: string;
  readonly seasonIds: readonly string[];
  readonly clock: SpectatorClock;
  readonly revealRoundId?: string;
  readonly includeCertified?: boolean;
  /** The caller has authorized publication on a league's own lobby page. */
  readonly leaguePublication?: boolean;
};

export type PublishStandings = (source: StandingsRead) => StandingsRead;

export type LobbyRatingSelection = {
  readonly lobbyId: string;
  readonly ladderId: string;
  readonly seasonId?: string;
};

/** Read the selected ladder in the active season or a Room's frozen season. */
export async function readLobbyPublishedRatings(
  tx: TabTransaction,
  input: Pick<
    StandingsInput,
    'lobbyId' | 'ladderId' | 'clock' | 'leaguePublication'
  > & {
    readonly seasonId?: string;
  },
  publish?: PublishStandings,
) {
  const [pool] = await tx
    .select({ seasonId: seasons.id, ladderId: ladders.id })
    .from(seasons)
    .innerJoin(ladders, eq(ladders.lobbyId, seasons.lobbyId))
    .where(
      and(
        eq(seasons.lobbyId, input.lobbyId),
        input.seasonId
          ? eq(seasons.id, input.seasonId)
          : eq(seasons.status, 'active'),
        eq(ladders.id, input.ladderId),
      ),
    )
    .limit(1);
  if (!pool) return null;
  const standings = await readStandingsWithin(tx, {
    ...input,
    ladderId: pool.ladderId,
    seasonIds: [pool.seasonId],
    includeCertified: publish !== undefined,
  });
  return { ...pool, standings: publish ? publish(standings) : standings };
}

/** Load projections and their inputs from the caller's one database snapshot. */
async function readStandingsWithin(
  tx: TabTransaction,
  input: StandingsInput,
): Promise<StandingsRead> {
  if (input.seasonIds.length === 0) return { ratings: [], changes: [] };
  await scopeTransaction(tx, { lobbyId: input.lobbyId });
  const ratingRows = await tx
    .select({
      seasonId: ratings.seasonId,
      actorId: ratings.actorId,
      username: users.username,
      closedAt: users.deletedAt,
      rating: ratings.rating,
      deviation: ratings.deviation,
      volatility: ratings.volatility,
    })
    .from(ratings)
    .innerJoin(actors, eq(actors.id, ratings.actorId))
    .leftJoin(users, eq(users.id, actors.userId))
    .where(
      and(
        eq(ratings.ladder, input.ladderId),
        eq(ratings.lobbyId, input.lobbyId),
        inArray(ratings.seasonId, [...input.seasonIds]),
      ),
    );
  const changeRows = await tx
    .select({
      seasonId: ratingChanges.seasonId,
      actorId: ratingChanges.actorId,
      roundId: ratingChanges.roundId,
      ratingBefore: ratingChanges.ratingBefore,
      ratingAfter: ratingChanges.ratingAfter,
      deviationBefore: ratingChanges.deviationBefore,
      deviationAfter: ratingChanges.deviationAfter,
      volatilityBefore: ratingChanges.volatilityBefore,
      occurredAt: ratingChanges.occurredAt,
      side: roundParticipants.side,
      winningSide: rounds.winningSide,
      released: sql<boolean>`${rounds.visibility} = 'public' and ${factReleasedSql(
        sql`greatest(${ratingChanges.occurredAt}, ${rounds.completedAt})`,
        rounds,
        input.clock,
      )}`,
    })
    .from(ratingChanges)
    .innerJoin(rounds, eq(rounds.id, ratingChanges.roundId))
    .innerJoin(
      roundParticipants,
      and(
        eq(roundParticipants.roundId, ratingChanges.roundId),
        eq(roundParticipants.ratingActorId, ratingChanges.actorId),
      ),
    )
    .where(
      and(
        eq(ratingChanges.ladder, input.ladderId),
        eq(ratingChanges.lobbyId, input.lobbyId),
        inArray(ratingChanges.seasonId, [...input.seasonIds]),
        eq(roundParticipants.seatKind, 'side'),
      ),
    );
  const certified = input.includeCertified
    ? await publishedCertifications(tx, {
        ...input,
        publicAt: input.clock.now,
      })
    : [];
  const standings = ratingRows.map(({ closedAt, ...row }) => ({
    ...row,
    username: row.username ?? null,
    accountClosed: closedAt !== null,
  }));
  const ledger = changeRows.map(
    ({ released, volatilityBefore, side, winningSide, ...row }) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      ...ratedSeat(side, winningSide),
      released: released === true || row.roundId === input.revealRoundId,
      volatilityBefore,
    }),
  );
  const source = releasedStandings({
    ratings: standings,
    changes: ledger,
    includeUnposted: input.revealRoundId !== undefined,
  });
  const replaySeasonIds = [
    ...new Set(
      changeRows
        .filter(({ released }) => released !== true)
        .map(({ seasonId }) => seasonId),
    ),
  ];
  if (
    !input.includeCertified ||
    (certified.length === 0 && replaySeasonIds.length === 0)
  )
    return source;
  const rooms = ledger
    .filter(({ released }) => released)
    .map(({ seasonId, actorId, roundId, occurredAt, side, outcome }) => ({
      seasonId,
      actorId,
      roundId,
      occurredAt,
      side,
      outcome,
    }));
  const releasedActors = new Set(rooms.map(({ actorId }) => actorId));
  const people = standings
    .filter(({ actorId }) => releasedActors.has(actorId))
    .map(({ actorId, username, accountClosed }) => ({
      actorId,
      username,
      accountClosed,
    }));
  return {
    ...source,
    certified,
    publicResults: { rooms, people, replaySeasonIds },
  };
}
