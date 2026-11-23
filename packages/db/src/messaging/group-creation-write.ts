import { tryInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingGroupGrants,
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { messagingSocialCommandSubjects } from '../schema/messaging-social-command-subjects';
import { openStream } from './stream';
import { invalidateMessagingInboxes } from './inbox-change';
import type {
  MessagingGroupCreationFrame,
  MessagingGroupCreationScope,
} from './group-creation-contracts';
import type { Tx } from '../tx';
/** Accounts/pairs and fresh canonical prospective admission precede this atomic creation. */
export async function writeMessagingGroupCreation(
  tx: Tx,
  scope: MessagingGroupCreationScope,
  command: Parameters<MessagingGroupCreationFrame['commit']>[0],
) {
  const nowMs = tryInstantMs(command.now);
  if (
    !idSchema.safeParse(command.channelId).success ||
    nowMs === undefined ||
    scope.policyRevision === undefined
  )
    throw createAppError('VALIDATION');
  const now = new Date(nowMs);
  await tx.insert(messagingChannels).values({
    id: command.channelId,
    kind: 'private_group',
    policyKey: 'social.private_group',
    policyRevision: scope.policyRevision,
    lifecycle: 'active',
    title: command.title,
    titleAuthorActorId: scope.actorId,
    createdAt: now,
  });
  await openStream(tx, command.channelId);
  await tx.insert(messagingGroupGrants).values({
    channelId: command.channelId,
    actorId: scope.actorId,
    role: 'manager',
    generation: 1,
    grantedAt: now,
  });
  const invitees = scope.proposedActorIds.filter(
    (actorId) => actorId !== scope.actorId,
  );
  await tx.insert(messagingGroupInvitations).values(
    invitees.map((inviteeActorId) => ({
      channelId: command.channelId,
      inviteeActorId,
      invitedByActorId: scope.actorId,
      generation: 1,
      state: 'pending',
      invitedAt: now,
    })),
  );
  await tx.insert(messagingSocialCommands).values({
    actorId: scope.actorId,
    requestId: scope.requestId,
    kind: 'group.create',
    digest: command.digest,
    resultChannelId: command.channelId,
    createdAt: now,
  });
  await tx.insert(messagingSocialCommandSubjects).values(
    invitees.map((subjectActorId) => ({
      actorId: scope.actorId,
      requestId: scope.requestId,
      subjectActorId,
    })),
  );
  await invalidateMessagingInboxes(tx, scope.proposedActorIds);
  return { channelId: command.channelId, lifecycle: 'active' as const };
}
