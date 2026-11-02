import { attendanceTimingPolicy as policy } from '@daisy/protocol';
import type { AttendanceSettledRule } from '../src/attendance-settlement';

/**
 * The db never imports the engine, so its suites inject this stand-in for
 * @daisy/debate-engine's attendanceSettled, whose own unit tests state the rule.
 * apps/web's completion and rating suites run the real one.
 */
export const attendanceSettled: AttendanceSettledRule = (facts, nowMs) => {
  if (facts.pendingWriter) return false;
  const finalSpeech = facts.ruleSegments
    .filter((segment) => segment.type === 'speech')
    .at(-1)?.key;
  return facts.speeches
    .filter((speech) => speech.rulesSegmentKey !== finalSpeech)
    .every((speech) => {
      const decided = facts.adjudications.find(
        (row) => row.segmentId === speech.id,
      );
      if (!decided || ['forfeit', 'abandoned'].includes(decided.decision))
        return false;
      const opened = Date.parse(speech.startedAt);
      if (decided.evidence === 'settled_availability') {
        const deadline = Date.parse(decided.effectiveDeadline!);
        return (
          deadline >= opened + policy.graceMs &&
          Date.parse(decided.settledHorizon!) >=
            deadline + policy.finalizationBufferMs &&
          deadline <= nowMs - policy.finalizationBufferMs
        );
      }
      return facts.receipts.some(
        (receipt) =>
          receipt.segmentId === speech.id &&
          receipt.participantId === decided.receiptParticipantId &&
          Date.parse(receipt.receivedAt) >= opened - policy.leadMs &&
          Date.parse(receipt.receivedAt) <= opened + policy.graceMs,
      );
    });
};
