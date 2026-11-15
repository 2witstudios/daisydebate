import type { TenantScope } from '../tenant-scope';
import { eq } from 'drizzle-orm';
import { lobbies } from '../schema/lobbies';
import { staffMinimumBandOf } from './staff-minimum-band';
import { loadGrantRows } from './grant-rows';
import { loadTabAuthorization, type TabAuthorization } from './authority-facts';
import {
  loadMemberships,
  loadStaffMinimumBand,
  lockOrganization,
} from './organization-facts';
import type { TabTransaction } from './tab-transaction';

/** Current authority at the addressed organization and/or exact lobby, under its metadata fences. */
export const loadAuthorityContext = async (
  tx: TabTransaction,
  scope: TenantScope,
  userId: string,
  strength: 'update' | 'share' | null = 'update',
): Promise<TabAuthorization> => {
  const organization = scope.organizationId
    ? await lockOrganization(tx, scope.organizationId, strength)
    : null;
  const lobbyQuery = scope.lobbyId
    ? tx
        .select({
          id: lobbies.id,
          ownerOrganizationId: lobbies.ownerOrganizationId,
        })
        .from(lobbies)
        .where(eq(lobbies.id, scope.lobbyId))
    : null;
  const [lobby] = lobbyQuery
    ? await (strength === null ? lobbyQuery : lobbyQuery.for(strength))
    : [];
  const addressedLobby =
    lobby && lobby.ownerOrganizationId === (organization?.id ?? null)
      ? lobby.id
      : undefined;
  const grants = organization
    ? await loadGrantRows(tx, {
        organizationId: organization.id,
        ...(addressedLobby ? { lobbyId: addressedLobby } : {}),
        userIds: [userId],
      })
    : addressedLobby
      ? await loadGrantRows(tx, { lobbyId: addressedLobby, userIds: [userId] })
      : [];
  return loadTabAuthorization(tx, scope, {
    userId,
    organization,
    memberships: organization
      ? await loadMemberships(tx, organization.id, [userId])
      : [],
    grants,
    staffMinimumBand: organization
      ? await loadStaffMinimumBand(tx, organization.id)
      : staffMinimumBandOf(null),
  });
};
