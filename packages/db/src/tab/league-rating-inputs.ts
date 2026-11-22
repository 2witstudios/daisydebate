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
import { scopeTransaction } from '../tenant-scope';
import {
  certifiedRatingActors,
  loadLeagueCertifiedRatingInputs,
  type CertifiedSourceAuthority,
} from './league-certified-rating-inputs';
import { loadLobbyAuthority } from './lobby-authority';
import { configuredStandingLadder } from '../league-room-selection';
import {
  ratedSeat,
  readLobbyPublishedRatings,
  type PublishStandings,
  type StandingsRead,
} from '../standings';
import type { SpectatorClock } from '../spectator-release-sql';
import { inTransaction, type Tx, type TxOpener } from '../tx';

/** Supplies the lobby's active-season projections and certified competition inputs. */
export async function loadLeagueRatingInputs(
  tx: Tx,
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
  const postings =
    season && tournaments.length
      ? await tx
          .select({
            seasonId: ratingChanges.seasonId,
            roundId: ratingChanges.roundId,
            actorId: ratingChanges.actorId,
            occurredAt: ratingChanges.occurredAt,
            side: roundParticipants.side,
            winningSide: rounds.winningSide,
          })
          .from(ratingChanges)
          .innerJoin(rounds, eq(rounds.id, ratingChanges.roundId))
          .innerJoin(
            roundParticipants,
            and(
              eq(roundParticipants.roundId, rounds.id),
              eq(roundParticipants.ratingActorId, ratingChanges.actorId),
            ),
          )
          .where(
            and(
              eq(ratingChanges.lobbyId, home.lobby.id),
              eq(ratingChanges.ladder, home.ladder.id),
              eq(ratingChanges.seasonId, season.id),
              eq(roundParticipants.seatKind, 'side'),
            ),
          )
      : [];
  const roomPostings = postings.map(
    ({ occurredAt, side, winningSide, ...row }) => ({
      ...row,
      occurredAt: occurredAt.toISOString(),
      ...ratedSeat(side, winningSide),
    }),
  );
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
            eq(roundParticipants.seatKind, 'side'),
          ),
        )
        .groupBy(ratings.actorId, ratings.ladder, ratings.seasonId)
    : [];
  const actorIds = [
    ...new Set([
      ...standings.map((row) => row.actorId),
      ...roomPostings.map((row) => row.actorId),
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
    roomPostings,
    tournaments,
    actors: actorRows,
    postingSettings,
  };
}
export type LeagueRatingInputs = NonNullable<
  Awaited<ReturnType<typeof loadLeagueRatingInputs>>
>;
export const createLeagueRatingStore = (database: TxOpener) => ({
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
    inTransaction(
      database,
      async (tx) => {
        const authority = await loadLobbyAuthority(tx, input);
        if (
          !authority ||
          authority.lobby.kind !== 'standing' ||
          !authority.lobby.ownerOrganizationId ||
          authority.authorization.organization?.organizationKind !== 'league'
        )
          return work(null);
        const configured = await configuredStandingLadder(tx, {
          organizationId: authority.lobby.ownerOrganizationId,
          lobbyId: authority.lobby.id,
          templateId: null,
        });
        const [primary] = configured
          ? []
          : await tx
              .select({ id: ladders.id })
              .from(ladders)
              .where(eq(ladders.lobbyId, authority.lobby.id))
              .orderBy(asc(ladders.createdAt), asc(ladders.id))
              .limit(1);
        const ladderId = configured ?? primary?.id;
        const facts = ladderId
          ? await loadLeagueRatingInputs(tx, {
              viewerUserId: input.viewerUserId,
              ladderId,
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
                    await readLobbyPublishedRatings(
                      tx,
                      {
                        lobbyId: authority.lobby.id,
                        ladderId: facts.ladder.id,
                        clock,
                        leaguePublication: true,
                      },
                      publish,
                    )
                  )?.standings ?? { ratings: [], changes: [] },
              }
            : null,
        );
      },
      { isolationLevel: 'repeatable read' },
    ),
});
