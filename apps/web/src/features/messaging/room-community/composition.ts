import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { decideRoomCommunity } from '@daisy/auth/room-community';
import { roomCommunityMetadataOf } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createRoomCommunitySchemas,
  type RoomCommunityFact,
} from '@daisy/protocol/room-community';
import type { App } from '../../../server/app';
import { memberHttpBoundary } from '../../../server/member-boundary';
import { requireMemberActor } from '../../access/actor';
import { createContextChatHandlers } from '../context-chat/handlers';
import {
  contextChatOperations,
  type ContextChatStore,
} from '../context-chat/operations';
import { roomChatContext } from './room-chat-context';

/**
 * Room chat (ADR 0126): HTTP and the Room page's forms use the same fenced Room
 * authority. A refused read is answered as not found, so a private Room's chat
 * is never confirmed to someone who may not read the Room.
 */
export function composeRoomCommunityRoutes(app: App) {
  const policy = app.messagingPolicy;
  const store = (
    principal: AuthorizationPrincipal,
    roomId: string,
  ): ContextChatStore<RoomCommunityFact> => {
    const caller = requireMemberActor(principal);
    const chat = app.database.roomCommunityStore(
      async ({ scope, fact, account, action }) => {
        const bound =
          scope.userId === caller.userId && scope.actorId === caller.actorId;
        const decision = decideRoomCommunity({
          principal: caller,
          fact,
          account,
          action,
          now: app.clock.now(),
        });
        if (!bound || !decision.allow)
          throw createAppError(
            action === 'post' ? 'AUTHORIZATION' : 'NOT_FOUND',
          );
      },
    );
    return {
      discover: (scope) => chat.discover({ roomId, ...scope }),
      open: (scope) => chat.open({ roomId, ...scope }),
      readChannel: (scope, work) => chat.readChat({ roomId, ...scope }, work),
      withChannel: (scope, work) => chat.withChat({ roomId, ...scope }, work),
    };
  };
  return createContextChatHandlers({
    ...memberHttpBoundary(app),
    operationName: (kind) => `messaging.roomChat.${kind}`,
    open: createRoomCommunitySchemas(policy.bounds).open,
    ownerOf: (open) => open.roomId,
    maxBodyBytes: policy.maxBodyBytes,
    bounds: policy.bounds,
    websocketEndpoint: app.websocketEndpoint,
    operations: contextChatOperations(app, {
      ownerKey: roomChatContext.ownerKey,
      store,
      metadataOf: roomCommunityMetadataOf,
    }),
  });
}
