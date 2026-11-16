import { authorize } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { createTabStore } from '@daisy/db/tab';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** Fence proofs need the area's actual management authority, independently of the owner. */
export async function grantHostReader(world: World) {
  const organizationId = world.made.get('league')!;
  const [role] = await world.sql`select r.id from roles r
    where r.preset=true and exists(select 1 from role_permissions p where p.role_id=r.id and p.permission='organization.roles.manage')
      and exists(select 1 from role_permissions p where p.role_id=r.id and p.permission='lobby.setup.manage') order by r.rank,r.id limit 1`;
  const [organization] =
    await world.sql`select version from organizations where id=${organizationId}`;
  const [grant] =
    await world.sql`select id from grants where organization_id=${organizationId} and scope_kind='organization' and user_id=${world.bots.Staff!.userId} and revoked_at is null`;
  if (!role || !organization)
    throw new Error('Actual host reader fixture authority missing');
  const send = organizationCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  let version = Number(organization.version);
  if (grant) {
    const removed = await send(as(world.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(organization.version) },
      command: {
        type: 'remove-grant',
        grantId: String(grant.id),
        scope: { kind: 'organization', organizationId },
      },
    });
    if (removed.kind !== 'accepted')
      throw new Error('Original fixture role replacement refused');
    version = removed.receipt.resultingVersion;
  }
  const added = await send(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { organization: version },
    command: {
      type: 'give-grant',
      roleId: String(role.id),
      userId: world.bots.Staff!.userId,
      scope: { kind: 'organization', organizationId },
      expiresAt: null,
    },
  });
  if (added.kind !== 'accepted')
    throw new Error('Actual host reader role grant refused');
}
