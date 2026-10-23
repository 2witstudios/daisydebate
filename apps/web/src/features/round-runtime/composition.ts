import { composeRoundMemberDependencies } from './member-composition';
import type { App } from '../../server/app';
import { canReadRound } from './reads';
import { createRoundHandlers } from './handlers';
import { createRoundRuntimeOperations } from './operations';

export function composeRoundRoutes(app: App) {
  return createRoundHandlers({
    ...composeRoundMemberDependencies(app),
    operations: createRoundRuntimeOperations({
      store: app.database,
      nextSegmentId: () => app.ids.next(),
    }),
    view: (caller, roundId) =>
      app.database.readLaunchedRound(roundId, caller, (round, account) =>
        canReadRound(caller, round, account),
      ),
    utterances: (caller, roundId, segmentId) =>
      app.database.readRoundSegmentUtterances({
        caller,
        roundId,
        segmentId,
        authorize: (round, account) => canReadRound(caller, round, account),
      }),
  });
}
