import { defineComposition } from '../../server/composition';
import { createMessageRequestSettingRoute } from './request-setting-route';
import { consumeMessagingRead } from './handler-boundary';
import { composeMessagingReactionRoute } from './reaction-route';
import { composeMessagingTypingRoutes } from './typing-route';
import { composeMessagingPreferenceRoutes } from './preference-route';
import { composeMessagingFileRoutes } from './files/route-composition';
import { composeMessagingGroupIssuanceRoute } from './group-issuance-route';
import { composeMessagingGroupManagementRoute } from './group-management-route';
import { composeMessagingCreationIntentRoutes } from './creation-intent-route';
import { composeMessagingGroupCreationRoute } from './group-creation-route';
import { composeMessagingGroupInvitationRoutes } from './group-invitation-route';
import {
  composeMessagingChannelEntryRoute,
  composeMessagingInboxRoute,
  composeMessagingUnreadRoute,
} from './inbox-route';
import { composeRetainedConversationRoutes } from './retained-route';
import {
  composeMessagingSocialRoutes,
  type MessagingSocialRuntimePolicy,
} from './social-composition';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import { createAppError } from '@daisy/errors';
import { channelMessageView } from '@daisy/protocol/messaging/channel-messages';
import { messagingTypingSchemas } from '@daisy/protocol/messaging/typing';
import type { MessagingCoreBounds } from '@daisy/protocol/messaging/core';
import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import { consumeWindowsOrThrow, type RateRule } from '../../server/rate-limit';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import { createMessagingHandlers } from './handlers';
import { createMessagingReadOperations } from './read';
import { sendMessagingMessage } from './send';
import { mutateMessagingMessage } from './mutate';

