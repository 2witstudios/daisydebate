import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingSocialCommands } from '../schema/messaging-social';
import { withLockedMessagingAuthority } from './authority-frame';
import {
  readGroupInvitationRow,
  groupInvitationFacts,
} from './group-invitation-facts';
import { lockGroupContacts } from './group-contact-locks';
import { writeGroupInvitationDecision } from './group-invitation-write';
import type {
  MessagingGroupDecision,
  MessagingGroupInvitationFact,
  MessagingGroupInvitationFence,
  MessagingGroupInvitationStore,
} from './group-invitation-contracts';
/** Account -> selected contact pairs -> channel. Invitation associations never become grants. */
export function createMessagingGroupInvitationStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingGroupInvitationFence;
}): MessagingGroupInvitationStore {
  return {
    withInvitation: (scope, work) => {
      if (!idSchema.safeParse(scope.inviteeActorId).success)
        throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const discovered = await readGroupInvitationRow(tx, scope);
        let contacts: MessagingGroupInvitationFact['contactPairs'] = [];
        return withLockedMessagingAuthority(
          tx,
          scope,
          async (authority) => {
            const fresh = async (
              operation: 'read' | 'result' | MessagingGroupDecision,
            ) => {
              const facts = await groupInvitationFacts(
                tx,
                authority.fact,
                scope,
                contacts,
                discovered.invitedByActorId,
              );
              await authorize(tx, scope, operation, {
                invitation: facts.invitation,
                channel: authority.fact,
                accounts: authority.accounts,
              });
              return facts;
            };
            let observed: {
              requestId: string;
              decision: MessagingGroupDecision;
            } | null = null;
            return work({
              async preview() {
                if (scope.operation !== 'read')
                  throw createAppError('CONFLICT');
                const { invitation } = await fresh('read');
                return {
                  channelId: scope.channelId,
                  generation: invitation.invitation.generation,
                  state: invitation.invitation.state,
                };
              },
              async readDecisionState(requestId, decision) {
                if (
                  scope.operation !== decision ||
                  !idSchema.safeParse(requestId).success
                )
                  throw createAppError('VALIDATION');
                const row = await readGroupInvitationRow(tx, scope);
                const { invitation } = await fresh(
                  row.state === 'pending' ? decision : 'result',
                );
                const [receipt] = await tx
                  .select({
                    kind: messagingSocialCommands.kind,
                    digest: messagingSocialCommands.digest,
                    channelId: messagingSocialCommands.resultChannelId,
                    counterpartActorId:
                      messagingSocialCommands.counterpartActorId,
                  })
                  .from(messagingSocialCommands)
                  .where(
                    and(
                      eq(messagingSocialCommands.actorId, scope.actorId),
                      eq(messagingSocialCommands.requestId, requestId),
                    ),
                  );
                observed = { requestId, decision };
                return {
                  channelId: scope.channelId,
                  generation: invitation.invitation.generation,
                  state: invitation.invitation.state,
                  invitedAt: row.invitedAt.toISOString(),
                  inviterActorId: row.invitedByActorId,
                  receipt: receipt ?? null,
                };
              },
              async commitDecision(command) {
                if (
                  !observed ||
                  observed.requestId !== command.requestId ||
                  observed.decision !== command.decision ||
                  scope.operation !== command.decision
                )
                  throw createAppError('CONFLICT');
                const { invitation } = await fresh(command.decision);
                const result = await writeGroupInvitationDecision(
                  tx,
                  scope,
                  invitation,
                  command,
                );
                observed = null;
                return result;
              },
            });
          },
          {
            additionalActors: [
              discovered.invitedByActorId,
              scope.inviteeActorId,
            ],
            beforeChannel: async (frame) => {
              if (frame.fact.authority.kind !== 'private_group')
                throw createAppError('NOT_FOUND');
              const current = await readGroupInvitationRow(tx, scope);
              if (current.invitedByActorId !== discovered.invitedByActorId)
                throw createAppError('CONFLICT');
              const admitting =
                scope.operation === 'accept' && current.state === 'pending';
              contacts = await lockGroupContacts(
                tx,
                admitting
                  ? [
                      ...frame.fact.authority.activeMemberActorIds,
                      scope.inviteeActorId,
                    ]
                  : [discovered.invitedByActorId, scope.inviteeActorId],
                admitting,
              );
            },
          },
        );
      });
    },
  };
}
