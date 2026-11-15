import type { TenantScope } from '../tenant-scope';
import { loadTabAccount } from './boundary';
import { loadGrantRows } from './grant-rows';
import {
  loadOrganizationAuthorization,
  type OrganizationAuthorization,
} from './organization-authorization';
import {
  loadMemberships,
  loadStaffMinimumBand,
  lockOrganization,
} from './organization-facts';
import type { TabTransaction } from './tab-transaction';

/** Current authority at an organization, with its row locked before its grants are read. */
export const loadOrganizationContext = async (
  tx: TabTransaction,
  scope: TenantScope,
  userId: string,
  strength: 'update' | 'share' = 'update',
): Promise<OrganizationAuthorization> => {
  const organization = scope.organizationId
    ? await lockOrganization(tx, scope.organizationId, strength)
    : null;
  return organization
    ? loadOrganizationAuthorization(tx, scope, {
        userId,
        organization,
        memberships: await loadMemberships(tx, organization.id, [userId]),
        grants: await loadGrantRows(tx, {
          organizationId: organization.id,
          userIds: [userId],
        }),
        staffMinimumBand: await loadStaffMinimumBand(tx, organization.id),
      })
    : {
        account: await loadTabAccount(tx, userId, scope),
        organization: null,
        grants: [],
        membership: null,
      };
};
