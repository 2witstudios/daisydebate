import { and, eq, inArray } from 'drizzle-orm';
import { loadEventCompletion } from './event-completion';
import type { EventCompetitionInput } from './event-competition';
import { results } from '../schema/results';
import { actionHistory } from '../schema/grants';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { sanctions } from '../schema/sanctions';
import { organizations } from '../schema/organizations';
import { drawResultInputs } from '../schema/draws';
import { rooms } from '../schema/rooms';
import { timeSlots } from '../schema/events';
import { inTransaction, type Tx, type TxOpener } from '../tx';

async function load(tx: Tx, input: EventCompetitionInput) {
  const completion = await loadEventCompletion(tx, input);
  if (!completion) return null;
  const history = await tx
    .select({
      commandId: actionHistory.commandId,
      actorUserId: actionHistory.actorUserId,
      confirmedByUserId: actionHistory.confirmedByUserId,
    })
    .from(results)
    .innerJoin(actionHistory, eq(actionHistory.commandId, results.commandId))
    .where(
      and(
        eq(results.eventId, input.eventId),
        eq(results.lobbyId, input.lobbyId),
      ),
    );
  const userIds = [
    ...new Set(
      history.flatMap((row) =>
        [row.actorUserId, row.confirmedByUserId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  const roomIds = completion.competition.fixtures.flatMap((row) =>
    row.roomId ? [row.roomId] : [],
  );
  return {
    ...completion,
    history,
    people: userIds.length
      ? await tx
          .select({
            userId: users.id,
            actorId: actors.id,
            username: users.username,
          })
          .from(actors)
          .innerJoin(users, eq(users.id, actors.userId))
          .where(inArray(users.id, userIds))
      : [],
    sanctions: await tx
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
      })
      .from(sanctions)
      .innerJoin(organizations, eq(organizations.id, sanctions.organizationId))
      .where(
        and(
          eq(sanctions.eventId, input.eventId),
          eq(sanctions.lobbyId, input.lobbyId),
          eq(sanctions.status, 'approved'),
        ),
      ),
    drawInputs: await tx
      .select()
      .from(drawResultInputs)
      .where(
        and(
          eq(drawResultInputs.eventId, input.eventId),
          eq(drawResultInputs.lobbyId, input.lobbyId),
        ),
      ),
    rooms: roomIds.length
      ? await tx
          .select({ id: rooms.id, title: rooms.title })
          .from(rooms)
          .where(inArray(rooms.id, roomIds))
      : [],
    slots: await tx
      .select({ id: timeSlots.id, startsAt: timeSlots.startsAt })
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, input.lobbyId)),
  };
}
export type HostResultsFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostResultsStore = (database: TxOpener) => ({
  hostResults: <Answer>(
    input: EventCompetitionInput,
    work: (facts: HostResultsFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
