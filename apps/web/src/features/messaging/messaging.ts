import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
  messagingMessageView,
  type MessagingCoreBounds,
  type MessagingReactionPolicy,
  type messagingTypingSchemas,
} from '@daisy/protocol';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import { composeMessagingGroupInvitationStore } from './group-invitation-composition';
import { readMessagingGroupInvitation } from './group-invitation';
import { composeMessagingInbox } from './inbox-composition';
import { mutateMessagingMessage } from './mutate';
import { createMessagingReadOperations } from './read';
import { sendMessagingMessage } from './send';
import type { MessagingSocialRuntimePolicy } from './social-composition';

/** Explicit approved edge inputs; tests never supply production policy authority. */
export type MessagingRuntimePolicy = {
  readonly reactions?: MessagingReactionPolicy;
  readonly typing?: ReturnType<typeof messagingTypingSchemas.policy.parse>;
  readonly social?: MessagingSocialRuntimePolicy;
  readonly bounds: MessagingCoreBounds;
  readonly maxBodyBytes: number;
  readonly editWindowMs: number;
  readonly posting: SocialContactPolicy;
  readonly groupPosting?: SocialContactPolicy;
  readonly reading: MessagingReadingPolicy;
  readonly limits: {
    readonly actorSend: {
      readonly max: number;
      readonly windowSeconds: number;
    };
    readonly channelSend: {
      readonly max: number;
      readonly windowSeconds: number;
    };
    readonly read: { readonly max: number; readonly windowSeconds: number };
  };
};

type Read = 'history' | 'search' | 'changes' | 'markRead';

/**
 * The named messaging operations (architecture plan §2). Each one owns its
 * capability, rate limit, transaction and lock modes; a caller passes only
 * the principal and the untrusted input, and cannot pick a capability, a
 * lock mode or a transaction callback. Reads expose no mutation.
 */
export function composeMessaging({
  database,
  clock,
  ids,
  policy,
  limiter,
}: {
  readonly database: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly policy: MessagingRuntimePolicy;
  /** Read when an operation consumes its limit, so composing needs no live limiter. */
  readonly limiter: () => AuthRateLimiter;
}) {
  const store = (
    principal: AuthorizationPrincipal,
    capability: 'channel.post' | 'channel.read' | 'channel.message.remove',
  ) =>
    database.messagingChannelStore(
      messagingAuthorizationFence({
        principal,
        capability,
        clock,
        postingPolicy: policy.posting,
        ...(policy.groupPosting === undefined
          ? {}
          : { groupPostingPolicy: policy.groupPosting }),
        readingPolicy: policy.reading,
      }),
    );
  const consume = (
    key: string,
    rule: { readonly max: number; readonly windowSeconds: number },
  ) => consumeOrThrow(limiter(), key, rule);
  const read =
    (kind: Read) =>
    async (principal: AuthorizationPrincipal, input: unknown) => {
      if (principal.kind !== 'user' || principal.actorId === null)
        throw createAppError('AUTHORIZATION');
      await consume(`messaging:read:${principal.actorId}`, policy.limits.read);
      return createMessagingReadOperations({
        store: store(principal, 'channel.read'),
        bounds: policy.bounds,
      })[kind](input, principal);
    };
  const mutation =
    (kind: 'edit' | 'remove') =>
    async (principal: AuthorizationPrincipal, input: unknown) =>
      messagingMessageView(
        await mutateMessagingMessage(kind, input, principal, {
          store: store(
            principal,
            kind === 'edit' ? 'channel.post' : 'channel.message.remove',
          ),
          bounds: policy.bounds,
          editWindowMs: policy.editWindowMs,
          clock,
          limit: (actorId) =>
            consume(`messaging:mutation:${actorId}`, policy.limits.actorSend),
        }),
      );
  const inbox = (principal: AuthorizationPrincipal) =>
    composeMessagingInbox({
      database,
      principal,
      clock,
      postingPolicy: policy.posting,
      readingPolicy: policy.reading,
    });
  return {
    history: read('history'),
    search: read('search'),
    changes: read('changes'),
    markRead: read('markRead'),
    send: async (principal: AuthorizationPrincipal, input: unknown) =>
      messagingMessageView(
        await sendMessagingMessage(input, principal, {
          store: store(principal, 'channel.post'),
          bounds: policy.bounds,
          clock,
          ids,
          limit: async (actorId, channelId) => {
            await consume(`messaging:send:${actorId}`, policy.limits.actorSend);
            await consume(
              `messaging:send:${actorId}:${channelId}`,
              policy.limits.channelSend,
            );
          },
        }),
      ),
    edit: mutation('edit'),
    remove: mutation('remove'),
    inbox: (
      principal: AuthorizationPrincipal,
      page: { readonly limit: number; readonly after?: string },
    ) => inbox(principal).read(page),
    requestStatus: (principal: AuthorizationPrincipal, channelId: string) =>
      inbox(principal).status(channelId),
    invitationPreview: (principal: AuthorizationPrincipal, input: unknown) => {
      const social = policy.social;
      if (!social) throw createAppError('INFRASTRUCTURE');
      return readMessagingGroupInvitation(input, principal, {
        store: composeMessagingGroupInvitationStore({
          database,
          principal,
          clock,
          ...(social.groupAdmission === undefined
            ? {}
            : { admissionPolicy: social.groupAdmission }),
        }),
        bounds: social.bounds,
      });
    },
  };
}
/** The app's named messaging operations under its current policy; null when messaging is off. */
export function messagingOf(app: {
  readonly database: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly messagingPolicy: MessagingRuntimePolicy | null;
  readonly auth: () => { readonly limiter: AuthRateLimiter };
}) {
  const policy = app.messagingPolicy;
  if (!policy) return null;
  return composeMessaging({
    database: app.database,
    clock: app.clock,
    ids: app.ids,
    policy,
    limiter: () => app.auth().limiter,
  });
}
