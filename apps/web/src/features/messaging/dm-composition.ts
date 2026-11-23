import type { MessagingStore } from '@daisy/db/stores/messaging';
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
type DmQuestion = Parameters<
  Parameters<MessagingStore['messagingDmStore']>[0]
>[0];

/**
 * What a DM request step asks the evaluator. Accepting and declining are
 * one capability, so the answer travels with it: a decline is a way out a
 * minor's boundary never stops, and an answer left out is bounded as an
 * accept.
 */
export const dmRequestQuestion = (
  question: DmQuestion,
): {
  readonly capability: AuthorizationCapability;
  readonly answer?: 'accept' | 'decline';
} => {
  switch (question) {
    case 'read':
      return { capability: 'channel.request.read' };
    case 'accept':
    case 'decline':
      return { capability: 'channel.request.decide', answer: question };
    case 'cancel':
      return { capability: 'channel.request.cancel' };
    case 'result':
      return { capability: 'channel.request.result' };
  }
};

/** Request and closed-result capabilities are distinct from ordinary history and posting. */
export function composeMessagingDmStore(input: {
  readonly database: MessagingStore;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  return input.database.messagingDmStore((question) =>
    messagingAuthorizationFence({ ...input, ...dmRequestQuestion(question) }),
  );
}
