import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingGroupGrants,
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { planGroupManagement } from './group-management-plan';
import { advanceSocialChannelAuthority } from './social-channel-change';
import { invalidateMessagingInboxes } from './inbox-change';
import type { MessagingGroupManagementScope } from './group-management-contracts';
import type { MessagingChannelFact } from './social';
type Tx = Pick<BunSQLDatabase, 'select' | 'update' | 'insert' | 'execute'>;

async function closeIssuedInvitations(
  tx: Tx,
  scope: MessagingGroupManagementScope,
  now: Date,
) {
  const issuer =
    scope.operation === 'remove' ? scope.targetActorId : scope.actorId;
  const closed = await tx
    .update(messagingGroupInvitations)
    .set({ state: 'cancelled', decidedAt: now })
    .where(
      and(
        eq(messagingGroupInvitations.channelId, scope.channelId),
        eq(messagingGroupInvitations.state, 'pending'),
        ...(scope.operation === 'archive'
          ? []
          : [
              eq(
                messagingGroupInvitations.invitedByActorId,
                issuer ?? scope.actorId,
              ),
            ]),
      ),
    )
    .returning({ actorId: messagingGroupInvitations.inviteeActorId });
  return closed.map((row) => row.actorId);
}
/** Called only after the current canonical mutation fence; scoped effects remain atomic. */
export async function writeGroupManagement(
  tx: Tx,
  scope: MessagingGroupManagementScope,
  fact: MessagingChannelFact,
  command: { readonly digest: string; readonly now: string },
) {
  if (!/^[a-f0-9]{64}$/.test(command.digest))
    throw createAppError('VALIDATION');
  const grants = await tx
    .select({
      actorId: messagingGroupGrants.actorId,
      role: messagingGroupGrants.role,
      generation: messagingGroupGrants.generation,
      grantedAt: messagingGroupGrants.grantedAt,
    })
    .from(messagingGroupGrants)
    .where(
      and(
        eq(messagingGroupGrants.channelId, scope.channelId),
        isNull(messagingGroupGrants.revokedAt),
      ),
    )
    .for('update');
  const plan = planGroupManagement({
    ...scope,
    lifecycle: fact.lifecycle,
    grants: grants.map((grant) => {
      if (grant.role !== 'manager' && grant.role !== 'member')
        throw createAppError('INFRASTRUCTURE');
      return { ...grant, role: grant.role };
    }),
    now: command.now,
  });
  for (const change of plan.changes) {
    const changed = await tx
      .update(messagingGroupGrants)
      .set({
        role: change.role,
        generation: change.generation,
        revokedAt: change.revokedAt,
      })
      .where(
        and(
          eq(messagingGroupGrants.channelId, scope.channelId),
          eq(messagingGroupGrants.actorId, change.actorId),
          eq(messagingGroupGrants.generation, change.expectedGeneration),
          isNull(messagingGroupGrants.revokedAt),
        ),
      )
      .returning({ actorId: messagingGroupGrants.actorId });
    if (!changed[0]) throw createAppError('CONFLICT');
  }
  const now = new Date(command.now);
  const invitees = await closeIssuedInvitations(tx, scope, now);
  const [channel] = await tx
    .update(messagingChannels)
    .set({ lifecycle: plan.lifecycle })
    .where(
      and(
        eq(messagingChannels.id, scope.channelId),
        eq(messagingChannels.authorityRevision, fact.revision),
      ),
    )
    .returning();
  if (!channel) throw createAppError('CONFLICT');
  await tx.insert(messagingSocialCommands).values({
    actorId: scope.actorId,
    requestId: scope.requestId,
    kind: `group.${scope.operation}`,
    digest: command.digest,
    resultChannelId: scope.channelId,
    counterpartActorId: scope.targetActorId ?? null,
    createdAt: now,
  });
  await advanceSocialChannelAuthority(tx, channel);
  await invalidateMessagingInboxes(tx, [
    ...grants.map((g) => g.actorId),
    ...invitees,
  ]);
  return { channelId: scope.channelId, lifecycle: plan.lifecycle };
}
