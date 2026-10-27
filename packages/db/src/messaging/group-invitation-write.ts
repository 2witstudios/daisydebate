import { and, eq, isNotNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingGroupGrants,
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { advanceSocialChannelAuthority } from './social-channel-change';
import { invalidateMessagingInboxes } from './inbox-change';
import type {
  MessagingGroupInvitationFrame,
  MessagingGroupInvitationFact,
  MessagingGroupInvitationScope,
} from './group-invitation-contracts';
type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
type Command = Parameters<MessagingGroupInvitationFrame['commitDecision']>[0];
const outcomes = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
} as const;
async function grantInvitee(
  tx: Tx,
  scope: MessagingGroupInvitationScope,
  now: Date,
) {
  const [previous] = await tx
    .select()
    .from(messagingGroupGrants)
    .where(
      and(
        eq(messagingGroupGrants.channelId, scope.channelId),
        eq(messagingGroupGrants.actorId, scope.inviteeActorId),
      ),
    );
  if (previous && previous.revokedAt === null) throw createAppError('CONFLICT');
  const generation = (previous?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation) || generation <= 0)
    throw createAppError('CONFLICT');
  const changed = await tx
    .insert(messagingGroupGrants)
    .values({
      channelId: scope.channelId,
      actorId: scope.inviteeActorId,
      role: 'member',
      generation,
      grantedAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [messagingGroupGrants.channelId, messagingGroupGrants.actorId],
      set: { role: 'member', generation, grantedAt: now, revokedAt: null },
      setWhere: isNotNull(messagingGroupGrants.revokedAt),
    })
    .returning({ actorId: messagingGroupGrants.actorId });
  if (!changed[0]) throw createAppError('CONFLICT');
}
/** Caller holds all account/pair/channel fences and just evaluated the exact pending action. */
export async function writeGroupInvitationDecision(
  tx: Tx,
  scope: MessagingGroupInvitationScope,
  fact: MessagingGroupInvitationFact,
  command: Command,
) {
  const now = new Date(command.now);
  if (!Number.isFinite(now.getTime())) throw createAppError('VALIDATION');
  const changed = await tx
    .update(messagingGroupInvitations)
    .set({ state: outcomes[command.decision], decidedAt: now })
    .where(
      and(
        eq(messagingGroupInvitations.channelId, scope.channelId),
        eq(messagingGroupInvitations.inviteeActorId, scope.inviteeActorId),
        eq(messagingGroupInvitations.generation, scope.expectedGeneration ?? 0),
        eq(messagingGroupInvitations.state, 'pending'),
      ),
    )
    .returning({ generation: messagingGroupInvitations.generation });
  if (!changed[0]) throw createAppError('CONFLICT');
  if (command.decision === 'accept') await grantInvitee(tx, scope, now);
  const counterpartActorId =
    scope.actorId === fact.invitation.inviterActorId
      ? fact.invitation.inviteeActorId
      : fact.invitation.inviterActorId;
  await tx.insert(messagingSocialCommands).values({
    actorId: scope.actorId,
    counterpartActorId,
    requestId: command.requestId,
    kind: 'group.decide',
    digest: command.digest,
    resultChannelId: scope.channelId,
    createdAt: now,
  });
  const [channel] = await tx
    .select()
    .from(messagingChannels)
    .where(eq(messagingChannels.id, scope.channelId));
  if (!channel) throw createAppError('NOT_FOUND');
  await advanceSocialChannelAuthority(tx, channel);
  await invalidateMessagingInboxes(tx, [
    ...fact.channel.activeMemberActorIds,
    fact.invitation.inviterActorId,
    fact.invitation.inviteeActorId,
  ]);
  return {
    channelId: scope.channelId,
    generation: changed[0].generation,
    state: outcomes[command.decision],
  };
}
