import {
  attendanceTimingPolicy as policy,
  type AttendanceLedgerFacts,
} from '@daisy/protocol';

type RuleSegment = { readonly key: string; readonly type: string };
type OrderedSegment = {
  readonly id: string;
  readonly type: string;
  readonly rulesSegmentKey: string | null;
};

/** The final speech has no later check-in window, so it never takes an attendance decision. */
export const finalSpeechKey = (
  ruleSegments: readonly RuleSegment[],
): string | undefined =>
  ruleSegments.filter((segment) => segment.type === 'speech').at(-1)?.key;

/**
 * Windows resolve in actual speech order: the earliest unadjudicated speech
 * other than the final one.
 */
export function nextAttendanceSegment<S extends OrderedSegment>(input: {
  readonly ruleSegments: readonly RuleSegment[];
  readonly segments: readonly S[];
  readonly finalizedSegmentIds: readonly string[];
}): S | undefined {
  const finalSpeech = finalSpeechKey(input.ruleSegments);
  return input.segments.find(
    (segment) =>
      segment.type === 'speech' &&
      segment.rulesSegmentKey !== finalSpeech &&
      !input.finalizedSegmentIds.includes(segment.id),
  );
}

const atMs = (at: string | null) => (at === null ? Number.NaN : Date.parse(at));

/** Whether one adjudication still proves its window, on the evidence it names. */
function adjudicationHolds(
  speech: AttendanceLedgerFacts['speeches'][number],
  decided: AttendanceLedgerFacts['adjudications'][number],
  receipts: AttendanceLedgerFacts['receipts'],
  nowMs: number,
): boolean {
  if (decided.decision === 'forfeit' || decided.decision === 'abandoned')
    return false;
  const openedAtMs = Date.parse(speech.startedAt);
  if (decided.evidence === 'settled_availability') {
    const deadline = atMs(decided.effectiveDeadline);
    return (
      deadline >= openedAtMs + policy.graceMs &&
      atMs(decided.settledHorizon) >= deadline + policy.finalizationBufferMs &&
      deadline <= nowMs - policy.finalizationBufferMs
    );
  }
  return (
    decided.evidence === 'on_time_receipt' &&
    receipts.some(
      (receipt) =>
        receipt.segmentId === decided.segmentId &&
        receipt.participantId === decided.receiptParticipantId &&
        Date.parse(receipt.receivedAt) >= openedAtMs - policy.leadMs &&
        Date.parse(receipt.receivedAt) <= openedAtMs + policy.graceMs,
    )
  );
}

/**
 * The one settlement rule for completion, rating and the Round read: no
 * uncertain writer, and every actual speech but the final one holds a decision
 * its own evidence still proves. A forfeit or abandonment ends the Round by
 * another path, so it never settles a Round for completion here.
 */
export function attendanceSettled(
  facts: AttendanceLedgerFacts,
  nowMs: number,
): boolean {
  if (facts.pendingWriter) return false;
  const finalSpeech = finalSpeechKey(facts.ruleSegments);
  return facts.speeches
    .filter((speech) => speech.rulesSegmentKey !== finalSpeech)
    .every((speech) => {
      const decided = facts.adjudications.find(
        (row) => row.segmentId === speech.id,
      );
      return (
        decided !== undefined &&
        adjudicationHolds(speech, decided, facts.receipts, nowMs)
      );
    });
}
