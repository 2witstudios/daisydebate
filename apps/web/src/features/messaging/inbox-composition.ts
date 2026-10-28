import type { Database } from '@daisy/db';
import type {
  MessagingCollectionAuthorizationFact,
  AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';

import { requireAuthorization } from '@daisy/auth/request-authorization';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import { readMessagingInboxSummary } from '@daisy/db/messaging';
import {
  decideMessagingInboxCandidate,
  messagingInboxEntries,
  messagingInboxView,
  summarizeMessagingInboxEntry,
  type MessagingInboxEntry,
} from './inbox';
import { requireMemberActor } from '../access/actor';
export function composeMessagingInbox(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const actor = requireMemberActor(input.principal);
  const inspectChannel = (channelId: string): Promise<MessagingInboxEntry> =>
    input.database.messagingChannelAuthority(
      { ...actor, channelId },
      async (frame) => {
        const view = messagingInboxView(frame.fact.authority, actor.actorId);
        await messagingAuthorizationFence({
          ...input,
          capability: view.capability,
        })(frame.tx, { ...actor, channelId }, frame);
        return summarizeMessagingInboxEntry(
          channelId,
          view.kind,
          await readMessagingInboxSummary(frame.tx, {
            channelId,
            actorId: actor.actorId,
            counterpartActorId: view.counterpartActorId,
            content: view.content,
          }),
        );
      },
    );
  /** One bounded transaction per page; the decision is pure over its fenced facts. */
  const read = async (page: {
    readonly limit: number;
    readonly after?: string;
  }) => {
    const now = input.clock.now();
    const result = await input.database.messagingInboxPage(
      { ...actor, ...page, now },
      {
        collection: (account) =>
          requireAuthorization({
            principal: input.principal,
            capability: 'channel.inbox.read',
            resource: {
              kind: 'messaging_collection',
              actorId: actor.actorId,
            } satisfies MessagingCollectionAuthorizationFact,
            context: { account, now },
          }),
        decide: (candidate, ageOf) =>
          decideMessagingInboxCandidate(candidate, ageOf, { ...input, now }),
        summaryOf: (decision) => decision.summary,
      },
    );
    return {
      entries: messagingInboxEntries(result.entries),
      nextAfter: result.nextAfter,
    };
  };
  return {
    /** One channel's entry under the same fresh authority as the inbox. */
    entry: inspectChannel,
    read,
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
