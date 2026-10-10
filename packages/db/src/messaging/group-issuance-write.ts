import { writeMessagingGroupLifecycle } from './group-channel-write';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { messagingSocialCommandSubjects } from '../schema/messaging-social-command-subjects';
import { planGroupIssuance } from './group-issuance-plan';
import { advanceSocialChannelAuthority } from './social-channel-change';
import { invalidateMessagingInboxes } from './inbox-change';
import type { MessagingChannelFact } from './social';
import type {
  MessagingGroupIssuanceScope,
  MessagingGroupIssuanceStore,
} from './group-issuance-contracts';
type Command = Parameters<
  Parameters<
    Parameters<MessagingGroupIssuanceStore['withIssuance']>[1]
  >[0]['commit']
>[0];
type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
/** No grant is created here. Every association and thin invalidation is in the caller tx. */
export async function writeGroupIssuance(
  tx: Tx,
  scope: MessagingGroupIssuanceScope,
  fact: MessagingChannelFact,
  command: Command,
) {
  if (
    fact.authority.kind !== 'private_group' ||
    fact.lifecycle !== 'active' ||
    !/^[a-f0-9]{64}$/.test(command.digest)
  )
    throw createAppError('VALIDATION');
  const previous = await tx
    .select({
      inviteeActorId: messagingGroupInvitations.inviteeActorId,
      generation: messagingGroupInvitations.generation,
      state: messagingGroupInvitations.state,
      invitedAt: messagingGroupInvitations.invitedAt,
    })
    .from(messagingGroupInvitations)
    .where(eq(messagingGroupInvitations.channelId, scope.channelId))
    .for('update');
  const plan = planGroupIssuance({
    ...scope,
    ...command,
    activeMemberActorIds: fact.authority.activeMemberActorIds,
    previous,
  });
  const now = new Date(command.now);
  for (const invitation of plan) {
    const fields = {
      invitedByActorId: scope.actorId,
      generation: invitation.generation,
      state: 'pending',
      invitedAt: now,
      decidedAt: null,
    };
    const [changed] = await tx
      .insert(messagingGroupInvitations)
      .values({
        channelId: scope.channelId,
        inviteeActorId: invitation.inviteeActorId,
        ...fields,
      })
      .onConflictDoUpdate({
        target: [
          messagingGroupInvitations.channelId,
          messagingGroupInvitations.inviteeActorId,
        ],
        set: fields,
        setWhere: eq(
          messagingGroupInvitations.generation,
          invitation.expectedGeneration,
        ),
      })
      .returning({ generation: messagingGroupInvitations.generation });
    if (!changed) throw createAppError('CONFLICT');
  }
  const channel = await writeMessagingGroupLifecycle(
    tx,
    scope.channelId,
    fact.revision,
    'active',
  );
  await tx.insert(messagingSocialCommands).values({
    actorId: scope.actorId,
    requestId: scope.requestId,
    kind: 'group.invite',
    digest: command.digest,
    resultChannelId: scope.channelId,
    createdAt: now,
  });
  await tx.insert(messagingSocialCommandSubjects).values(
    scope.inviteeActorIds.map((subjectActorId) => ({
      actorId: scope.actorId,
      requestId: scope.requestId,
      subjectActorId,
    })),
  );
  await advanceSocialChannelAuthority(tx, channel);
  await invalidateMessagingInboxes(tx, [
    ...fact.authority.activeMemberActorIds,
    ...scope.inviteeActorIds,
  ]);
  return { channelId: scope.channelId, lifecycle: fact.lifecycle };
}
