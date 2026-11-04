import { deriveOutageIntervals, withClockStops } from '@daisy/debate-engine';
import { clockStopsOf } from '@daisy/protocol';
import type { AttendanceEvaluationFacts } from '@daisy/db/attendance';
import { attendanceReceiptTime } from './receipt-time';

/** What a Round's attendance may treat as healthy: the samples, less its own incidents. */
export const availabilityOf = (
  facts: Pick<AttendanceEvaluationFacts, 'samples' | 'round'>,
) =>
  withClockStops(
    deriveOutageIntervals(
      facts.samples.map((sample) => ({
        atMs: attendanceReceiptTime(sample.at),
        healthy: sample.healthy,
      })),
    ),
    clockStopsOf(facts.round.checkpoint),
  );
