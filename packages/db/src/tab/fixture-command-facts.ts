import { roomFacts } from '../room-command-facts';
import { roundJudgeSlots } from '../schema/round-judge-assignments';
import { and, eq, inArray } from 'drizzle-orm';
import type { FixtureCommand } from '@daisy/protocol/lobby/fixture-command';
import { fixtureJudges, fixtures, fixtureEntries } from '../schema/fixtures';
import {
  tournamentJudges,
  judgeAvailability,
  judgeEvents,
  judgeStrikes,
} from '../schema/tournament-judges';
import { tabRounds } from '../schema/events';
import { entryMembers } from '../schema/entries';
import { ballots } from '../schema/ballots';
import { roundParticipants } from '../schema/round-participants';
import { lockFixtureCommandContext } from './fixture-command-context';
import { readFixtureCompetitionFacts } from './fixture-competition-facts';
import { readDatabaseTime } from '../database-clock';
import type { TabTransaction } from './tab-transaction';

export type FixtureCommandInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly commandId: string;
  readonly command: FixtureCommand;
};
export const fixtureCommandJudgeIds = (
  command: FixtureCommand,
): readonly string[] => {
  switch (command.type) {
    case 'assign-judge':
    case 'unassign-judge':
      return [command.judgeId];
    case 'replace-judge':
      return [command.outJudgeId, command.inJudgeId];
    case 'restart-fixture':
    case 'record-forfeit':
      return [];
  }
};
/** One addressed fixture, its actual slot and current ordinary owner source under the shared command fences. */
export async function loadFixtureCommandFacts(
  tx: TabTransaction,
  input: FixtureCommandInput,
) {
  const context = await lockFixtureCommandContext(tx, {
    senderUserId: input.senderUserId,
    lobbyId: input.lobbyId,
    fixtureId: input.command.fixtureId,
    namedJudgeIds: fixtureCommandJudgeIds(input.command),
    roundSource: 'current-round',
  });
  if (!context) return null;
  const competition = await readFixtureCompetitionFacts(
    tx,
    context,
    input.senderUserId,
  );
  const panel = await tx
    .select()
    .from(fixtureJudges)
    .where(
      and(
        eq(fixtureJudges.fixtureId, context.fixture.id),
        eq(fixtureJudges.lobbyId, input.lobbyId),
      ),
    )
    .orderBy(fixtureJudges.tournamentJudgeId);
  const judgeIds = [
    ...new Set([
      ...panel.map((row) => row.tournamentJudgeId),
      ...fixtureCommandJudgeIds(input.command),
    ]),
  ];
  const judges = judgeIds.length
    ? await tx
        .select()
        .from(tournamentJudges)
        .where(
          and(
            eq(tournamentJudges.lobbyId, input.lobbyId),
            inArray(tournamentJudges.id, judgeIds),
          ),
        )
    : [];
  const availability =
    judgeIds.length && context.slot
      ? await tx
          .select()
          .from(judgeAvailability)
          .where(
            and(
              eq(judgeAvailability.lobbyId, input.lobbyId),
              eq(judgeAvailability.timeSlotId, context.slot.id),
              inArray(judgeAvailability.tournamentJudgeId, judgeIds),
            ),
          )
      : [];
  const allowedEvents = judgeIds.length
    ? await tx
        .select()
        .from(judgeEvents)
        .where(
          and(
            eq(judgeEvents.lobbyId, input.lobbyId),
            inArray(judgeEvents.tournamentJudgeId, judgeIds),
          ),
        )
    : [];
  const strikes = judgeIds.length
    ? await tx
        .select()
        .from(judgeStrikes)
        .where(
          and(
            eq(judgeStrikes.lobbyId, input.lobbyId),
            inArray(judgeStrikes.tournamentJudgeId, judgeIds),
          ),
        )
    : [];
  const slotJudges = context.slot
    ? await tx
        .select({ fixtureId: fixtures.id, actorId: tournamentJudges.actorId })
        .from(fixtureJudges)
        .innerJoin(
          fixtures,
          and(
            eq(fixtures.id, fixtureJudges.fixtureId),
            eq(fixtures.lobbyId, fixtureJudges.lobbyId),
          ),
        )
        .innerJoin(
          tabRounds,
          and(
            eq(tabRounds.id, fixtures.tabRoundId),
            eq(tabRounds.lobbyId, fixtures.lobbyId),
          ),
        )
        .innerJoin(
          tournamentJudges,
          and(
            eq(tournamentJudges.id, fixtureJudges.tournamentJudgeId),
            eq(tournamentJudges.lobbyId, fixtureJudges.lobbyId),
          ),
        )
        .where(
          and(
            eq(fixtures.lobbyId, input.lobbyId),
            eq(fixtures.status, 'published'),
            eq(tabRounds.timeSlotId, context.slot.id),
          ),
        )
    : [];
  const slotCompetitors = context.slot
    ? await tx
        .select({ fixtureId: fixtures.id, actorId: entryMembers.actorId })
        .from(fixtureEntries)
        .innerJoin(
          fixtures,
          and(
            eq(fixtures.id, fixtureEntries.fixtureId),
            eq(fixtures.lobbyId, fixtureEntries.lobbyId),
          ),
        )
        .innerJoin(
          tabRounds,
          and(
            eq(tabRounds.id, fixtures.tabRoundId),
            eq(tabRounds.lobbyId, fixtures.lobbyId),
          ),
        )
        .innerJoin(
          entryMembers,
          and(
            eq(entryMembers.entryId, fixtureEntries.entryId),
            eq(entryMembers.lobbyId, fixtureEntries.lobbyId),
          ),
        )
        .where(
          and(
            eq(fixtures.lobbyId, input.lobbyId),
            eq(fixtures.status, 'published'),
            eq(tabRounds.timeSlotId, context.slot.id),
          ),
        )
    : [];
  const submitted = context.round
    ? await tx
        .select({ id: ballots.id, judgeActorId: roundParticipants.actorId })
        .from(ballots)
        .innerJoin(
          roundParticipants,
          and(
            eq(roundParticipants.id, ballots.judgeParticipantId),
            eq(roundParticipants.roundId, ballots.roundId),
          ),
        )
        .where(eq(ballots.roundId, context.round.id))
    : [];
  return {
    context,
    roomState: context.room ? (await roomFacts(tx, context.room)).state : null,
    slots: context.round
      ? await tx
          .select()
          .from(roundJudgeSlots)
          .where(eq(roundJudgeSlots.roundId, context.round.id))
          .orderBy(roundJudgeSlots.slot)
      : [],
    competition,
    panel,
    judges,
    availability,
    allowedEvents,
    strikes,
    slotBookings: [...slotJudges, ...slotCompetitors],
    ballots: submitted,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type LoadedFixtureCommand = NonNullable<
  Awaited<ReturnType<typeof loadFixtureCommandFacts>>
>;
