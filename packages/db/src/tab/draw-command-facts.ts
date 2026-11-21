import { namedTournamentPeople } from './tournament-people';
import { loadTournamentHostingFacts } from './tournament-hosting-facts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DrawCommand } from '@daisy/protocol/lobby/draw-command';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { tournamentRatingSnapshots } from '../schema/tournament-rating-snapshots';
import { events, stages, tabRounds, timeSlots } from '../schema/events';
import { entries, entryMembers } from '../schema/entries';
import { draws, drawFixtures, drawResultInputs } from '../schema/draws';
import { fixtures, fixtureEntries, fixtureJudges } from '../schema/fixtures';
import {
  tournamentJudges,
  judgeAvailability,
  judgeEvents,
  judgeStrikes,
} from '../schema/tournament-judges';
import { results, resultEntries, resultSpeakers } from '../schema/results';
import { certifications, certificationResults } from '../schema/certifications';
import { releases } from '../schema/releases';
import { rounds } from '../schema/rounds';
import { ballots } from '../schema/ballots';
import { roundParticipants } from '../schema/round-participants';
import { rooms } from '../schema/rooms';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { fenceTabAccountsRead } from './account-read-fence';
import { lockEventSettingContext } from './event-setting-context';
import { loadAuthorityContext } from './authority-context';
import { loadTabCounterpart } from './boundary';
import { loadDrawResolutionPool } from './draw-resolution-pool';
import type { Tx } from '../tx';

export type DrawCommandInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly command: DrawCommand;
};
/** The potential cast changed while the command acquired its canonical account fences. */
export class DrawPeopleChanged extends Error {}

const namedRound = async (tx: Tx, input: DrawCommandInput) => {
  if (input.command.type === 'generate-draw') {
    const [round] = await tx
      .select()
      .from(tabRounds)
      .where(
        and(
          eq(tabRounds.id, input.command.tabRoundId),
          eq(tabRounds.lobbyId, input.lobbyId),
        ),
      );
    return round ?? null;
  }
  const drawId =
    input.command.type === 'edit-draw'
      ? input.command.basedOnDrawId
      : input.command.drawId;
  const [row] = await tx
    .select({ round: tabRounds })
    .from(draws)
    .innerJoin(tabRounds, eq(tabRounds.id, draws.tabRoundId))
    .where(and(eq(draws.id, drawId), eq(draws.lobbyId, input.lobbyId)));
  return row?.round ?? null;
};

/**
 * An addressed tournament read, inside the command transaction. Accounts
 * precede actual setting parents; the lobby serializes roster/fixture
 * changes and the slot fences cross-event seating. No unrelated lobby or
 * privileged reverse-dependency enumeration is involved.
 */
