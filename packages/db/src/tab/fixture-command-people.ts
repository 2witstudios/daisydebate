import { and, eq, inArray } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { entryMembers } from '../schema/entries';
import { fixtureEntries, fixtureJudges, fixtures } from '../schema/fixtures';
import { tournamentJudges } from '../schema/tournament-judges';
import { roundParticipants } from '../schema/round-participants';
import { rounds } from '../schema/rounds';
import { currentRoundParticipant } from '../round-current-participant';
import type { Tx } from '../tx';

/** Actual and explicitly named people, never every person in an unrelated fixture or lobby. */
export async function fixtureCommandPeople(
  tx: Tx,
  input: {
    readonly lobbyId: string;
    readonly fixtureId: string;
    readonly namedJudgeIds: readonly string[];
    readonly roundSource: 'current-round' | 'retained-result';
  },
) {
  const competitors = await tx
    .select({ actorId: entryMembers.actorId })
    .from(fixtureEntries)
    .innerJoin(
      entryMembers,
      and(
        eq(entryMembers.entryId, fixtureEntries.entryId),
        eq(entryMembers.lobbyId, fixtureEntries.lobbyId),
      ),
    )
    .where(
      and(
        eq(fixtureEntries.fixtureId, input.fixtureId),
        eq(fixtureEntries.lobbyId, input.lobbyId),
      ),
    );
  const panel = await tx
    .select({ actorId: tournamentJudges.actorId })
    .from(fixtureJudges)
    .innerJoin(
      tournamentJudges,
      and(
        eq(tournamentJudges.id, fixtureJudges.tournamentJudgeId),
        eq(tournamentJudges.lobbyId, fixtureJudges.lobbyId),
      ),
    )
    .where(
      and(
        eq(fixtureJudges.fixtureId, input.fixtureId),
        eq(fixtureJudges.lobbyId, input.lobbyId),
      ),
    );
  const named = input.namedJudgeIds.length
    ? await tx
        .select({ actorId: tournamentJudges.actorId })
        .from(tournamentJudges)
        .where(
          and(
            eq(tournamentJudges.lobbyId, input.lobbyId),
            inArray(tournamentJudges.id, [...input.namedJudgeIds]),
          ),
        )
    : [];
  const current =
    input.roundSource === 'current-round'
      ? await tx
          .select({ actorId: roundParticipants.actorId })
          .from(fixtures)
          .innerJoin(rounds, eq(rounds.roomId, fixtures.roomId))
          .innerJoin(
            roundParticipants,
            and(
              eq(roundParticipants.roundId, rounds.id),
              currentRoundParticipant(roundParticipants.id),
            ),
          )
          .where(
            and(
              eq(fixtures.id, input.fixtureId),
              eq(fixtures.lobbyId, input.lobbyId),
            ),
          )
      : [];
  const ids = [
    ...new Set(
      [...competitors, ...panel, ...named, ...current].map(
        (person) => person.actorId,
      ),
    ),
  ].sort();
  return ids.length
    ? tx
        .select({ actorId: actors.id, userId: actors.userId })
        .from(actors)
        .where(inArray(actors.id, ids))
        .orderBy(actors.id)
    : [];
}
