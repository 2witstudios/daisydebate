import { consumeMessagingRead } from './handler-boundary';
import { createAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { readJson } from '../../server/http';
import { consumeWindowsOrThrow } from '../../server/rate-limit';

import { changeMessagingReaction, readMessagingReactions } from './reactions';
import { messagingReactionFence } from './reaction-fence';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';

/** Optional reaction policy never creates posting or cleanup authority. */
export function composeMessagingReactionRoute(app: App) {
  return (request: Request, channelId?: string) => {
    const policy = app.messagingPolicy;
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
        boundary: memberHttpBoundary(app),
        websocketEndpoint: app.websocketEndpoint,
        read: (value, principal) =>
          readMessagingReactions(value, principal, {
            policy: reactionPolicy,
            store: store(principal),
            limit: (actorId) => consumeMessagingRead(app, actorId),
          }),
      })(request, channelId);
    return createMessagingReactionHandler({
      boundary: memberHttpBoundary(app),
      maxBodyBytes: policy.maxBodyBytes,
      change: (value, principal) =>
        changeMessagingReaction(value, principal, {
          policy: reactionPolicy,
          store: store(principal),
          limit: (actorId) =>
            consumeWindowsOrThrow(
              app.limiter,
              `messaging:reaction:${actorId}`,
              policy.limits.reactions,
            ),
        }),
    })(request);
  };
}
export function createMessagingReactionHandler(input: {
  readonly boundary: ReturnType<typeof memberHttpBoundary>;
  readonly maxBodyBytes: number;
  readonly change: (
    value: unknown,
    principal: AuthorizationPrincipal,
  ) => Promise<unknown>;
}) {
  return (request: Request) =>
    runMemberHandler(input.boundary, request, {
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
  readonly boundary: ReturnType<typeof memberHttpBoundary>;
  readonly websocketEndpoint: string | null;
  readonly read: (
    value: unknown,
    principal: AuthorizationPrincipal,
  ) => Promise<unknown>;
}) {
  return (request: Request, channelId?: string) =>
    runMemberHandler(input.boundary, request, {
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
