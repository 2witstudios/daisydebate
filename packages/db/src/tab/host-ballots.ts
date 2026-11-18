import { and, asc, eq } from 'drizzle-orm';
import { loadTournamentEventSettingFacts } from './tournament-event-settings';
import { readDatabaseTime } from '../database-clock';
import { rounds } from '../schema/rounds';
import { rooms } from '../schema/rooms';
import { fixtures } from '../schema/fixtures';
import { fixtureRoomSources } from '../schema/fixture-room-sources';
import { tabRounds, stages } from '../schema/events';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId: string;
};
async function load(tx: TabTransaction, input: Input) {
  const context = await loadTournamentEventSettingFacts(tx, input);
  if (!context) return null;
  const addressed = await tx
    .select({
      roundId: rounds.id,
      fixtureId: fixtures.id,
      tabRoundName: tabRounds.name,
      roomTitle: rooms.title,
    })
    .from(fixtureRoomSources)
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.id, fixtureRoomSources.fixtureId),
        eq(fixtures.lobbyId, fixtureRoomSources.lobbyId),
      ),
    )
    .innerJoin(rooms, eq(rooms.id, fixtureRoomSources.roomId))
    .innerJoin(rounds, eq(rounds.roomId, rooms.id))
    .innerJoin(tabRounds, eq(tabRounds.id, fixtures.tabRoundId))
    .innerJoin(stages, eq(stages.id, tabRounds.stageId))
    .where(
      and(
        eq(fixtures.lobbyId, input.lobbyId),
        eq(fixtures.eventId, input.eventId),
      ),
    )
    .orderBy(
      asc(stages.sequence),
      asc(tabRounds.number),
      asc(rounds.createdAt),
      asc(rounds.id),
    );
  return {
    ...context,
    rounds: addressed,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type HostBallotsFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostBallotsStore = (database: TabDatabase) => ({
  hostBallots: <Answer>(
    input: Input,
    work: (facts: HostBallotsFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
