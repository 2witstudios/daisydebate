import { defineComposition } from '../../server/composition';
import { eventBallotAccess } from '../round-ballots/audience';
import { captureRule } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from './member-composition';
import type { App } from '../../server/app';
import {
  liveLinkedAdults,
  withLinkedAdults,
} from '../spectating/linked-adults';
import { canReadTranscript, roundViewReader } from './reads';
import { createRoundHandlers } from './handlers';
import { createRoundRuntimeOperations } from './operations';

function composeRoundRoutes(app: App) {
  return createRoundHandlers({
    ...composeRoundMemberDependencies(app),
    operations: createRoundRuntimeOperations({
      store: app.database,
      nextSegmentId: () => app.ids.next(),
    }),
    clock: app.clock,
    websocketEndpoint: app.websocketEndpoint,
    view: roundViewReader(app.database, liveLinkedAdults(app)),
    transcript: (caller, roundId) =>
      withLinkedAdults(
        caller,
        roundId,
        liveLinkedAdults(app),
        (youth, refused) =>
          app.database.readRoundTranscript({
            readEventDecision: (owner) =>
              eventBallotAccess(caller, owner).parts.includes('decision'),
            caller,
            roundId,
            captureRule,
            authorize: (round, account, authority) => {
              const allowed = canReadTranscript(
                caller,
                round,
                account,
                authority,
                youth,
              );
              if (!allowed) refused();
              return allowed;
            },
          }),
      ),
  });
}

/** rounds: its route files bind here (`processRoute`). */
export const roundComposition = defineComposition('rounds', (app) =>
  composeRoundRoutes(app),
);
