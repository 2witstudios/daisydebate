import { settings } from '../schema/settings';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { ladders } from '../schema/ladders';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { seasons } from '../schema/seasons';
import { ratings, ratingChanges } from '../schema/ratings';
import { rounds } from '../schema/rounds';
import { roundParticipants } from '../schema/round-participants';
import { readEndingRatingFacts } from '../rating-discovery';
import { scopeTransaction } from '../tenant-scope';
import {
  certifiedRatingActors,
  loadLeagueCertifiedRatingInputs,
  type CertifiedSourceAuthority,
} from './league-certified-rating-inputs';
import { loadLobbyAuthority } from './lobby-authority';
import {
  readActivePublishedRatings,
  type PublishStandings,
  type StandingsRead,
} from '../standings';
import type { SpectatorClock } from '../spectator-release-sql';
import type { TabDatabase, TabTransaction } from './tab-transaction';

/** Supplies the lobby's active-season projections and certified competition inputs. */
export async function loadLeagueRatingInputs(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly ladderId: string;
    readonly allowedOrganizationIds?: readonly string[];
    readonly publicAt?: string;
    readonly canReadSource?: (source: CertifiedSourceAuthority) => boolean;
  },
) {
  const [home] = await tx
    .select({ ladder: ladders, lobby: lobbies })
    .from(ladders)
    .innerJoin(lobbies, eq(lobbies.id, ladders.lobbyId))
    .innerJoin(organizations, eq(organizations.id, ladders.organizationId))
    .where(
      and(eq(ladders.id, input.ladderId), eq(organizations.kind, 'league')),
    );
  if (
    !home ||
    (input.allowedOrganizationIds &&
      !input.allowedOrganizationIds.includes(home.ladder.organizationId))
  )
    return null;
  const scope = {
    subjectUserId: input.viewerUserId,
    organizationId: home.ladder.organizationId,
    lobbyId: home.lobby.id,
  };
  await scopeTransaction(tx, scope);
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(
      and(eq(seasons.lobbyId, home.lobby.id), eq(seasons.status, 'active')),
    )
    .for('share');
  const tournaments = season
    ? await loadLeagueCertifiedRatingInputs(tx, {
        viewerUserId: input.viewerUserId,
        organizationId: home.ladder.organizationId,
        seasonId: season.id,
        ...(input.publicAt ? { publicAt: input.publicAt } : {}),
        ...(input.canReadSource ? { canReadSource: input.canReadSource } : {}),
      })
    : [];
  await scopeTransaction(tx, scope);
  const seasonRounds = season
    ? and(
        eq(rounds.ladderId, home.ladder.id),
        eq(rounds.seasonId, season.id),
        eq(rounds.status, 'completed'),
      )
    : sql`false`;
  const [hasLegacyRounds] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(seasonRounds, eq(rounds.legacyLeagueRating, true)))
    .limit(1);
  const replayRounds = and(
    seasonRounds,
    or(
      eq(rounds.legacyLeagueRating, true),
      sql`exists (select 1 from ${ratingChanges} c where c.round_id=${rounds.id})`,
    ),
  );
  const completedRounds =
    tournaments.length || hasLegacyRounds
      ? await tx
          .select({
            id: rounds.id,
            rules: rounds.rulesSnapshot,
            legacy: rounds.legacyLeagueRating,
            playedAt:
              sql<Date>`case when ${rounds.legacyLeagueRating} then ${rounds.completedAt}
            else max(${ratingChanges.occurredAt}) end`.mapWith(
                ratingChanges.occurredAt,
              ),
          })
          .from(rounds)
          .leftJoin(ratingChanges, eq(ratingChanges.roundId, rounds.id))
          .where(replayRounds)
          .groupBy(rounds.id)
      : [];
  // The same ending facts Daisy's ratings read: the engine's `endingRating`
  // decides which of these Rounds the ladder counts.
  const endings = new Map(
    (
      await readEndingRatingFacts(
        tx,
        completedRounds.map((round) => round.id),
      )
    ).map((read) => [read.roundId, read.facts]),
  );
  const roomRounds = completedRounds.map((round) => ({
    ...round,
    ending: endings.get(round.id) ?? null,
  }));
  const participants = roomRounds.length
    ? await tx
        .select({
          roundId: roundParticipants.roundId,
          actorId: roundParticipants.actorId,
          side: roundParticipants.side,
        })
        .from(roundParticipants)
        .where(
          and(
            // The same completed league Rounds, by subquery rather than a
            // bound id per Round.
            inArray(
              roundParticipants.roundId,
              tx.select({ id: rounds.id }).from(rounds).where(replayRounds),
            ),
            eq(roundParticipants.seatKind, 'side'),
          ),
        )
    : [];
  const standings = season
    ? await tx
        .select({
          actorId: ratings.actorId,
          rating: ratings.rating,
          deviation: ratings.deviation,
          volatility: ratings.volatility,
          games: sql<number>`count(${ratingChanges.id})::int`,
          wins: sql<number>`(count(${ratingChanges.id}) filter (where ${rounds.winningSide}=${roundParticipants.side}))::int`,
          lastRatedAt: sql<
            string | null
          >`to_char(max(${ratingChanges.occurredAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
          change: sql<number>`(array_agg(${ratingChanges.ratingAfter}-${ratingChanges.ratingBefore} order by ${ratingChanges.occurredAt} desc))[1]`,
        })
        .from(ratings)
        .innerJoin(
          ratingChanges,
          and(
            eq(ratingChanges.actorId, ratings.actorId),
            eq(ratingChanges.ladder, ratings.ladder),
            eq(ratingChanges.seasonId, ratings.seasonId),
          ),
        )
        .innerJoin(rounds, eq(rounds.id, ratingChanges.roundId))
        .innerJoin(
          roundParticipants,
          and(
            eq(roundParticipants.roundId, rounds.id),
            eq(roundParticipants.ratingActorId, ratings.actorId),
          ),
        )
        .where(
          and(
            eq(ratings.ladder, home.ladder.id),
            eq(ratings.seasonId, season.id),
          ),
        )
        .groupBy(ratings.actorId, ratings.ladder, ratings.seasonId)
    : [];
  const actorIds = [
    ...new Set([
      ...standings.map((row) => row.actorId),
      ...participants.map((row) => row.actorId),
      ...certifiedRatingActors(tournaments),
    ]),
  ];
  const actorRows = actorIds.length
    ? await tx
        .select({ actorId: actors.id, username: users.username })
        .from(actors)
        .innerJoin(users, eq(users.id, actors.userId))
        .where(inArray(actors.id, actorIds))
    : [];
  const postingSettings = await tx
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.key, 'audience.posting'),
        or(
          and(
            eq(settings.scopeKind, 'organization'),
            eq(settings.organizationId, home.ladder.organizationId),
          ),
          and(
            eq(settings.scopeKind, 'lobby'),
            eq(settings.lobbyId, home.lobby.id),
          ),
        ),
      ),
    );
  return {
    ...home,
    standings,
    roomRounds,
    participants,
    tournaments,
    actors: actorRows,
    postingSettings,
  };
}
export type LeagueRatingInputs = NonNullable<
  Awaited<ReturnType<typeof loadLeagueRatingInputs>>
>;
export const createLeagueRatingStore = (database: TabDatabase) => ({
  leagueRatings: <Answer>(
    input: {
      readonly viewerUserId: string;
      readonly lobbyId: string;
      readonly canReadSource?: (source: CertifiedSourceAuthority) => boolean;
    },
    work: (
      facts: {
        readonly authority: NonNullable<
          Awaited<ReturnType<typeof loadLobbyAuthority>>
        >;
        readonly input: LeagueRatingInputs;
        readonly publicStandings: (
          clock: SpectatorClock,
          publish: PublishStandings,
        ) => Promise<StandingsRead>;
      } | null,
    ) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      const authority = await loadLobbyAuthority(tx, input);
      if (
        !authority ||
        authority.lobby.kind !== 'standing' ||
        authority.authorization.organization?.organizationKind !== 'league'
      )
        return work(null);
      const [ladder] = await tx
        .select()
        .from(ladders)
        .where(eq(ladders.lobbyId, authority.lobby.id))
        .orderBy(asc(ladders.createdAt), asc(ladders.id))
        .limit(1);
      const facts = ladder
        ? await loadLeagueRatingInputs(tx, {
            viewerUserId: input.viewerUserId,
            ladderId: ladder.id,
            publicAt: authority.checkedAt,
            ...(input.canReadSource
              ? { canReadSource: input.canReadSource }
              : {}),
          })
        : null;
      return work(
        facts
          ? {
              authority,
              input: facts,
              publicStandings: async (clock, publish) =>
                (
                  await readActivePublishedRatings(
                    tx,
                    {
                      lobbyId: authority.lobby.id,
                      clock,
                      leaguePublication: true,
                    },
                    publish,
                  )
                )?.standings ?? { ratings: [], changes: [] },
            }
          : null,
      );
    }),
});
