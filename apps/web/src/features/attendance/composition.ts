import { defineComposition } from '../../server/composition';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import type { App } from '../../server/app';
import { createAttendanceHandler } from './handler';
import { createAttendanceFeature } from './operations';

function composeAttendanceRoutes(app: App) {
  const operations = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId: app.ids.next(),
  });
  const gates = composeRoundMemberDependencies(app);
  return {
    checkIn: createAttendanceHandler({
      ...gates,
      checkIn: operations.checkIn,
    }),
  };
}

/** attendance: its route files bind here (`processRoute`). */
export const attendanceComposition = defineComposition('attendance', (app) =>
  composeAttendanceRoutes(app),
);
