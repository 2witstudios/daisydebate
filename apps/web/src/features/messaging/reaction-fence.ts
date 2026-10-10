import type { MessagingReactionAuthorizationFact } from '@daisy/auth/authorization';
import type { MessagingReactionFence } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { requireMessagingAuthorization } from './authorization';
import {
  loadMessagingAuthorizationInput,
  messagingAuthorizationFence,
} from './authorization-fence';
/** The removal proof is the locked own association, never a body intent or an absent row. */
export function messagingReactionFence(
  options: Omit<
    Parameters<typeof messagingAuthorizationFence>[0],
    'capability'
  >,
): MessagingReactionFence {
  return async (tx, scope, frame, operation, association) => {
    const input = await loadMessagingAuthorizationInput(
      tx,
      scope,
      frame,
      options,
    );
    if (operation === 'remove') {
      if (!association) throw createAppError('NOT_FOUND');
      const resource = {
        kind: 'channel_reaction',
        channel: input.resource,
        reaction: association,
      } satisfies MessagingReactionAuthorizationFact;
      requireMessagingAuthorization({
        ...input,
        capability: 'channel.reaction.remove',
        resource,
      });
    } else
      requireMessagingAuthorization({
        ...input,
        capability: operation === 'add' ? 'channel.post' : 'channel.read',
      });
  };
}
