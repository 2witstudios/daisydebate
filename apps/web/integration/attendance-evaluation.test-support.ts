import type { AttendanceEvaluation } from '@daisy/db/attendance';

/** The decision a pass reached, 'held' while a writer holds it, undefined while undecided. */
export const decisionOf = (found: AttendanceEvaluation | undefined) =>
  found?.kind === 'decided'
    ? found.resolution.decision
    : found?.kind === 'held'
      ? 'held'
      : undefined;
