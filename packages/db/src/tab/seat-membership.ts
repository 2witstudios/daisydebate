import { sql } from 'drizzle-orm';
import {
  applyOrganizationWrites,
  type OrganizationWrite,
} from './organization-writes';
import type { TabTransaction } from './tab-transaction';

/**
 * Tab's published transition for a Club seat holder (ADR 0148): accepting a
 * seat makes the person an active member of the club. It is written through
 * Tab's own organisation write vocabulary and applier, as Tab's `respond`
 * would: a (re)activation joins now, so the membership-period trigger opens
 * a fresh period, and the organisation's version advances. An active member
 * is left as they are. The caller holds the club row lock and its scope.
 */
export async function activateSeatMembership(
  tx: TabTransaction,
  input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly now: string;
  },
): Promise<void> {
  const [organization] = await tx.execute(
    sql`select version from organizations where id=${input.organizationId}`,
  );
  const [membership] = await tx.execute(
    sql`select status, version from memberships
      where organization_id=${input.organizationId} and user_id=${input.userId}`,
  );
  if (!organization || membership?.status === 'active') return;
  const version = Number(organization.version);
  const writes: OrganizationWrite[] = [
    {
      table: 'organizations',
      op: 'update',
      id: input.organizationId,
      set: { version: version + 1 },
    },
    membership
      ? {
          table: 'memberships',
          op: 'update',
          key: { organizationId: input.organizationId, userId: input.userId },
          set: {
            status: 'active',
            joinedAt: input.now,
            endedAt: null,
            version: Number(membership.version) + 1,
          },
        }
      : {
          table: 'memberships',
          op: 'insert',
          row: {
            organizationId: input.organizationId,
            userId: input.userId,
            status: 'active',
            joinedAt: input.now,
          },
        },
    { table: 'users', op: 'update', id: input.userId, increment: 'version' },
  ];
  await applyOrganizationWrites(tx, writes, {
    organizationId: input.organizationId,
    subjectUserId: input.userId,
  });
}
