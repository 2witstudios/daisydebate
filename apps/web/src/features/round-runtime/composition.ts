import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import { canReadRound } from './reads';
import { createRoundHandlers } from './handlers';
import { createRoundRuntimeOperations } from './operations';

export function composeRoundRoutes(app: App) {
  return createRoundHandlers({
    logger: app.logger,
    identify: (request) => identify(app.auth(), request.headers),
    origin: () => app.auth().config.PUBLIC_APP_URL,
    getActorByUserId: (id) => app.database.getActorByUserId(id),
    limiter: () => app.auth().limiter,
    limits: app.roomPolicy?.limits ?? {
      read: { max: 1, windowSeconds: 1 },
      command: { max: 1, windowSeconds: 1 },
    },
    maxBodyBytes: app.roomPolicy?.maxBodyBytes ?? 0,
    active: () => Boolean(app.roomPolicy),
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
