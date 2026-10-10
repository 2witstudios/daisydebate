import { createAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  messagingHttpBoundary,
  runMessagingHandler,
  unavailableMessagingHandler,
} from './handler-boundary';
import { changeMessagingReaction, readMessagingReactions } from './reactions';
import { messagingReactionFence } from './reaction-fence';

/** Optional reaction policy never creates posting or cleanup authority. */
export function composeMessagingReactionRoute(app: App) {
  return (request: Request, channelId?: string) => {
    const policy = app.messagingPolicy;
    if (!policy?.reactions)
      return unavailableMessagingHandler(
        app,
        request,
        'messaging.reactions.unavailable',
      );
    const reactionPolicy = policy.reactions;
    const store = (principal: AuthorizationPrincipal) =>
      app.database.messagingReactionStore(
        reactionPolicy,
        messagingReactionFence({
          principal,
          clock: app.clock,
          postingPolicy: policy.posting,
          ...(policy.groupPosting === undefined
            ? {}
            : { groupPostingPolicy: policy.groupPosting }),
          readingPolicy: policy.reading,
        }),
      );
    if (request.method === 'GET')
      return createMessagingReactionReader({
        boundary: messagingHttpBoundary(app),
        websocketEndpoint: app.websocketEndpoint,
        read: (value, principal) =>
          readMessagingReactions(value, principal, {
            policy: reactionPolicy,
            store: store(principal),
            limit: (actorId) =>
              consumeOrThrow(
                app.auth().limiter,
                `messaging:reaction-read:${actorId}`,
                policy.limits.read,
              ),
          }),
      })(request, channelId);
    return createMessagingReactionHandler({
      boundary: messagingHttpBoundary(app),
      maxBodyBytes: policy.maxBodyBytes,
      change: (value, principal) =>
        changeMessagingReaction(value, principal, {
          policy: reactionPolicy,
          store: store(principal),
          limit: (actorId) =>
            consumeOrThrow(
              app.auth().limiter,
              `messaging:reaction:${actorId}`,
              policy.limits.actorSend,
            ),
        }),
    })(request);
  };
}
export function createMessagingReactionHandler(input: {
  readonly boundary: ReturnType<typeof messagingHttpBoundary>;
  readonly maxBodyBytes: number;
  readonly change: (
    value: unknown,
    principal: AuthorizationPrincipal,
  ) => Promise<unknown>;
}) {
  return (request: Request) =>
    runMessagingHandler(input.boundary, request, {
      name: 'messaging.reaction.change',
      readOnly: false,
      readInput: () => readJson(request, input.maxBodyBytes),
      operation: input.change,
    });
}

export function readReactionQuery(
  request: Request,
  channelId: string | undefined,
) {
  const query = new URL(request.url).searchParams;
  if (query.size !== 1 || query.getAll('messageId').length !== 1)
    throw createAppError('VALIDATION');
  return { version: 1, channelId, messageId: query.get('messageId') };
}

export function createMessagingReactionReader(input: {
  readonly boundary: ReturnType<typeof messagingHttpBoundary>;
  readonly websocketEndpoint: string | null;
  readonly read: (
    value: unknown,
    principal: AuthorizationPrincipal,
  ) => Promise<unknown>;
}) {
  return (request: Request, channelId?: string) =>
    runMessagingHandler(input.boundary, request, {
      name: 'messaging.reaction.read',
      readOnly: true,
      headers:
        input.websocketEndpoint === null
          ? {}
          : { 'x-realtime-socket-url': input.websocketEndpoint },
      readInput: async () => readReactionQuery(request, channelId),
      operation: input.read,
    });
}
