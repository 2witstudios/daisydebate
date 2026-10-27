import { consumeMessagingRead } from './handler-boundary';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import { messagingRetainedSchemas } from '@daisy/protocol';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { requireMessagingAuthorization } from './authorization';
import { messagingHttpBoundary, runMessagingHandler } from './handler-boundary';
import { requireMessagingActor } from './principal';

type Scope = { readonly actorId: string; readonly userId: string };

/** The decision over the survivor's own retained rows, on their locked account. */
const retainedFence =
  (
    principal: AuthorizationPrincipal,
    capability: 'channel.retained.read' | 'channel.retained.delete',
  ): OwnCollectionFence<Scope> =>
  async ({ scope, account }) =>
    requireMessagingAuthorization({
      principal,
      capability,
      resource: { kind: 'messaging_collection', actorId: scope.actorId },
      context: { account },
    });

/**
 * DEC-126 (ADR 0085): a survivor's view of DMs whose other member was
 * erased, over HTTP only: their own messages and a way to delete them.
 * Anyone else, and any other channel, is refused as absent.
 */
export function composeRetainedConversationRoutes(app: App) {
  const policy = app.messagingPolicy;
  const scopeOf = (principal: AuthorizationPrincipal) => {
    const { actorId, userId } = requireMessagingActor(principal);
    return { actorId, userId };
  };
  const limit = (actorId: string) => consumeMessagingRead(app, actorId);
  const boundary = messagingHttpBoundary(app);
  return {
    list: (request: Request) =>
      runMessagingHandler(boundary, request, {
        name: 'messaging.retained.list',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const scope = scopeOf(principal);
          await limit(scope.actorId);
          return messagingRetainedSchemas.list.parse({
            version: 1,
            conversations: await app.database.listRetainedConversations(
              scope,
              retainedFence(principal, 'channel.retained.read'),
            ),
          });
        },
      }),
    read: (request: Request, channelId: string) =>
      runMessagingHandler(boundary, request, {
        name: 'messaging.retained.read',
        readOnly: true,
        readInput: async () => channelId,
        operation: async (_input, principal) => {
          const scope = scopeOf(principal);
          await limit(scope.actorId);
          return messagingRetainedSchemas.conversation.parse({
            version: 1,
            channelId,
            messages: await app.database.readRetainedConversation(
              { ...scope, channelId },
              retainedFence(principal, 'channel.retained.read'),
            ),
          });
        },
      }),
    remove: (request: Request) =>
      runMessagingHandler(boundary, request, {
        name: 'messaging.retained.delete',
        readOnly: false,
        readInput: () => readJson(request, policy.maxBodyBytes),
        operation: async (input, principal) => {
          const command = parseValidated(
            messagingRetainedSchemas.remove,
            input,
          );
          const scope = scopeOf(principal);
          await limit(scope.actorId);
          await app.database.deleteRetainedConversation(
            { ...scope, channelId: command.channelId },
            retainedFence(principal, 'channel.retained.delete'),
          );
          return { version: 1, channelId: command.channelId };
        },
      }),
  };
}
