import { and, asc, eq } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { events } from '../schema/events';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { scopeTransaction } from '../tenant-scope';
import { fenceTabAccountRead } from './account-read-fence';
import { loadAuthorityContext } from './authority-context';
import { EventSettingParentsChanged } from './event-setting-context';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly viewerUserId: string;
  readonly target: {
    readonly kind: 'organization' | 'lobby';
    readonly id: string;
  };
};
async function load(tx: TabTransaction, input: Input) {
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
  const [initial] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.target.id));
  if (!initial) return null;
  const scope = {
    subjectUserId: input.viewerUserId,
    lobbyId: initial.id,
    organizationId: initial.ownerOrganizationId ?? undefined,
  };
  await scopeTransaction(tx, scope);
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.viewerUserId,
    'share',
  );
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, initial.id))
    .for('share');
  if (!lobby) return null;
  if (lobby.ownerOrganizationId !== initial.ownerOrganizationId)
    throw new EventSettingParentsChanged();
  const [owner] = lobby.ownerUserId
    ? await tx
        .select({ actorId: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  return {
    kind: 'lobby' as const,
    lobby,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    events: await tx
      .select({ eventId: events.id, name: events.name })
      .from(events)
      .where(and(eq(events.lobbyId, lobby.id)))
      .orderBy(asc(events.createdAt), asc(events.id)),
  };
}
export type HostNavigationFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostNavigationStore = (database: TabDatabase) => ({
  hostNavigation: <Answer>(
    input: Input,
    work: (facts: HostNavigationFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
