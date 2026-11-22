import { asc, eq } from 'drizzle-orm';
import { events, tabRounds, timeSlots } from '../schema/events';
import { organizations } from '../schema/organizations';
import { scopeTransaction } from '../tenant-scope';
import { fenceTabAccountRead } from './account-read-fence';
import { loadAuthorityContext } from './authority-context';
import { loadLobbyAuthority } from './lobby-authority';
import { inTransaction, type Tx, type TxOpener } from '../tx';

type Input = {
  readonly viewerUserId: string;
  readonly target: {
    readonly kind: 'organization' | 'lobby';
    readonly id: string;
  };
};
async function load(tx: Tx, input: Input) {
  await scopeTransaction(tx, {
    subjectUserId: input.viewerUserId,
    ...(input.target.kind === 'lobby'
      ? { lobbyId: input.target.id }
      : { organizationId: input.target.id }),
  });
  await fenceTabAccountRead(tx, input.viewerUserId);
  if (input.target.kind === 'organization') {
    const authorization = await loadAuthorityContext(
      tx,
      { subjectUserId: input.viewerUserId, organizationId: input.target.id },
      input.viewerUserId,
      'share',
    );
    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.target.id));
    return organization && authorization.organization
      ? { kind: 'organization' as const, organization, authorization }
      : null;
  }
  const authority = await loadLobbyAuthority(tx, {
    viewerUserId: input.viewerUserId,
    lobbyId: input.target.id,
  });
  if (!authority) return null;
  return {
    kind: 'lobby' as const,
    ...authority,
    events: await tx
      .select({ eventId: events.id, name: events.name })
      .from(events)
      .where(eq(events.lobbyId, authority.lobby.id))
      .orderBy(asc(events.createdAt), asc(events.id)),
    readSchedule: async () => ({
      slots: await tx
        .select({
          timeSlotId: timeSlots.id,
          name: timeSlots.name,
          startsAt: timeSlots.startsAt,
        })
        .from(timeSlots)
        .where(eq(timeSlots.lobbyId, authority.lobby.id))
        .orderBy(asc(timeSlots.startsAt), asc(timeSlots.id)),
      rounds: await tx
        .select({
          tabRoundId: tabRounds.id,
          eventId: tabRounds.eventId,
          timeSlotId: tabRounds.timeSlotId,
          number: tabRounds.number,
          name: tabRounds.name,
        })
        .from(tabRounds)
        .where(eq(tabRounds.lobbyId, authority.lobby.id))
        .orderBy(asc(tabRounds.number), asc(tabRounds.id)),
    }),
  };
}
export type HostNavigationFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostNavigationStore = (database: TxOpener) => ({
  hostNavigation: <Answer>(
    input: Input,
    work: (facts: HostNavigationFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
