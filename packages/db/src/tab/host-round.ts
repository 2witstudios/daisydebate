import { events, tabRounds } from '../schema/events';
import { draws } from '../schema/draws';
import { loadLobbyAuthority } from './lobby-authority';
import { eq, inArray } from 'drizzle-orm';
import { readDatabaseTime } from '../database-clock';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { organizations } from '../schema/organizations';
import { roundJudgeSlots } from '../schema/round-judge-assignments';
import { roundSegments } from '../schema/round-segments';
import { loadDrawContext } from './draw-command-facts';
import { inTransaction, type Tx, type TxOpener } from '../tx';

type HostRoundInput = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly tabRoundId: string;
};
async function load(tx: Tx, input: HostRoundInput) {
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
    judgeSlots: roundIds.length
      ? await tx
          .select({
            roundId: roundJudgeSlots.roundId,
            slot: roundJudgeSlots.slot,
          })
          .from(roundJudgeSlots)
          .where(inArray(roundJudgeSlots.roundId, roundIds))
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
async function loadOverview(
  tx: Tx,
  input: { readonly viewerUserId: string; readonly lobbyId: string },
) {
  const authority = await loadLobbyAuthority(tx, input);
  if (!authority || authority.lobby.kind !== 'tournament') return null;
  return {
    ...authority,
    events: await tx
      .select()
      .from(events)
      .where(eq(events.lobbyId, input.lobbyId)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, input.lobbyId)),
    draws: await tx
      .select()
      .from(draws)
      .where(eq(draws.lobbyId, input.lobbyId)),
  };
}
export type HostDrawOverviewFacts = NonNullable<
  Awaited<ReturnType<typeof loadOverview>>
>;
export const createHostRoundStore = (database: TxOpener) => ({
  hostDrawOverview: <Answer>(
    input: { readonly viewerUserId: string; readonly lobbyId: string },
    work: (facts: HostDrawOverviewFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await loadOverview(tx, input))),
  hostRound: <Answer>(
    input: HostRoundInput,
    work: (facts: HostRoundFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
