import { asc, eq, inArray } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { organizations } from '../schema/organizations';
import { entries, entryMembers } from '../schema/entries';
import { events, tabRounds, timeSlots } from '../schema/events';
import {
  tournamentJudges,
  judgeAvailability,
  judgeEvents,
  judgeStrikes,
} from '../schema/tournament-judges';
import { fixtures, fixtureJudges } from '../schema/fixtures';
import { rounds } from '../schema/rounds';
import { roundParticipants } from '../schema/round-participants';
import { ballots } from '../schema/ballots';
import { scopeTransaction } from '../tenant-scope';
import { namedTournamentPeople } from './tournament-people';
import { fenceTabAccountsRead } from './account-read-fence';
import { lockEventSettingContext } from './event-setting-context';
import { loadLobbyAuthority } from './lobby-authority';
import { loadTabCounterpart } from './boundary';
import type { TabDatabase } from './tab-transaction';
import { inTransaction, type Tx } from '../tx';

type Input = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId?: string | undefined;
};
async function load(tx: Tx, input: Input) {
  await scopeTransaction(tx, {
    subjectUserId: input.viewerUserId,
    lobbyId: input.lobbyId,
  });
  const first = await namedTournamentPeople(tx, input.lobbyId);
  await fenceTabAccountsRead(tx, [
    input.viewerUserId,
    ...first.flatMap((p) => (p.userId ? [p.userId] : [])),
  ]);
  const authority = await loadLobbyAuthority(tx, input);
  if (!authority || authority.lobby.kind !== 'tournament') return null;
  const people = await namedTournamentPeople(tx, input.lobbyId);
  if (
    people.some(
      (p) =>
        !first.some((f) => f.actorId === p.actorId && f.userId === p.userId),
    )
  )
    return null;
  const scope = {
    subjectUserId: input.viewerUserId,
    lobbyId: input.lobbyId,
    organizationId: authority.lobby.ownerOrganizationId ?? undefined,
  };
  const accounts = [];
  for (const person of people)
    accounts.push({
      ...person,
      account: person.userId
        ? await loadTabCounterpart(tx, person.userId, scope)
        : null,
    });
  await scopeTransaction(tx, scope);
  const entryRows = await tx
    .select()
    .from(entries)
    .where(eq(entries.lobbyId, input.lobbyId));
  const judgeRows = await tx
    .select()
    .from(tournamentJudges)
    .where(eq(tournamentJudges.lobbyId, input.lobbyId));
  const schoolIds = [
    ...new Set(
      [...entryRows, ...judgeRows].flatMap((row) =>
        row.schoolOrganizationId ? [row.schoolOrganizationId] : [],
      ),
    ),
  ];
  const makerIds = [
    ...new Set(
      entryRows.flatMap((row) =>
        row.submittedByUserId ? [row.submittedByUserId] : [],
      ),
    ),
  ];
  const fixtureRows = await tx
    .select()
    .from(fixtures)
    .where(eq(fixtures.lobbyId, input.lobbyId));
  const roomIds = fixtureRows.flatMap((row) =>
    row.roomId ? [row.roomId] : [],
  );
  const roomRounds = roomIds.length
    ? await tx
        .select()
        .from(rounds)
        .where(inArray(rounds.roomId, roomIds))
        .for('share')
    : [];
  const roundIds = roomRounds.map((row) => row.id);
  const eventRows = await tx
    .select()
    .from(events)
    .where(eq(events.lobbyId, input.lobbyId))
    .orderBy(asc(events.id));
  const eventId = input.eventId ?? eventRows[0]?.id;
  const configuration = eventId
    ? await lockEventSettingContext(tx, {
        lobbyId: input.lobbyId,
        eventId,
        subjectUserId: input.viewerUserId,
        strength: 'share',
      })
    : null;
  return {
    ...authority,
    configuration,
    accounts,
    entries: entryRows,
    judges: judgeRows,
    fixtures: fixtureRows,
    roomRounds,
    members: await tx
      .select()
      .from(entryMembers)
      .where(eq(entryMembers.lobbyId, input.lobbyId)),
    events: await tx
      .select()
      .from(events)
      .where(eq(events.lobbyId, input.lobbyId)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, input.lobbyId)),
    slots: await tx
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, input.lobbyId)),
    availability: await tx
      .select()
      .from(judgeAvailability)
      .where(eq(judgeAvailability.lobbyId, input.lobbyId)),
    clearances: await tx
      .select()
      .from(judgeEvents)
      .where(eq(judgeEvents.lobbyId, input.lobbyId)),
    strikes: await tx
      .select()
      .from(judgeStrikes)
      .where(eq(judgeStrikes.lobbyId, input.lobbyId)),
    assignments: await tx
      .select()
      .from(fixtureJudges)
      .where(eq(fixtureJudges.lobbyId, input.lobbyId)),
    people: people.length
      ? await tx
          .select({ actorId: actors.id, name: users.username })
          .from(actors)
          .innerJoin(users, eq(users.id, actors.userId))
          .where(
            inArray(
              actors.id,
              people.map((p) => p.actorId),
            ),
          )
      : [],
    makers: makerIds.length
      ? await tx
          .select({ userId: users.id, name: users.username })
          .from(users)
          .where(inArray(users.id, makerIds))
      : [],
    schools: schoolIds.length
      ? await tx
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, schoolIds))
      : [],
    submitted: roundIds.length
      ? await tx
          .select({
            actorId: roundParticipants.actorId,
            roundId: ballots.roundId,
          })
          .from(ballots)
          .innerJoin(
            roundParticipants,
            eq(roundParticipants.id, ballots.judgeParticipantId),
          )
          .where(inArray(ballots.roundId, roundIds))
      : [],
  };
}
export type HostRosterFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostRosterStore = (database: TabDatabase) => ({
  hostRoster: <Answer>(
    input: Input,
    work: (facts: HostRosterFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
