import { and, eq, inArray, or } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { lobbies } from '../schema/lobbies';
import { templates } from '../schema/templates';
import { organizations } from '../schema/organizations';
import { settings } from '../schema/settings';
import { rooms } from '../schema/rooms';
import { scopeTransaction } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/** A named existing standing Room reads only its actual chain under account-before-parent fences. */
export async function lockStandingRoomSettingContext(
  tx: Pick<TabTransaction, 'select' | 'execute'>,
  room: Pick<typeof rooms.$inferSelect, 'id' | 'lobbyId' | 'templateId'>,
) {
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, room.lobbyId));
  if (!found || found.kind !== 'standing' || !found.ownerOrganizationId)
    throw createAppError('INVARIANT', 'Standing Room lobby is missing');
  const scope = {
    lobbyId: found.id,
    organizationId: found.ownerOrganizationId,
  };
  await scopeTransaction(tx, scope);
  const [source] = room.templateId
    ? await tx.select().from(templates).where(eq(templates.id, room.templateId))
    : [];
  const ids = [
    ...new Set([
      found.ownerOrganizationId,
      ...(source ? [source.organizationId] : []),
    ]),
  ].sort();
  for (const id of ids) {
    await scopeTransaction(tx, { ...scope, organizationId: id });
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, id))
      .for('share');
  }
  if (source)
    await scopeTransaction(tx, {
      ...scope,
      organizationId: source.organizationId,
    });
  const [template] = source
    ? await tx
        .select()
        .from(templates)
        .where(eq(templates.id, source.id))
        .for('share')
    : [];
  await scopeTransaction(tx, scope);
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, found.id))
    .for('share');
  if (
    !lobby ||
    lobby.ownerOrganizationId !== found.ownerOrganizationId ||
    (room.templateId !== null && !template) ||
    template?.organizationId !== source?.organizationId
  )
    throw createAppError('CONFLICT', 'Standing Room setting parents changed');
  const rows = await tx
    .select()
    .from(settings)
    .where(
      or(
        and(eq(settings.scopeKind, 'lobby'), eq(settings.lobbyId, lobby.id)),
        and(
          eq(settings.scopeKind, 'organization'),
          inArray(settings.organizationId, ids),
        ),
        ...(template ? [eq(settings.templateId, template.id)] : []),
      ),
    );
  return { lobby, template: template ?? null, rows };
}
