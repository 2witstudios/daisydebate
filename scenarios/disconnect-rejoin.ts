import {
  adjudicateAttendance,
  deriveOutageIntervals,
  requireAttendanceDecision,
  requireAttendanceWindow,
  type AttendanceWindow,
} from '@daisy/debate-engine';
import {
  foundationScenarioIds,
  type DebateScenario,
  type ScenarioFacts,
} from '../scripts/scenario';

/** Injected receipt/sample facts; actual openings and scheduled seats come from the shared runtime. */
function verifyDisconnectRejoin(facts: ScenarioFacts): void {
  const actual = facts.segments.find((segment) => segment.type === 'speech');
  const rule = facts.rules.segments.find(
    (rule) => rule.key === actual?.rulesSegmentKey,
  );
  if (!actual || rule?.type !== 'speech')
    throw new Error(
      'Disconnect scenario requires actual shared speech opening',
    );
  const speaker = facts.participants.find(
    (seat) => seat.role === rule.side && seat.slot === rule.slot,
  )!;
  const opponent = facts.participants.find(
    (seat) => seat.role !== 'judge' && seat.role !== rule.side,
  )!;
  const opening = Date.parse(actual.startedAt);
  const samples = Array.from({ length: 64 }, (_, index) => ({
    atMs: opening + (index - 1) * 1000,
    healthy: index < 11 || index >= 26,
  }));
  const availability = deriveOutageIntervals(samples);
  const window: AttendanceWindow = {
    segmentId: actual.id,
    openedAtMs: opening,
    speakerId: speaker.id,
    speakerSide: rule.side,
    eligibleSeats: facts.participants
      .filter((seat) => seat.role !== 'judge')
      .map((seat) => ({
        id: seat.id,
        side: seat.role as 'affirmative' | 'negative',
      })),
    lastSpeech:
      actual.rulesSegmentKey ===
      facts.rules.segments.filter((segment) => segment.type === 'speech').at(-1)
        ?.key,
  };
  const opponentStamp = { participantId: opponent.id, receivedAtMs: opening };
  const unsettled = adjudicateAttendance({
    window,
    availability: deriveOutageIntervals(
      samples.filter((sample) => sample.atMs <= opening + 40000),
    ),
    checkIns: [opponentStamp],
    botSeatIds: [],
    finalized: false,
  });
  if (unsettled !== null)
    throw new Error(
      'Unsettled outage must postpone a disconnected speaker decision',
    );
  // Rejoin receipt comes after nominal40s, within actual outage-extended grace.
  const rejoined = { participantId: speaker.id, receivedAtMs: opening + 50000 };
  requireAttendanceWindow({
    window,
    availability,
    receivedAtMs: rejoined.receivedAtMs,
    finalized: false,
    terminal: false,
  });
  const evidence = {
    window,
    availability,
    checkIns: [opponentStamp, rejoined],
    botSeatIds: [],
    finalized: false,
    segmentType: 'speech' as const,
  };
  const decision = adjudicateAttendance(evidence);
  if (
    !decision ||
    decision.decision !== 'attended' ||
    facts.nowMs < decision.effectiveDeadlineMs + 5000
  )
    throw new Error(
      'Timely reconnect must remain attended after settled outage recovery',
    );
  requireAttendanceDecision(evidence, decision);
}

const scenario: DebateScenario = {
  name: 'disconnect-rejoin',
  given: { ids: foundationScenarioIds },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 10000 },
    { type: 'tick', atMs: 72000 },
  ],
  verify: verifyDisconnectRejoin,
  expect: {
    id: foundationScenarioIds[0],
    status: 'active',
    stage: 'live',
    opened: ['AC'],
  },
};
export default scenario;
