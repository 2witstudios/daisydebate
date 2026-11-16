import { eq, inArray } from 'drizzle-orm';
import { readDatabaseTime } from '../database-clock';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { organizations } from '../schema/organizations';
import { roundParticipants } from '../schema/round-participants';
import { roundSegments } from '../schema/round-segments';
import { loadDrawContext } from './draw-command-facts';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type HostRoundInput = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly tabRoundId: string;
};
async function load(tx: TabTransaction, input: HostRoundInput) {
  const draw = await loadDrawContext(tx, {
    senderUserId: input.viewerUserId,
    lobbyId: input.lobbyId,
    tabRoundId: input.tabRoundId,
    strength: 'share',
    withPublicationResolution: false,
  });
  if (!draw || draw.configuration.event.id !== input.eventId) return null;
  const people = [
    ...new Set([
      ...draw.members.map((row) => row.actorId),
      ...draw.judges.map((row) => row.actorId),
    ]),
  ];
  const schools = [
    ...new Set(
      draw.entries.flatMap((row) =>
        row.schoolOrganizationId ? [row.schoolOrganizationId] : [],
      ),
    ),
  ];
  const roundIds = draw.roomRounds.map((row) => row.id);
  return {
    draw,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
    people: people.length
      ? await tx
          .select({ actorId: actors.id, name: users.username })
          .from(actors)
          .innerJoin(users, eq(users.id, actors.userId))
          .where(inArray(actors.id, people))
      : [],
    schools: schools.length
      ? await tx
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, schools))
      : [],
    participants: roundIds.length
      ? await tx
          .select({
            roundId: roundParticipants.roundId,
            seatKind: roundParticipants.seatKind,
          })
          .from(roundParticipants)
          .where(inArray(roundParticipants.roundId, roundIds))
      : [],
    segments: roundIds.length
      ? await tx
          .select()
          .from(roundSegments)
          .where(inArray(roundSegments.roundId, roundIds))
      : [],
  };
}
export type HostRoundFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostRoundStore = (database: TabDatabase) => ({
  hostRound: <Answer>(
    input: HostRoundInput,
    work: (facts: HostRoundFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
