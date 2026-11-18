import { and, eq, inArray } from 'drizzle-orm';
import { readDatabaseTime } from '../database-clock';
import { releases } from '../schema/releases';
import { ballots } from '../schema/ballots';
import { ballotScreenings } from '../schema/ballot-screenings';
import { rounds } from '../schema/rounds';
import { fixtures } from '../schema/fixtures';
import {
  loadEventCompetition,
  type EventCompetitionInput,
} from './event-competition';
import type { TabTransaction } from './tab-transaction';

/** The same locked event sources serve the read and its completion command. */
export async function loadEventCompletion(
  tx: TabTransaction,
  input: EventCompetitionInput,
) {
  const eventId = input.eventId;
  const competition = await loadEventCompetition(tx, {
    viewerUserId: input.viewerUserId,
    lobbyId: input.lobbyId,
    eventId,
    strength: input.strength ?? 'share',
  });
  if (!competition) return null;
  const currentRounds = await tx
    .select({
      roundId: rounds.id,
      tabRoundId: fixtures.tabRoundId,
      roomId: rounds.roomId,
      status: rounds.status,
    })
    .from(fixtures)
    .innerJoin(rounds, eq(rounds.roomId, fixtures.roomId))
    .where(
      and(eq(fixtures.eventId, eventId), eq(fixtures.lobbyId, input.lobbyId)),
    );
  const sourceRounds = [
    ...new Set([
      ...currentRounds.map((row) => row.roundId),
      ...competition.results.flatMap((row) =>
        row.roundId ? [row.roundId] : [],
      ),
    ]),
  ];
  const submitted = sourceRounds.length
    ? await tx
        .select({ ballot: ballots, screening: ballotScreenings })
        .from(ballots)
        .leftJoin(ballotScreenings, eq(ballotScreenings.ballotId, ballots.id))
        .where(inArray(ballots.roundId, sourceRounds))
    : [];
  return {
    competition,
    currentRounds,
    submitted,
    releases: await tx
      .select()
      .from(releases)
      .where(
        and(eq(releases.eventId, eventId), eq(releases.lobbyId, input.lobbyId)),
      ),
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type EventCompletionFacts = NonNullable<
  Awaited<ReturnType<typeof loadEventCompletion>>
>;
