import { captureRule } from '@daisy/debate-engine';
import { roundWaitingOn } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from './member-composition';
import type { App } from '../../server/app';
import { canObserveUndelayed, canReadRound, canReadTranscript } from './reads';
import { createRoundHandlers } from './handlers';
import { createRoundRuntimeOperations } from './operations';

export function composeRoundRoutes(app: App) {
  return createRoundHandlers({
    ...composeRoundMemberDependencies(app),
    operations: createRoundRuntimeOperations({
      store: app.database,
      nextSegmentId: () => app.ids.next(),
    }),
    view: async (caller, roundId) => {
      let viewerIsUndelayedObserver = false;
      const view = await app.database.readLaunchedRound(
        roundId,
        caller,
        (round, account) => {
          viewerIsUndelayedObserver = canObserveUndelayed(
            caller,
            round,
            account,
          );
          return canReadRound(caller, round, account);
        },
        roundWaitingOn,
      );
      return {
        ...view,
        viewerIsUndelayedObserver,
        conversationHeld:
          await app.database.broadcasts.conversationHeld(roundId),
      };
    },
    transcript: (caller, roundId) =>
      app.database.readRoundTranscript({
        caller,
        roundId,
        captureRule,
        authorize: (round, account) =>
          canReadTranscript(caller, round, account),
      }),
  });
}
