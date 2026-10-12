import type { Database } from '@daisy/db';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import { requireMessagingActor } from './principal';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import { decideMessagingInbox } from './inbox-decision';
export function composeMessagingInbox(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const actor = requireMessagingActor(input.principal);
  return {
    read: (page: { readonly limit: number; readonly after?: string }) =>
      input.database.messagingInboxPage(
        { ...actor, ...page },
        decideMessagingInbox(input),
      ),
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
