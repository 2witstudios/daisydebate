import { and, eq } from 'drizzle-orm';
import { loadTabCounterpart } from './account';
import { fixtures } from '../schema/fixtures';
import { tabRounds, stages, timeSlots } from '../schema/events';
import { rooms } from '../schema/rooms';
import { rounds } from '../schema/rounds';
import { actors } from '../schema/actors';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { lockTabCommandAccounts } from './command-accounts';
import { lockEventSettingContext } from './event-setting-context';
import { loadAuthorityContext } from './authority-context';
import {
  loadTournamentEligibility,
  tournamentDebatersAllowed,
} from './tournament-eligibility';
import { fixtureCommandPeople } from './fixture-command-people';
import type { Tx } from '../tx';

/** The actual or named cast changed while canonical account fences were acquired. */
export class FixturePeopleChanged extends Error {}
export type FixtureContextInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly fixtureId: string;
  readonly namedJudgeIds: readonly string[];
  readonly checkDebaterEligibility?: boolean;
  readonly roundSource: 'current-round' | 'retained-result';
};

/** Shared ownership order for officiating and result commands: accounts, parents, slot, fixture, Room, Round. */
export async function lockFixtureCommandContext(
  tx: Tx,
  input: FixtureContextInput,
) {
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  const [address] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, input.fixtureId),
        eq(fixtures.lobbyId, input.lobbyId),
      ),
    );
  const firstPeople = await fixtureCommandPeople(tx, input);
  await lockTabCommandAccounts(tx, [
    input.senderUserId,
    ...firstPeople.flatMap((person) => (person.userId ? [person.userId] : [])),
  ]);
  if (!address) return null;
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: address.lobbyId,
    eventId: address.eventId,
    subjectUserId: input.senderUserId,
  });
  if (!configuration || configuration.lobby.kind !== 'tournament') return null;
  const eligibility = input.checkDebaterEligibility
    ? await loadTournamentEligibility(
        tx,
        configuration.scope,
        configuration.lobby,
      )
    : null;
  const [tabRound] = await tx
    .select()
    .from(tabRounds)
    .where(
      and(
        eq(tabRounds.id, address.tabRoundId),
        eq(tabRounds.eventId, configuration.event.id),
        eq(tabRounds.lobbyId, input.lobbyId),
      ),
    )
    .for('share');
  if (!tabRound) return null;
  const [stage] = await tx
    .select()
    .from(stages)
    .where(
      and(
        eq(stages.id, tabRound.stageId),
        eq(stages.eventId, tabRound.eventId),
        eq(stages.lobbyId, input.lobbyId),
      ),
    )
    .for('share');
  const [slot] = tabRound.timeSlotId
    ? await tx
        .select()
        .from(timeSlots)
        .where(
          and(
            eq(timeSlots.id, tabRound.timeSlotId),
            eq(timeSlots.lobbyId, input.lobbyId),
          ),
        )
        .for('update')
    : [];
  const [fixture] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, address.id),
        eq(fixtures.eventId, configuration.event.id),
        eq(fixtures.lobbyId, input.lobbyId),
      ),
    )
    .for('update');
  if (
    !fixture ||
    fixture.tabRoundId !== tabRound.id ||
    !stage ||
    (tabRound.timeSlotId !== null && !slot) ||
    (stage.timing === 'live' && !slot) ||
    (stage.timing === 'windowed' && slot !== undefined)
  )
    return null;
  const [room] = fixture.roomId
    ? await tx
        .select()
        .from(rooms)
        .where(
          and(eq(rooms.id, fixture.roomId), eq(rooms.lobbyId, input.lobbyId)),
        )
        .for('no key update')
    : [];
  if (fixture.roomId !== null && !room) return null;
  const [round] =
    room && input.roundSource === 'current-round'
      ? await tx
          .select()
          .from(rounds)
          .where(eq(rounds.roomId, room.id))
          .for('no key update')
      : [];
  const currentPeople = await fixtureCommandPeople(tx, input);
  if (
    currentPeople.some(
      (person) =>
        !firstPeople.some(
          (first) =>
            first.actorId === person.actorId && first.userId === person.userId,
        ),
    )
  )
    throw new FixturePeopleChanged();
  const authorization = await loadAuthorityContext(
    tx,
    configuration.scope,
    input.senderUserId,
    'share',
  );
  const [owner] = configuration.lobby.ownerUserId
    ? await tx
        .select({ actorId: actors.id })
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
  return {
    accounts,
    debatersAllowed: (actorIds: readonly string[], now: string) =>
      eligibility === null
        ? Promise.resolve(true)
        : tournamentDebatersAllowed(
            tx,
            configuration.scope,
            eligibility,
            actorIds,
            now,
          ),
    roundSource: input.roundSource,
    configuration,
    fixture,
    tabRound,
    stage,
    slot: slot ?? null,
    room: room ?? null,
    round: round ?? null,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    fencedActorIds: [
      ...new Set([
        ...currentPeople.map((person) => person.actorId),
        ...(authorization.account?.actorId
          ? [authorization.account.actorId]
          : []),
      ]),
    ],
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type FixtureCommandContext = NonNullable<
  Awaited<ReturnType<typeof lockFixtureCommandContext>>
>;
