import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingGroupGrants,
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { messagingSocialCommandSubjects } from '../schema/messaging-social-command-subjects';
import { appendOutboxEvent } from '../outbox';
import { invalidateMessagingInboxes } from './inbox-change';
import type {
  MessagingGroupCreationFrame,
  MessagingGroupCreationScope,
} from './group-creation-contracts';
/** Accounts/pairs and fresh canonical prospective admission precede this atomic creation. */
export async function writeMessagingGroupCreation(
  tx: Pick<BunSQLDatabase, 'insert' | 'execute'>,
  scope: MessagingGroupCreationScope,
  command: Parameters<MessagingGroupCreationFrame['commit']>[0],
) {
  const now = new Date(command.now);
  if (
    !idSchema.safeParse(command.channelId).success ||
    !Number.isFinite(now.getTime()) ||
    scope.policyRevision === undefined
  )
    throw createAppError('VALIDATION');
  await tx.insert(messagingChannels).values({
    id: command.channelId,
    kind: 'private_group',
    policyKey: 'social.private_group',
    policyRevision: scope.policyRevision,
    lifecycle: 'active',
    title: command.title,
    createdAt: now,
    changeVersion: 1,
  });
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
  await appendOutboxEvent(tx, {
    topic: buildChannelTopic(command.channelId),
    kind: 'channel.changed',
    version: 1,
    payload: {
      kind: 'channel.changed',
      channelId: command.channelId,
      changeVersion: 1,
    },
  });
  await invalidateMessagingInboxes(tx, scope.proposedActorIds);
  return { channelId: command.channelId, lifecycle: 'active' as const };
}
