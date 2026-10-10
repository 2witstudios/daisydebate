import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingGroupInvitations } from '../schema/messaging-social';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
import type {
  MessagingGroupInvitationFact,
  MessagingGroupInvitationScope,
} from './group-invitation-contracts';
type Tx = Pick<BunSQLDatabase, 'select' | 'execute'>;
const stateSchema = z.enum(['pending', 'accepted', 'declined', 'cancelled']);
export async function readGroupInvitationRow(
  tx: Tx,
  scope: MessagingGroupInvitationScope,
) {
  const [row] = await tx
    .select()
    .from(messagingGroupInvitations)
    .where(
      and(
        eq(messagingGroupInvitations.channelId, scope.channelId),
        eq(messagingGroupInvitations.inviteeActorId, scope.inviteeActorId),
      ),
    );
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}
/** Projection from durable rows only; no entitlement or product policy decision. */
export async function groupInvitationFacts(
  tx: Tx,
  channel: MessagingChannelFact,
  scope: MessagingGroupInvitationScope,
  contacts: MessagingGroupInvitationFact['contactPairs'],
  inviterActorId: string,
) {
  const row = await readGroupInvitationRow(tx, scope);
  if (row.invitedByActorId !== inviterActorId) throw createAppError('CONFLICT');
  const inviter = await readMessagingChannelFact(
    tx,
    scope.channelId,
    inviterActorId,
  );
  if (
    channel.authority.kind !== 'private_group' ||
    inviter?.authority.kind !== 'private_group'
  )
    throw createAppError('NOT_FOUND');
  const state = stateSchema.safeParse(row.state);
  if (!state.success) throw createAppError('INFRASTRUCTURE');
  const invitation: MessagingGroupInvitationFact = {
    kind: 'group_invitation',
    channel: {
      channelId: channel.channelId,
      kind: 'private_group',
      policyKey: 'social.private_group',
      policyRevision: channel.policyRevision,
      revision: channel.revision,
      lifecycle: channel.lifecycle,
      activeMemberActorIds: channel.authority.activeMemberActorIds,
    },
    invitation: {
      channelId: row.channelId,
      inviterActorId,
      inviteeActorId: row.inviteeActorId,
      generation: row.generation,
      state: state.data,
    },
    inviterGrant: {
      actorId: inviterActorId,
      role: inviter.authority.role,
      generation: inviter.authority.generation,
    },
    contactPairs: contacts,
    ...(scope.expectedGeneration === undefined
      ? {}
      : { expectedGeneration: scope.expectedGeneration }),
  };
  return { row, invitation };
}
