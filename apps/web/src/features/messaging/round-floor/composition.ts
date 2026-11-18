import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { decideRoundFloor } from '@daisy/auth/round-floor';
import { roundFloorMetadataOf } from '@daisy/db/messaging';
import {
  createRoundFloorSchemas,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import type { App } from '../../../server/app';
import { memberHttpBoundary } from '../../../server/member-boundary';
import { requireMemberActor } from '../../access/actor';
import { contextChatFence } from '../context-chat/authority';
import { createContextChatHandlers } from '../context-chat/handlers';
import {
  contextChatOperations,
  type ContextChatStore,
} from '../context-chat/operations';
import { roundFloorContext } from './floor-context';
import { liveLinkedAdults } from '../../spectating/linked-adults';

/** HTTP, embedded forms and retained history all use the same fenced Round authority. */
export function composeRoundFloorRoutes(app: App) {
  const policy = app.messagingPolicy;
  const linkedAdults = liveLinkedAdults(app);
  const store = (
    principal: AuthorizationPrincipal,
    roundId: string,
  ): ContextChatStore<RoundFloorFact> => {
    const caller = requireMemberActor(principal);
    // A Youth Round's linked adults read its floor and never post (ADR 0155).
    const floorOf = async () =>
      app.database.roundFloorStore(
        contextChatFence(
          caller,
          ({ fact, account, action }) =>
            decideRoundFloor({
              principal: caller,
              fact,
              account,
              action,
              now: app.clock.now(),
            }).allow,
        ),
        await linkedAdults(roundId),
      );
    return {
      discover: async (scope) =>
        (await floorOf()).discover({ roundId, ...scope }),
      open: async (scope) => (await floorOf()).open({ roundId, ...scope }),
      readChannel: async (scope, work) =>
        (await floorOf()).readFloor({ roundId, ...scope }, work),
      withChannel: async (scope, work) =>
        (await floorOf()).withFloor({ roundId, ...scope }, work),
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
