import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import { createAppError } from '@daisy/errors';
import type { MessagingCoreBounds } from '@daisy/protocol';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { identify } from '../../lib/identity';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
import { createMessagingHandlers } from './handlers';
import { createMessagingReadOperations } from './read';
import { sendMessagingMessage } from './send';

/** Explicit approved edge inputs; tests never supply production policy authority. */
export type MessagingRuntimePolicy = {
  readonly bounds: MessagingCoreBounds;
  readonly maxBodyBytes: number;
  readonly posting: SocialContactPolicy;
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
export function composeMessagingRoutes(app: App) {
  const policy = app.messagingPolicy;
  const run = (
    request: Request,
    operation: 'send' | 'history' | 'changes' | 'markRead',
    channelId?: string,
  ) => {
    if (!policy)
      return handleOperation(
        app.logger,
        request,
        'messaging.unavailable',
        async () => {
          throw createAppError('INFRASTRUCTURE');
        },
      );
    const store = (
      principal: Parameters<typeof sendMessagingMessage>[1],
      capability: 'channel.post' | 'channel.read',
    ) =>
      app.database.messagingChannelStore(
        messagingAuthorizationFence({
          principal,
          capability,
          clock: app.clock,
          postingPolicy: policy.posting,
          readingPolicy: policy.reading,
        }),
      );
    const handlers = createMessagingHandlers({
      logger: app.logger,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      maxBodyBytes: policy.maxBodyBytes,
      identify: (request) => identify(app.auth(), request.headers),
      send: (input, principal) =>
        sendMessagingMessage(input, principal, {
          store: store(principal, 'channel.post'),
          bounds: policy.bounds,
          clock: app.clock,
          ids: app.ids,
          limit: async (actorId, channelId) => {
            await consumeOrThrow(
              app.auth().limiter,
              `messaging:send:${actorId}`,
              policy.limits.actorSend,
            );
            await consumeOrThrow(
              app.auth().limiter,
              `messaging:send:${actorId}:${channelId}`,
              policy.limits.channelSend,
            );
          },
        }),
      ...(Object.fromEntries(
        (['history', 'changes', 'markRead'] as const).map((kind) => [
          kind,
          async (
            input: unknown,
            principal: Parameters<typeof sendMessagingMessage>[1],
          ) => {
            if (principal.kind !== 'user' || principal.actorId === null)
              throw createAppError('AUTHORIZATION');
            await consumeOrThrow(
              app.auth().limiter,
              `messaging:read:${principal.actorId}`,
              policy.limits.read,
            );
            return createMessagingReadOperations({
              store: store(principal, 'channel.read'),
              bounds: policy.bounds,
            })[kind](input, principal);
          },
        ]),
      ) as Pick<
        Parameters<typeof createMessagingHandlers>[0],
        'history' | 'changes' | 'markRead'
      >),
    });
    if (operation === 'history' || operation === 'changes')
      return handlers[operation](request, channelId!);
    return handlers[operation](request);
  };
  return {
    send: (request: Request) => run(request, 'send'),
    history: (request: Request, channelId: string) =>
      run(request, 'history', channelId),
    changes: (request: Request, channelId: string) =>
      run(request, 'changes', channelId),
    markRead: (request: Request) => run(request, 'markRead'),
  };
}
