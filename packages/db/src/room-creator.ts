import type { RoomCreator } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { clubOrganizationKinds } from './billing-owner-lock';
import { readDivisionOf } from './media-release-records';
import { rowsOf } from './raw-rows';
import type { Tx } from './room-command-facts';
import { currentTenantScope, scopeTransaction } from './tenant-scope';

/**
 * Who creates a Room, as its lobby is decided (ADR 0156): their division, and
 * whether they are club staff, who may also open a Youth Room for their
 * students. Club staff own an open club, or hold a live organisation grant
 * carrying `school.roster.manage` in an open school club they are an active
 * member of (the staff ADR 0151 names). Read inside the create transaction
 * under the creator's account lock; the caller's tenant scope is restored.
 */
export async function readRoomCreator(
  tx: Tx,
  userId: string,
): Promise<RoomCreator> {
  const division = await readDivisionOf(tx, userId);
  const scope = await currentTenantScope(tx);
  await scopeTransaction(tx, { subjectUserId: userId });
  const [staff] = await rowsOf<{ staff: boolean }>(
    tx,
    sql`select exists (
        select 1 from organizations o
        where o.owner_user_id = ${userId} and o.closed_at is null
          and o.kind in ${sql.raw(`(${clubOrganizationKinds.map((kind) => `'${kind}'`).join(', ')})`)}
      ) or exists (
        select 1 from memberships m join organizations o on o.id = m.organization_id
        join grants g on g.organization_id = o.id and g.user_id = m.user_id
        join role_permissions p on p.role_id = g.role_id
        where m.user_id = ${userId} and m.status = 'active'
          and o.kind = 'school' and o.closed_at is null
          and g.scope_kind = 'organization' and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > clock_timestamp())
          and p.permission = 'school.roster.manage'
      ) as staff`,
  );
  await scopeTransaction(tx, scope);
  return { division, clubStaff: staff?.staff === true };
}
