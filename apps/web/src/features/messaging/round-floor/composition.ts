import { defineComposition } from '../../../server/composition';
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
import type { YouthLiveFact } from '@daisy/auth/live-audience';
import {
  liveLinkedAdults,
  withLinkedAdults,
} from '../../spectating/linked-adults';

/** HTTP, embedded forms and retained history all use the same fenced Round authority. */
function composeRoundFloorRoutes(app: App) {
  const policy = app.messagingPolicy;
  const linkedAdults = liveLinkedAdults(app);
  const store = (
    principal: AuthorizationPrincipal,
    roundId: string,
  ): ContextChatStore<RoundFloorFact> => {
    const caller = requireMemberActor(principal);
    const floorWith = (youth: YouthLiveFact | null, refused: () => void) =>
      app.database.roundFloorStore(
        contextChatFence(caller, ({ fact, account, action }) => {
          const { allow } = decideRoundFloor({
            principal: caller,
            fact,
            account,
            action,
            now: app.clock.now(),
          });
          if (!allow) refused();
          return allow;
        }),
        youth,
      );
    // A Youth Round's linked adults read its floor and never post (ADR 0155).
    // Their links are read only once the floor refuses, so a seated debater's
    // chat never waits on them.
    const floor = <T>(
      work: (store: ReturnType<typeof floorWith>) => Promise<T>,
    ) =>
      withLinkedAdults(caller, roundId, linkedAdults, (youth, refused) =>
        work(floorWith(youth, refused)),
      );
    return {
      discover: (scope) => floor((it) => it.discover({ roundId, ...scope })),
      open: (scope) => floor((it) => it.open({ roundId, ...scope })),
      readChannel: (scope, work) =>
        floor((it) => it.readFloor({ roundId, ...scope }, work)),
      withChannel: (scope, work) =>
        floor((it) => it.withFloor({ roundId, ...scope }, work)),
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

/** round-floor: its route files bind here (`processRoute`). */
export const roundFloorComposition = defineComposition('round-floor', (app) =>
  composeRoundFloorRoutes(app),
);