export const loadDrawContext = async (
  tx: Tx,
  input: {
    readonly senderUserId: string;
    readonly lobbyId: string;
    readonly tabRoundId: string;
    readonly strength: 'share' | 'update';
    readonly withPublicationResolution: boolean;
  },
) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
  const scope: TenantScope = {
    subjectUserId: input.senderUserId,
    lobbyId: found?.id,
    organizationId: found?.ownerOrganizationId ?? undefined,
  };
  await scopeTransaction(tx, scope);
  const [firstRound] = await tx
    .select()
    .from(tabRounds)
    .where(
      and(
        eq(tabRounds.id, input.tabRoundId),
        eq(tabRounds.lobbyId, input.lobbyId),
      ),
    );
  const firstPeople = await namedTournamentPeople(tx, input.lobbyId);
  await (
    input.strength === 'share' ? fenceTabAccountsRead : lockTabCommandAccounts
  )(tx, [
    input.senderUserId,
    ...firstPeople.flatMap((person) => (person.userId ? [person.userId] : [])),
  ]);
  if (!found || found.kind !== 'tournament' || !firstRound) return null;
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: input.lobbyId,
    eventId: firstRound.eventId,
    subjectUserId: input.senderUserId,
    strength: input.strength,
  });
  if (!configuration) return null;
  const currentPeople = await namedTournamentPeople(tx, input.lobbyId);
  if (
    currentPeople.some(
      (person) =>
        !firstPeople.some(
          (first) =>
            first.actorId === person.actorId && first.userId === person.userId,
        ),
    )
  )
    throw new DrawPeopleChanged();
  const authorization = await loadAuthorityContext(
    tx,
    configuration.scope,
    input.senderUserId,
    'share',
  );
  const [round] = await tx
    .select()
    .from(tabRounds)
    .where(
      and(
        eq(tabRounds.id, firstRound.id),
        eq(tabRounds.eventId, configuration.event.id),
        eq(tabRounds.lobbyId, input.lobbyId),
      ),
    )
    .for(input.strength);
  if (!round) return null;
  const [stage] = await tx
    .select()
    .from(stages)
    .where(
      and(
        eq(stages.id, round.stageId),
        eq(stages.eventId, configuration.event.id),
        eq(stages.lobbyId, input.lobbyId),
      ),
    )
    .for('share');
  const [slot] = round.timeSlotId
    ? await tx
        .select()
        .from(timeSlots)
        .where(
          and(
            eq(timeSlots.id, round.timeSlotId),
            eq(timeSlots.lobbyId, input.lobbyId),
          ),
        )
        .for(input.strength)
    : [];
  const versions = await tx
    .select()
    .from(draws)
    .where(
      and(
        eq(draws.eventId, configuration.event.id),
        eq(draws.lobbyId, input.lobbyId),
      ),
    )
    .orderBy(asc(draws.id))
    .for(input.strength);
  const currentFixtures = await tx
    .select()
    .from(fixtures)
    .where(eq(fixtures.lobbyId, input.lobbyId))
    .orderBy(asc(fixtures.id))
    .for(input.strength);
  const roomIds = currentFixtures.flatMap((fixture) =>
    fixture.roomId ? [fixture.roomId] : [],
  );
  const roomRows = roomIds.length
    ? await tx
        .select()
        .from(rooms)
        .where(inArray(rooms.id, roomIds))
        .orderBy(asc(rooms.id))
        .for(input.strength)
    : [];
  const [owner] = configuration.lobby.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, configuration.lobby.ownerUserId))
    : [];
  const accounts = [];
  for (const person of currentPeople)
    accounts.push({
      ...person,
      account: person.userId
        ? await loadTabCounterpart(tx, person.userId, configuration.scope)
        : null,
    });
  const eventId = configuration.event.id;
  const [tournament] = await tx
    .select({ ratingSnapshot: tournamentRatingSnapshots.snapshot })
    .from(tournamentRatingSnapshots)
    .where(eq(tournamentRatingSnapshots.lobbyId, input.lobbyId));
  const ratingConfigurations = [];
  if (!tournament?.ratingSnapshot && input.strength === 'update') {
    const eventRows = await tx
      .select()
      .from(events)
      .where(eq(events.lobbyId, input.lobbyId))
      .orderBy(asc(events.id));
    for (const row of eventRows) {
      const context =
        row.id === eventId
          ? configuration
          : await lockEventSettingContext(tx, {
              lobbyId: input.lobbyId,
              eventId: row.id,
              subjectUserId: input.senderUserId,
              strength: input.strength,
            });
      if (context) ratingConfigurations.push(context);
    }
  }
  return {
    ratingSnapshot: tournament?.ratingSnapshot ?? null,
    ratingConfigurations,
    configuration,
    authorization,
    ownerActorId: owner?.id ?? null,
    round,
    publicationResolution: input.withPublicationResolution
      ? await loadDrawResolutionPool(tx, configuration, round)
      : null,
    hosting: await loadTournamentHostingFacts(tx, input.lobbyId, 'read'),
    stage: stage ?? null,
    slot: slot ?? null,
    accounts,
    versions,
    fixtures: currentFixtures,
    rooms: roomRows,
    events: await tx
      .select()
      .from(events)
      .where(eq(events.lobbyId, input.lobbyId)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, input.lobbyId)),
    stages: await tx
      .select()
      .from(stages)
      .where(eq(stages.lobbyId, input.lobbyId)),
    entries: await tx
      .select()
      .from(entries)
      .where(eq(entries.lobbyId, input.lobbyId)),
    members: await tx
      .select()
      .from(entryMembers)
      .where(eq(entryMembers.lobbyId, input.lobbyId)),
    drawFixtures: await tx
      .select()
      .from(drawFixtures)
      .where(eq(drawFixtures.eventId, eventId)),
    drawResultInputs: await tx
      .select()
      .from(drawResultInputs)
      .where(eq(drawResultInputs.eventId, eventId)),
    fixtureEntries: await tx
      .select()
      .from(fixtureEntries)
      .where(eq(fixtureEntries.lobbyId, input.lobbyId)),
    fixtureJudges: await tx
      .select()
      .from(fixtureJudges)
      .where(eq(fixtureJudges.lobbyId, input.lobbyId)),
    judges: await tx
      .select()
      .from(tournamentJudges)
      .where(eq(tournamentJudges.lobbyId, input.lobbyId)),
    availability: await tx
      .select()
      .from(judgeAvailability)
      .where(eq(judgeAvailability.lobbyId, input.lobbyId)),
    judgeEvents: await tx
      .select()
      .from(judgeEvents)
      .where(eq(judgeEvents.lobbyId, input.lobbyId)),
    strikes: await tx
      .select()
      .from(judgeStrikes)
      .where(eq(judgeStrikes.lobbyId, input.lobbyId)),
    results: await tx
      .select()
      .from(results)
      .where(eq(results.eventId, eventId)),
    certifications: await tx
      .select()
      .from(certifications)
      .where(eq(certifications.eventId, eventId)),
    fixtureResults: await tx
      .select({ fixtureId: results.fixtureId })
      .from(results)
      .where(eq(results.lobbyId, input.lobbyId)),
    resultEntries: await tx
      .select({ row: resultEntries })
      .from(resultEntries)
      .innerJoin(results, eq(results.id, resultEntries.resultId))
      .where(eq(results.eventId, eventId)),
    resultSpeakers: await tx
      .select({ row: resultSpeakers })
      .from(resultSpeakers)
      .innerJoin(results, eq(results.id, resultSpeakers.resultId))
      .where(eq(results.eventId, eventId)),
    certified: await tx
      .select()
      .from(certificationResults)
      .where(eq(certificationResults.eventId, eventId)),
    releases: await tx
      .select()
      .from(releases)
      .where(eq(releases.eventId, eventId)),
    roomRounds: roomIds.length
      ? await tx
          .select({
            id: rounds.id,
            roomId: rounds.roomId,
            status: rounds.status,
            startedAt: rounds.startedAt,
            currentStage: rounds.currentStage,
            rulesSnapshot: rounds.rulesSnapshot,
          })
          .from(rounds)
          .where(inArray(rounds.roomId, roomIds))
          .orderBy(asc(rounds.id))
          .for(input.strength)
      : [],
    submittedBallots: roomIds.length
      ? await tx
          .select({
            roundId: ballots.roundId,
            actorId: roundParticipants.actorId,
          })
          .from(ballots)
          .innerJoin(rounds, eq(rounds.id, ballots.roundId))
          .innerJoin(
            roundParticipants,
            eq(roundParticipants.id, ballots.judgeParticipantId),
          )
          .where(inArray(rounds.roomId, roomIds))
      : [],
  };
};
export const loadDrawCommandFacts = async (tx: Tx, input: DrawCommandInput) => {
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  const round = await namedRound(tx, input);
  return round
    ? loadDrawContext(tx, {
        ...input,
        tabRoundId: round.id,
        strength: 'update',
        withPublicationResolution: input.command.type === 'publish-draw',
      })
    : null;
};
export type LoadedDrawCommand = NonNullable<
  Awaited<ReturnType<typeof loadDrawCommandFacts>>
>;