/** Explicit approved edge inputs; tests never supply production policy authority. */
export type MessagingRuntimePolicy = {
  readonly reactions: import('@daisy/protocol/messaging/reactions').MessagingReactionPolicy;
  readonly typing: ReturnType<
    typeof import('@daisy/protocol/messaging/typing').messagingTypingSchemas.policy.parse
  >;
  readonly social: MessagingSocialRuntimePolicy;
  readonly bounds: MessagingCoreBounds;
  readonly maxBodyBytes: number;
  readonly editWindowMs: number;
  readonly posting: SocialContactPolicy;
  /**
   * Group availability is explicit and independent of admission policy.
   * The deployment composition enables staging only; injected policy alone
   * never turns groups on.
   */
  readonly privateGroups: 'off' | 'enabled';
  readonly groupPosting?: SocialContactPolicy;
  readonly reading: MessagingReadingPolicy;
  /** DEC-251 per-account windows (beta-policy.ts), each its own bucket. */
  readonly limits: {
    readonly actorSend: readonly RateRule[];
    readonly read: readonly RateRule[];
    readonly reactions: readonly RateRule[];
    readonly typing: readonly RateRule[];
    /** DEC-251: attachment uploads per account per day. */
    readonly fileUploadsDaily: number;
    /** DEC-251: the largest attachment a file runtime may accept. */
    readonly fileBytes: number;
  };
};
export function composeMessagingRoutes(app: App) {
  const policy = app.messagingPolicy;
  /** Built per request, as before; each route names its own operation. */
  const handlersForRequest = () => {
    const store = (
      principal: Parameters<typeof sendMessagingMessage>[1],
      capability: 'channel.post' | 'channel.read' | 'channel.message.remove',
    ) =>
      app.database.messagingChannelStore(
        messagingAuthorizationFence({
          principal,
          capability,
          clock: app.clock,
          postingPolicy: policy.posting,
          ...(policy.groupPosting === undefined
            ? {}
            : { groupPostingPolicy: policy.groupPosting }),
          readingPolicy: policy.reading,
        }),
      );
    const mutation =
      (kind: 'edit' | 'remove') =>
      async (
        input: unknown,
        principal: Parameters<typeof sendMessagingMessage>[1],
      ) =>
        channelMessageView(
          await mutateMessagingMessage(kind, input, principal, {
            store: store(
              principal,
              kind === 'edit' ? 'channel.post' : 'channel.message.remove',
            ),
            bounds: policy.bounds,
            editWindowMs: policy.editWindowMs,
            clock: app.clock,
            limit: async (actorId) =>
              consumeWindowsOrThrow(
                app.limiter,
                `messaging:send:${actorId}`,
                policy.limits.actorSend,
              ),
          }),
        );
    return createMessagingHandlers({
      logger: app.logger,
      reporter: app.reporter,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      maxBodyBytes: policy.maxBodyBytes,
      bounds: policy.bounds,
      websocketEndpoint: app.websocketEndpoint,
      typingRefetchMs: messagingTypingSchemas.policy.parse(policy.typing)
        .refetchMs,
      identify: (request) => identify(app.auth(), request.headers),
      edit: mutation('edit'),
      remove: mutation('remove'),
      send: (input, principal) =>
        sendMessagingMessage(input, principal, {
          store: store(principal, 'channel.post'),
          bounds: policy.bounds,
          clock: app.clock,
          ids: app.ids,
          limit: (actorId) =>
            consumeWindowsOrThrow(
              app.limiter,
              `messaging:send:${actorId}`,
              policy.limits.actorSend,
            ),
        }).then(channelMessageView),
      ...(Object.fromEntries(
        (['history', 'search', 'changes', 'markRead'] as const).map((kind) => [
          kind,
          async (
            input: unknown,
            principal: Parameters<typeof sendMessagingMessage>[1],
          ) => {
            if (principal.kind !== 'user' || principal.actorId === null)
              throw createAppError('AUTHORIZATION');
            await consumeMessagingRead(app, principal.actorId);
            return createMessagingReadOperations({
              store: store(principal, 'channel.read'),
              bounds: policy.bounds,
            })[kind](input, principal);
          },
        ]),
      ) as Pick<
        Parameters<typeof createMessagingHandlers>[0],
        'history' | 'search' | 'changes' | 'markRead'
      >),
    });
  };
  return {
    ...composeMessagingSocialRoutes(app),
    ...composeMessagingCreationIntentRoutes(app),
    ...composeMessagingGroupInvitationRoutes(app),
    manageGroup: composeMessagingGroupManagementRoute(app),
    inviteGroup: composeMessagingGroupIssuanceRoute(app),
    files: composeMessagingFileRoutes(app),
    createGroup: composeMessagingGroupCreationRoute(app),
    inbox: composeMessagingInboxRoute(app),
    unread: composeMessagingUnreadRoute(app),
    channelEntry: composeMessagingChannelEntryRoute(app),
    retained: composeRetainedConversationRoutes(app),
    preferences: composeMessagingPreferenceRoutes(app),
    typing: composeMessagingTypingRoutes(app),
    reactions: composeMessagingReactionRoute(app),
    requestSetting: createMessageRequestSettingRoute({
      logger: app.logger,
      reporter: app.reporter,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      identify: (request) => identify(app.auth(), request.headers),
      limiter: () => app.limiter,
      store: app.database,
    }),
    send: (request: Request) => handlersForRequest().send(request),
    edit: (request: Request) => handlersForRequest().edit(request),
    remove: (request: Request) => handlersForRequest().remove(request),
    search: (request: Request, channelId: string) =>
      handlersForRequest().search(request, channelId),
    history: (request: Request, channelId: string) =>
      handlersForRequest().history(request, channelId),
    changes: (request: Request, channelId: string) =>
      handlersForRequest().changes(request, channelId),
    markRead: (request: Request) => handlersForRequest().markRead(request),
  };
}

/** messaging: its route files bind here (`processRoute`). */
export const messagingComposition = defineComposition('messaging', (app) =>
  composeMessagingRoutes(app),
);
