import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { requireAttendanceDecision } from './attendance-decision';
setupRitewayBun();
const input = {
  window: {
    segmentId: 'actual',
    openedAtMs: 0,
    speakerId: 'a',
    speakerSide: 'affirmative' as const,
    eligibleSeats: [
      { id: 'a', side: 'affirmative' as const },
      { id: 'n', side: 'negative' as const },
    ],
    lastSpeech: false,
  },
  availability: {
    historyStartsAtMs: 0,
    settledHorizonMs: 45000,
    intervals: [],
  },
  finalized: false,
  cutoffAtMs: null,
  nowMs: 0,
  segmentType: 'speech' as const,
  checkIns: [{ participantId: 'a', receivedAtMs: 40000 }],
  botSeatIds: [] as readonly string[],
};
const forfeit = {
  evidence: 'settled_availability' as const,
  decision: 'forfeit' as const,
  winner: 'negative' as const,
  effectiveDeadlineMs: 40000,
};
test('attendance application guards reject unsettled timestamps finalized windows and excluded segments', async () => {
  for (const [facts, id] of [
    [
      {
        ...input,
        checkIns: [],
        availability: { ...input.availability, settledHorizonMs: 44999 },
      },
      'debate.adjudication.failure-postpones-only',
    ],
    [
      {
        ...input,
        checkIns: [{ participantId: 'n', receivedAtMs: 40000 }],
        botSeatIds: ['a'],
      },
      'debate.adjudication.timestamp-decides',
    ],
    [
      { ...input, finalized: true },
      'debate.adjudication.finalized-irreversible',
    ],
    [
      { ...input, window: { ...input.window, lastSpeech: true } },
      'debate.adjudication.last-speech-never-forfeits',
    ],
    [
      { ...input, segmentType: 'cross_ex' as const },
      'debate.adjudication.speech-turns-only',
    ],
    [input, 'debate.adjudication.timestamp-decides'],
  ] as const)
    await assertRejects({
      given: id,
      should: 'refuse invalid competitive attendance application',
      actual: () => requireAttendanceDecision(facts, forfeit),
      code: 'INVARIANT',
      invariantId: id,
    });
});

test('an on-time receipt decision needs the exact receipt and no settled history', async () => {
  const facts = {
    ...input,
    availability: {
      historyStartsAtMs: null,
      settledHorizonMs: null,
      intervals: [],
    },
  };
  const credited = {
    evidence: 'on_time_receipt' as const,
    decision: 'attended' as const,
    participantId: 'a',
    receivedAtMs: 40000,
  };
  requireAttendanceDecision(facts, credited);
  await assertRejects({
    given: 'a decision naming a different receipt time',
    should: 'refuse it',
    actual: async () =>
      requireAttendanceDecision(facts, { ...credited, receivedAtMs: 39999 }),
    code: 'INVARIANT',
    invariantId: 'debate.adjudication.timestamp-decides',
  });
});
