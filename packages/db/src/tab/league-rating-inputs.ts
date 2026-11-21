import { settings } from '../schema/settings';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { ladders } from '../schema/ladders';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { rounds } from '../schema/rounds';
import { roundParticipants } from '../schema/round-participants';
import { readEndingRatingFacts } from '../rating-discovery';
import { scopeTransaction } from '../tenant-scope';
import { loadLeagueCertifiedRatingInputs } from './league-certified-rating-inputs';
import { loadLobbyAuthority } from './lobby-authority';
import { inTransaction, type Tx, type TxOpener } from '../tx';

/** Named, read-only competitive input. Never reads or writes Daisy's ratings. */
export async function loadLeagueRatingInputs(
  tx: Tx,
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
  const completedRounds = await tx
    .select({ id: rounds.id, rules: rounds.rulesSnapshot })
    .from(rounds)
    .where(
      and(
        eq(rounds.leagueLadderId, home.ladder.id),
        eq(rounds.status, 'completed'),
      ),
    )
    .orderBy(asc(rounds.completedAt), asc(rounds.id));
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
              tx
                .select({ id: rounds.id })
                .from(rounds)
                .where(
                  and(
                    eq(rounds.leagueLadderId, home.ladder.id),
                    eq(rounds.status, 'completed'),
                  ),
                ),
            ),
            eq(roundParticipants.seatKind, 'side'),
          ),
        )
    : [];
  const tournaments = await loadLeagueCertifiedRatingInputs(tx, {
    viewerUserId: input.viewerUserId,
    organizationId: home.ladder.organizationId,
  });
  await scopeTransaction(tx, scope);
  const actorIds = [
    ...new Set([
      ...participants.map((row) => row.actorId),
      ...tournaments.flatMap((row) =>
        row.competitionRecord.kind === 'decided'
          ? row.competitionRecord.cast
              .filter((member) => member.entryId !== null)
              .map((member) => member.actorId)
          : row.competitionRecord.fixture.entries.flatMap(
              (entry) => entry.members,
            ),
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
export const createLeagueRatingStore = (database: TxOpener) => ({
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
    inTransaction(database, async (tx) => {
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
