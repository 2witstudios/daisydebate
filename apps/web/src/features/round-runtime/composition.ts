import { captureRule } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from './member-composition';
import type { App } from '../../server/app';
import { canReadTranscript, roundViewReader } from './reads';
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
    view: roundViewReader(app.database),
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
