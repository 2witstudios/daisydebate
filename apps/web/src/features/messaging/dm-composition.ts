import type { Database } from '@daisy/db';
import type {
  AuthorizationCapability,
  AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
/** Request and closed-result capabilities are distinct from ordinary history and posting. */
export function composeMessagingDmStore(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const capabilities: Record<
    'read' | 'decide' | 'cancel' | 'result',
    AuthorizationCapability
  > = {
    read: 'channel.request.read',
    decide: 'channel.request.decide',
    cancel: 'channel.request.cancel',
    result: 'channel.request.result',
  };
  return input.database.messagingDmStore((mode) =>
    messagingAuthorizationFence({ ...input, capability: capabilities[mode] }),
  );
}
