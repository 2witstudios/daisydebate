import type { Database } from '@daisy/db';
import type { MessagingFileCleanupFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  PendingFileAuthorizationFact,
} from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { requireMessagingAuthorization } from './authorization';

/** Current own pending cleanup is independent of reading, posting and age policy. */
export function composeMessagingFileCleanup({
  database,
  principal,
}: {
  readonly database: Pick<Database, 'messagingFileCleanup'>;
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
    requireMessagingAuthorization({
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
