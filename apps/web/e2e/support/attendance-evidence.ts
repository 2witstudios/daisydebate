import { executeLaunchEvidence } from './launch-evidence-worker';
import { decodeAttendanceEvidence } from './attendance-evidence-decoder';

export async function attendanceEvidence(roundId: string) {
  return decodeAttendanceEvidence(
    await executeLaunchEvidence('attendance-evidence-process.ts', roundId),
    roundId,
  );
}
