import { composeMessagingReactionRoute } from './reaction-route';
import { composeMessagingTypingRoutes } from './typing-route';
import { composeMessagingPreferenceRoutes } from './preference-route';
import { composeMessagingFileRoutes } from './files/route-composition';
import { composeMessagingGroupIssuanceRoute } from './group-issuance-route';
import { composeMessagingGroupManagementRoute } from './group-management-route';
import { composeMessagingCreationIntentRoutes } from './creation-intent-route';
import { composeMessagingGroupCreationRoute } from './group-creation-route';
import { composeMessagingGroupInvitationRoutes } from './group-invitation-route';
import { composeMessagingInboxRoute } from './inbox-route';
import { composeMessagingSocialRoutes } from './social-composition';
import { createAppError } from '@daisy/errors';
import { messagingTypingSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { identify } from '../../lib/identity';
import { createMessagingHandlers } from './handlers';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';

type Read = 'history' | 'search' | 'changes' | 'markRead';

export function composeMessagingRoutes(app: App) {
  const policy = app.messagingPolicy;
  const run = (
    request: Request,
    operation:
      | 'send'
      | 'edit'
      | 'remove'
      | 'history'
      | 'search'
      | 'changes'
      | 'markRead',
    channelId?: string,
  ) => {
    const messaging = app.messaging;
    if (!policy || !messaging)
      return handleOperation(
        app.logger,
        request,
        'messaging.unavailable',
        async () => {
          throw createAppError('INFRASTRUCTURE');
        },
      );
    const named =
      (kind: 'send' | 'edit' | 'remove' | Read) =>
      (input: unknown, principal: AuthorizationPrincipal) =>
        messaging[kind](principal, input);
    const handlers = createMessagingHandlers({
      logger: app.logger,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      maxBodyBytes: policy.maxBodyBytes,
      bounds: policy.bounds,
      websocketEndpoint: app.websocketEndpoint,
      ...(policy.typing === undefined
        ? {}
        : {
            typingRefetchMs: messagingTypingSchemas.policy.parse(policy.typing)
              .refetchMs,
          }),
      identify: (request) => identify(app.auth(), request.headers),
      send: named('send'),
      edit: named('edit'),
      remove: named('remove'),
      history: named('history'),
      search: named('search'),
      changes: named('changes'),
      markRead: named('markRead'),
    });
    if (
      operation === 'history' ||
      operation === 'search' ||
      operation === 'changes'
    )
      return handlers[operation](request, channelId!);
    return handlers[operation](request);
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
    preferences: composeMessagingPreferenceRoutes(app),
    typing: composeMessagingTypingRoutes(app),
    reactions: composeMessagingReactionRoute(app),
    send: (request: Request) => run(request, 'send'),
    edit: (request: Request) => run(request, 'edit'),
    remove: (request: Request) => run(request, 'remove'),
    search: (request: Request, channelId: string) =>
      run(request, 'search', channelId),
    history: (request: Request, channelId: string) =>
      run(request, 'history', channelId),
    changes: (request: Request, channelId: string) =>
      run(request, 'changes', channelId),
    markRead: (request: Request) => run(request, 'markRead'),
  };
}
