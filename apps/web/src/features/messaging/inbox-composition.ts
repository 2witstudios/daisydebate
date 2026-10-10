import { composeMessagingGroupInvitationStore } from './group-invitation-composition';
import type { Database } from '@daisy/db';
import type {
  MessagingCollectionAuthorizationFact,
  AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import { requireMessagingActor } from './principal';
import { requireMessagingAuthorization } from './authorization';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import {
  readMessagingInbox,
  inspectMessagingInboxAssociation,
  type MessagingInboxEntry,
} from './inbox';
export function composeMessagingInbox(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const actor = requireMessagingActor(input.principal);
  const store = input.database.messagingInboxStore(
    async ({ scope, account }) => {
      requireMessagingAuthorization({
        principal: input.principal,
        capability: 'channel.inbox.read',
        resource: {
          kind: 'messaging_collection',
          actorId: scope.actorId,
        } satisfies MessagingCollectionAuthorizationFact,
        context: { account, now: input.clock.now() },
      });
    },
  );
  const inspectChannel = (channelId: string): Promise<MessagingInboxEntry> =>
    input.database.messagingChannelAuthority(
      { ...actor, channelId },
      async (frame) => {
        const pending =
          frame.fact.authority.kind === 'dm' &&
          frame.fact.authority.state === 'pending';
        const sender =
          frame.fact.authority.kind === 'dm' &&
          frame.fact.authority.requestSenderActorId === actor.actorId;
        await messagingAuthorizationFence({
          ...input,
          capability: pending
            ? sender
              ? 'channel.request.status'
              : 'channel.request.read'
            : 'channel.read',
        })(frame.tx, { ...actor, channelId }, frame);
        return {
          channelId,
          kind: pending
            ? sender
              ? 'outgoing_request'
              : 'incoming_request'
            : frame.fact.authority.kind === 'private_group'
              ? 'group_conversation'
              : 'conversation',
        };
      },
    );
  const inspect = (channelId: string): Promise<MessagingInboxEntry> =>
    inspectMessagingInboxAssociation(channelId, {
      channel: () => inspectChannel(channelId),
      invitation: () =>
        composeMessagingGroupInvitationStore(input).withInvitation(
          {
            ...actor,
            channelId,
            inviteeActorId: actor.actorId,
            operation: 'read',
          },
          async (frame) => {
            await frame.preview();
          },
        ),
    });
  return {
    read: (page: { readonly limit: number; readonly after?: string }) =>
      readMessagingInbox(page, {
        candidates: (query) => store.candidates({ ...actor, ...query }),
        inspect,
      }),
    status: (channelId: string) =>
      input.database.messagingChannelAuthority(
        { ...actor, channelId },
        async (frame) => {
          await messagingAuthorizationFence({
            ...input,
            capability: 'channel.request.status',
          })(frame.tx, { ...actor, channelId }, frame);
          return { channelId, state: 'pending' as const };
        },
      ),
  };
}
