import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { decideRoundFloor } from '@daisy/auth/round-floor';
import { roundFloorMetadataOf } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createRoundFloorSchemas,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import type { App } from '../../../server/app';
import { memberHttpBoundary } from '../../../server/member-boundary';
import { requireMemberActor } from '../../access/actor';
import { createContextChatHandlers } from '../context-chat/handlers';
import {
  contextChatOperations,
  type ContextChatStore,
} from '../context-chat/operations';
import { roundFloorContext } from './floor-context';

/** HTTP, embedded forms and retained history all use the same fenced Round authority. */
export function composeRoundFloorRoutes(app: App) {
  const policy = app.messagingPolicy;
  const store = (
    principal: AuthorizationPrincipal,
    roundId: string,
  ): ContextChatStore<RoundFloorFact> => {
    const caller = requireMemberActor(principal);
    const floor = app.database.roundFloorStore(
      async ({ scope, fact, account, action }) => {
        const bound =
          scope.userId === caller.userId && scope.actorId === caller.actorId;
        const decision = decideRoundFloor({
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
      discover: (scope) => floor.discover({ roundId, ...scope }),
      open: (scope) => floor.open({ roundId, ...scope }),
      readChannel: (scope, work) =>
        floor.readFloor({ roundId, ...scope }, work),
      withChannel: (scope, work) =>
        floor.withFloor({ roundId, ...scope }, work),
    };
  };
  return createContextChatHandlers({
    ...memberHttpBoundary(app),
    operationName: (kind) => `messaging.floor.${kind}`,
    open: createRoundFloorSchemas(policy.bounds).open,
    ownerOf: (open) => open.roundId,
    maxBodyBytes: policy.maxBodyBytes,
    bounds: policy.bounds,
    websocketEndpoint: app.websocketEndpoint,
    operations: contextChatOperations(app, {
      ownerKey: roundFloorContext.ownerKey,
      store,
      metadataOf: roundFloorMetadataOf,
    }),
  });
}
