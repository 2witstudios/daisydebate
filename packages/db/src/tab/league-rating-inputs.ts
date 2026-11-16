import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { ladders } from '../schema/ladders';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { rounds } from '../schema/rounds';
import { roundFinalizations } from '../schema/round-finalizations';
import { roundParticipants } from '../schema/round-participants';
import { scopeTransaction } from '../tenant-scope';
import { loadLeagueEvents } from './league-events';
import { loadLobbyAuthority } from './lobby-authority';
import type { TabDatabase, TabTransaction } from './tab-transaction';

/** Named, read-only competitive input. Never reads or writes Daisy's ratings. */
export async function loadLeagueRatingInputs(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly ladderId: string;
    readonly allowedOrganizationIds?: readonly string[];
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
  const roomRounds = await tx
    .select({
      id: rounds.id,
      winningSide: rounds.winningSide,
      completedAt: rounds.completedAt,
      rules: rounds.rulesSnapshot,
    })
    .from(rounds)
    .innerJoin(roundFinalizations, eq(roundFinalizations.roundId, rounds.id))
    .where(
      and(
        eq(rounds.leagueLadderId, home.ladder.id),
        eq(rounds.status, 'completed'),
        isNotNull(rounds.completedAt),
        isNotNull(rounds.winningSide),
      ),
    )
    .orderBy(asc(rounds.completedAt), asc(rounds.id));
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
            inArray(
              roundParticipants.roundId,
              roomRounds.map((r) => r.id),
            ),
            eq(roundParticipants.seatKind, 'side'),
          ),
        )
    : [];
  const tournaments = await loadLeagueEvents(tx, {
    viewerUserId: input.viewerUserId,
    organizationId: home.ladder.organizationId,
  });
  await scopeTransaction(tx, scope);
  const actorIds = [
    ...new Set([
      ...participants.map((row) => row.actorId),
      ...tournaments.flatMap((row) =>
        row.competition.members.map((member) => member.actorId),
      ),
    ]),
  ];
  const actorRows = actorIds.length
    ? await tx
        .select({ actorId: actors.id, username: users.username })
        .from(actors)
        .innerJoin(users, eq(users.id, actors.userId))
        .where(inArray(actors.id, actorIds))
    : [];
  return { ...home, roomRounds, participants, tournaments, actors: actorRows };
}
export type LeagueRatingInputs = NonNullable<
  Awaited<ReturnType<typeof loadLeagueRatingInputs>>
>;
export const createLeagueRatingStore = (database: TabDatabase) => ({
  leagueRatings: <Answer>(
    input: { readonly viewerUserId: string; readonly lobbyId: string },
    work: (
      facts: {
        readonly authority: NonNullable<
          Awaited<ReturnType<typeof loadLobbyAuthority>>
        >;
        readonly input: LeagueRatingInputs;
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
        .where(eq(ladders.lobbyId, authority.lobby.id));
      const facts = ladder
        ? await loadLeagueRatingInputs(tx, {
            viewerUserId: input.viewerUserId,
            ladderId: ladder.id,
          })
        : null;
      return work(facts ? { authority, input: facts } : null);
    }),
});
