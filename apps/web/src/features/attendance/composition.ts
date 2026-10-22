import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import { createAttendanceHandler } from './handler';
import { createAttendanceFeature } from './operations';

export function composeAttendanceRoutes(app: App) {
  const operations = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId: app.ids.next(),
  });
  return {
    checkIn: createAttendanceHandler({
      logger: app.logger,
      identify: (request) => identify(app.auth(), request.headers),
      origin: () => app.auth().config.PUBLIC_APP_URL,
      getActorByUserId: (id) => app.database.getActorByUserId(id),
      limiter: () => app.auth().limiter,
      active: () => Boolean(app.roomPolicy),
      checkIn: operations.checkIn,
    }),
  };
}
