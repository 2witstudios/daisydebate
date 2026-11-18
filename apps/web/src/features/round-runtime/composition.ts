import { eventBallotAccess } from '../round-ballots/audience';
import { captureRule } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from './member-composition';
import type { App } from '../../server/app';
import { liveLinkedAdults } from '../spectating/linked-adults';
import { canReadTranscript, roundViewReader, withLinkedAdults } from './reads';
import { createRoundHandlers } from './handlers';
import { createRoundRuntimeOperations } from './operations';

export function composeRoundRoutes(app: App) {
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
      withLinkedAdults(caller, roundId, liveLinkedAdults(app), (youth) =>
        app.database.readRoundTranscript({
          readEventDecision: (owner) =>
            eventBallotAccess(caller, owner).parts.includes('decision'),
          caller,
          roundId,
          captureRule,
          authorize: (round, account, authority) =>
            canReadTranscript(caller, round, account, authority, youth),
        }),
      ),
  });
}
