import { eq } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { fenceTabAccountRead } from './account-read-fence';
import { loadAuthorityContext } from './authority-context';
import { EventSettingParentsChanged } from './event-setting-context';
import type { Tx } from '../tx';

/** Current subject and actual lobby ownership, retained under account/parent fences. */
export async function loadLobbyAuthority(
  tx: Tx,
  input: { readonly viewerUserId: string; readonly lobbyId: string },
) {
  await scopeTransaction(tx, {
    subjectUserId: input.viewerUserId,
    lobbyId: input.lobbyId,
  });
  await fenceTabAccountRead(tx, input.viewerUserId);
  const [initial] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
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
    lobby,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
