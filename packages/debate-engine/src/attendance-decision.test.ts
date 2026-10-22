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
  segmentType: 'speech' as const,
  checkIns: [{ participantId: 'a', receivedAtMs: 40000 }],
};
const forfeit = {
  decision: 'forfeit' as const,
  winner: 'negative' as const,
  effectiveDeadlineMs: 40000,
};
test('attendance application guards reject unsettled timestamps finalized windows and excluded segments', async () => {
  for (const [facts, id] of [
    [
      {
        ...input,
        availability: { ...input.availability, settledHorizonMs: 44999 },
      },
      'debate.adjudication.failure-postpones-only',
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
