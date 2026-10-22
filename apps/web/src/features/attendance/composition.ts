import type { App } from '../../server/app';
import { createAttendanceHandler } from './handler';
import { createAttendanceFeature } from './operations';

type MemberGates = Pick<
  Parameters<typeof createAttendanceHandler>[0],
  'logger' | 'identify' | 'origin' | 'getActorByUserId' | 'limiter'
>;
export function composeAttendanceRoutes(app: App, gates: MemberGates) {
  const operations = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId: app.ids.next(),
  });
  return {
    checkIn: createAttendanceHandler({
      ...gates,
      active: () => Boolean(app.roomPolicy),
      checkIn: operations.checkIn,
    }),
  };
}
