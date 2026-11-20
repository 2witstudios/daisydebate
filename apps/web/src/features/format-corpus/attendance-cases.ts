import {
  adjudicateAttendance,
  attendancePolicy,
  requireAttendanceDecision,
} from '@daisy/debate-engine';
import {
  isJudgeSeat,
  sideOfSeat,
  sideSeat,
  type RoundRules,
} from '@daisy/protocol';
import { attempt } from './refusal';
import {
  corpusStartMs,
  seatAt,
  seatsOf,
  type CorpusSeat,
} from './corpus-seats';
import { oneOnOne } from './one-on-one';

const at = (ms: number) => corpusStartMs + ms;
type DecisionEvidence = Parameters<typeof requireAttendanceDecision>[0];

/** The first speech's attendance window, opened when its clock started. */
const firstSpeechWindow = (
  seats: readonly CorpusSeat[],
  openedAtMs: number,
) => ({
  segmentId: 'segment-1',
  openedAtMs,
  speakerId: seatAt(seats, sideSeat('affirmative')).id,
  speakerSide: 'affirmative' as const,
  forfeitsTo: 'negative' as const,
  eligibleSeats: seats
    .filter((s) => !isJudgeSeat(s.seat))
    .map((s) => ({ id: s.id, side: sideOfSeat(s.seat) })),
  lastSpeech: false,
});

/** The settled evidence for the first speech, with the seats in `present` checked in. */
export const firstSpeechEvidence = (
  rules: RoundRules,
  seats: readonly CorpusSeat[],
  present: readonly ('affirmative' | 'negative')[],
) => {
  const opensMs = corpusStartMs + rules.countdownMs;
  const settledMs =
    opensMs + attendancePolicy.graceMs + attendancePolicy.finalizationBufferMs;
  return {
    window: firstSpeechWindow(seats, opensMs),
    availability: {
      historyStartsAtMs: corpusStartMs,
      settledHorizonMs: settledMs,
      intervals: [],
    },
    botSeatIds: [],
    checkIns: present.map((role) => ({
      participantId: seatAt(seats, sideSeat(role)).id,
      receivedAtMs: opensMs + 1_000,
    })),
    finalized: false,
    cutoffAtMs: null,
    nowMs: settledMs,
  };
};

/** A supplied attendance decision checked against the durable evidence. */
const decisionChecks = () => {
  const rules = oneOnOne();
  const base = firstSpeechEvidence(rules, seatsOf(rules), ['negative']);
  const decision = adjudicateAttendance(base);
  // One seat checked in at the window's open: a case the rules decide.
  if (decision === null)
    throw new Error('A one-sided first speech has no attendance decision');
  const evidence: DecisionEvidence = { ...base, segmentType: 'speech' };
  const check = (
    name: string,
    input: typeof evidence,
    supplied = decision,
  ) => ({
    name,
    result: attempt(() => requireAttendanceDecision(input, supplied)),
  });
  return [
    check('agrees', evidence),
    check('disagrees', evidence, {
      evidence: 'settled_availability',
      decision: 'abandoned',
      effectiveDeadlineMs: at(50_000),
      settledHorizonMs: at(55_000),
    }),
    check('cross-ex', { ...evidence, segmentType: 'cross_ex' }),
    check('last speech', {
      ...evidence,
      window: { ...evidence.window, lastSpeech: true },
    }),
    check('finalized', { ...evidence, finalized: true }),
    check('unsettled', {
      ...evidence,
      availability: { ...evidence.availability, settledHorizonMs: at(10_000) },
    }),
  ];
};

/** Attendance decisions over the first speech for each set of present seats. */
const attendanceDecisions = () => {
  const presences: readonly (readonly ('affirmative' | 'negative')[])[] = [
    [],
    ['affirmative'],
    ['negative'],
    ['affirmative', 'negative'],
  ];
  const rules = oneOnOne();
  const seats = seatsOf(rules);
  return presences.map((present) => {
    const evidence = firstSpeechEvidence(rules, seats, present);
    return { present, evidence, decision: adjudicateAttendance(evidence) };
  });
};

/** The attendance decision cases, by corpus file name. */
export const attendanceCases = (): readonly (readonly [string, unknown])[] => [
  ['attendance-decisions', attendanceDecisions()],
  ['attendance-decision-checks', decisionChecks()],
];
