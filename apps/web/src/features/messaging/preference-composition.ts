import type {
  AuthorizationPrincipal,
  AccountAuthorizationFact,
  MessagingPreferenceAuthorizationFact,
} from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import type { MessagingRuntimePolicy } from './composition';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { requireMessagingAuthorization } from './authorization';
import { messagingAuthorizationFence } from './authorization-fence';
/** Clear uses only a persisted own row and current account; read/update keep the canonical channel policy fence. */
export function composeMessagingPreferences({
  database,
  principal,
  policy,
  clock,
}: {
  readonly database: Pick<Database, 'messagingPreferenceStore'>;
  readonly principal: AuthorizationPrincipal;
  readonly policy: MessagingRuntimePolicy;
  readonly clock: Clock;
}) {
  const channel = (
    capability: 'channel.preferences.read' | 'channel.preferences.update',
  ) =>
    messagingAuthorizationFence({
      principal,
      capability,
      clock,
      postingPolicy: policy.posting,
      readingPolicy: policy.reading,
    });
  return database.messagingPreferenceStore({
    read: channel('channel.preferences.read'),
    update: channel('channel.preferences.update'),
    clear: async (_tx, input, frame) =>
      authorizeOwnPreferenceClear(principal, input, frame),
  });
}

/** Only a row-derived own preference may select clear; absence selects own collection/no-op. */
export function authorizeOwnPreferenceClear(
  principal: AuthorizationPrincipal,
  input: {
    readonly actorId: string;
    readonly userId: string;
    readonly channelId: string;
  },
  {
    accounts,
    fact,
  }: {
    readonly accounts: readonly (AccountAuthorizationFact | null)[];
    readonly fact: MessagingPreferenceAuthorizationFact | null;
  },
) {
  if (
    principal.kind !== 'user' ||
    principal.actorId !== input.actorId ||
    principal.userId !== input.userId
  )
    throw createAppError('AUTHORIZATION');
  const resource: MessagingPreferenceAuthorizationFact | null = fact;
  requireMessagingAuthorization({
    principal,
    capability: resource ? 'channel.preferences.clear' : 'channel.inbox.read',
    resource: resource ?? {
      kind: 'messaging_collection',
      actorId: input.actorId,
    },
    context: {
      account: accounts.find((row) => row?.actorId === input.actorId) ?? null,
    },
  });
}
