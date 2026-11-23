import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { attendanceEntrypoints } from '../attendance-entrypoints';
import type { RoundTimeSource } from '../round-execution-time';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Attendance check-in, discovery and evaluation, on the competitive lane's bounded transaction. */
export const createAttendanceStore = (
  resources: DatabaseResources,
  options: {
    readonly nextId: () => string;
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
    readonly roundTime?: RoundTimeSource | undefined;
  },
) =>
  namedLaneOperations(
    attendanceEntrypoints({
      decisionRelease: options.decisionRelease,
      roundTime: options.roundTime,
      run: resourcesOf(resources).bounded('competitive'),
      nextId: options.nextId,
    }),
  );
export type AttendanceStore = ReturnType<typeof createAttendanceStore>;
