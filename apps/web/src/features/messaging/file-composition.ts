import type { Database } from '@daisy/db';
import type { FileStore } from '@daisy/db/messaging-files';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';

/** Canonical policy is re-evaluated after waits in the file provider's exact tx. */
export function composeMessagingFileStore(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
  readonly groupPostingPolicy?: SocialContactPolicy;
}): FileStore {
  return input.database.messagingFileStore((capability) =>
    messagingAuthorizationFence({
      principal: input.principal,
      clock: input.clock,
      capability: capability === 'post' ? 'channel.post' : 'channel.read',
      postingPolicy: input.postingPolicy,
      readingPolicy: input.readingPolicy,
      ...(input.groupPostingPolicy === undefined
        ? {}
        : { groupPostingPolicy: input.groupPostingPolicy }),
    }),
  );
}
