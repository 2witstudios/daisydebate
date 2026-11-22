import type {
  AttendanceEvaluationAdmission,
  AttendanceReceiptFacts,
} from '@daisy/db/attendance';

/** A platform hold precedes pending receipts, evidence and every absence decision. */
export function attendanceEvaluationAdmission(
  round: AttendanceReceiptFacts['round'],
): AttendanceEvaluationAdmission {
  return round.checkpoint.incident.phase === 'none'
    ? { kind: 'evaluate' }
    : { kind: 'held', reason: 'platform_incident' };
}
