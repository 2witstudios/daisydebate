import type { MessagingStore } from '@daisy/db/stores/messaging';
import type { MessagingFileCleanupFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  PendingFileAuthorizationFact,
} from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { requireAuthorization } from '@daisy/auth/request-authorization';

/** Current own pending cleanup is independent of reading, posting and age policy. */
export function composeMessagingFileCleanup({
  database,
  principal,
}: {
  readonly database: Pick<MessagingStore, 'messagingFileCleanup'>;
  readonly principal: AuthorizationPrincipal;
}) {
  const authorize: MessagingFileCleanupFence = async (_tx, input, frame) => {
    if (
      principal.kind !== 'user' ||
      principal.userId !== input.userId ||
      principal.actorId !== input.actorId
    )
      throw createAppError('AUTHORIZATION');
    const resource: PendingFileAuthorizationFact = frame.fact;
    requireAuthorization({
      principal,
      capability: 'channel.file.cleanup',
      resource,
      context: {
        account:
          frame.accounts.find((row) => row?.actorId === input.actorId) ?? null,
      },
    });
  };
  return database.messagingFileCleanup(authorize);
}
