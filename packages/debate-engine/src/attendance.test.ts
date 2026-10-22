import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { adjudicateAttendance, requireAttendanceWindow } from './attendance';
setupRitewayBun();
const window = {
  segmentId: 'actual-speech',
  openedAtMs: 10000,
  speakerId: 'a0',
  speakerSide: 'affirmative' as const,
  eligibleSeats: [
    { id: 'a0', side: 'affirmative' as const },
    { id: 'a1', side: 'affirmative' as const },
    { id: 'n0', side: 'negative' as const },
    { id: 'n1', side: 'negative' as const },
  ],
  lastSpeech: false,
};
const availability = {
  historyStartsAtMs: 0,
  settledHorizonMs: 60000,
  intervals: [],
};
const control = { nowMs: 60000, unknownSeats: [] };
const decide = (ids: readonly string[], lastSpeech = false) =>
  adjudicateAttendance({
    window: { ...window, lastSpeech },
    availability,
    control,
    checkIns: ids.map((participantId) => ({
      participantId,
      receivedAtMs: 50000,
    })),
    finalized: false,
  });

test('actual required speaker and all opposing seats determine absence', () => {
  assert({
    given: 'speaker absent, second opposing seat on time',
    should: 'forfeit the actual speaker side',
    actual: decide(['n1']),
    expected: {
      decision: 'forfeit',
      winner: 'negative',
      effectiveDeadlineMs: 50000,
    },
  });
  assert({
    given: 'all eligible debaters absent',
    should: 'abandon without a winner',
    actual: decide([]),
    expected: { decision: 'abandoned', effectiveDeadlineMs: 50000 },
  });
  assert({
    given: 'only speaker teammate present',
    should: 'resolve without abandonment or forfeit',
    actual: decide(['a1']),
    expected: { decision: 'none', effectiveDeadlineMs: 50000 },
  });
  assert({
    given: 'speaker present, opponents absent',
    should: 'record attendance without punishing opponents',
    actual: decide(['a0']),
    expected: { decision: 'attended', effectiveDeadlineMs: 50000 },
  });
  assert({
    given: 'last speech with nobody present',
    should: 'exclude the last speech from all adjudication',
    actual: decide([], true),
    expected: null,
  });
});

test('timestamp decides including equality and duplicate arrivals', () => {
  const base = { window, availability, control, finalized: false };
  const checkIns = [
    { participantId: 'a0', receivedAtMs: 50001 },
    { participantId: 'n0', receivedAtMs: 50000 },
    { participantId: 'a0', receivedAtMs: 49999 },
  ];
  assert({
    given: 'same stamps in reverse arrival order',
    should: 'use on-time first receipts independent of arrival',
    actual: [
      adjudicateAttendance({ ...base, checkIns }),
      adjudicateAttendance({ ...base, checkIns: [...checkIns].reverse() }),
    ],
    expected: [
      { decision: 'attended', effectiveDeadlineMs: 50000 },
      { decision: 'attended', effectiveDeadlineMs: 50000 },
    ],
  });
});

test('horizon and open outage prevent adjudication', () => {
  for (const evidence of [
    { ...availability, settledHorizonMs: 54999 },
    { ...availability, intervals: [{ startMs: 20000, endMs: null }] },
  ])
    assert({
      given: 'unsettled evidence or open relevant outage',
      should: 'postpone without a decision',
      actual: adjudicateAttendance({
        window,
        availability: evidence,
        control,
        checkIns: [],
        finalized: false,
      }),
      expected: null,
    });
});

test('receipt window permits open historical speech but refuses early late and finalized stamps', async () => {
  const input = {
    window,
    availability,
    receivedAtMs: 50000,
    finalized: false,
    terminal: false,
  };
  assert({
    given: 'old actual speech still open for attendance',
    should: 'accept its exact deadline',
    actual: requireAttendanceWindow(input),
    expected: undefined,
  });
  for (const delta of [
    { receivedAtMs: 4999 },
    { receivedAtMs: 50001 },
    { finalized: true },
    { terminal: true },
  ])
    await assertRejects({
      given: JSON.stringify(delta),
      should: 'refuse without changing attendance',
      actual: () => requireAttendanceWindow({ ...input, ...delta }),
      code: 'INVARIANT',
      invariantId: 'debate.check-in.window-open',
    });
  assert({
    given: 'outage makes deadline undetermined after later speeches',
    should: 'accept a delayed receipt',
    actual: requireAttendanceWindow({
      ...input,
      receivedAtMs: 90000,
      availability: {
        ...availability,
        intervals: [{ startMs: 20000, endMs: null }],
      },
    }),
    expected: undefined,
  });
});

test('finalized decisions cannot be recomputed', async () => {
  await assertRejects({
    given: 'an already resolved actual speech',
    should: 'refuse recomputation',
    actual: () =>
      adjudicateAttendance({
        window,
        availability,
        control,
        checkIns: [],
        finalized: true,
      }),
    code: 'INVARIANT',
    invariantId: 'debate.adjudication.finalized-irreversible',
  });
});

test('ineligible scheduled speaker never creates a competitive attendance loss', () => {
  for (const eligibleSeats of [
    [],
    window.eligibleSeats.filter((seat) => seat.id !== 'a0'),
  ])
    assert({
      given: 'actual scheduled speaker lost canonical eligibility',
      should: 'resolve none before forfeit or vacuous abandonment',
      actual: adjudicateAttendance({
        window: { ...window, eligibleSeats },
        availability,
        control,
        checkIns: [],
        finalized: false,
      }),
      expected: { decision: 'none', effectiveDeadlineMs: 50000 },
    });
});

test('lost bot control postpones only a decision its receipt could change, then abandons', () => {
  const lost = (participantId: string, unknownSinceMs: number) => ({
    nowMs: 60000,
    unknownSeats: [{ participantId, unknownSinceMs }],
  });
  const decideWith = (
    ids: readonly string[],
    evidence: ReturnType<typeof lost>,
  ) =>
    adjudicateAttendance({
      window,
      availability,
      control: evidence,
      checkIns: ids.map((participantId) => ({
        participantId,
        receivedAtMs: 50000,
      })),
      finalized: false,
    });
  assert({
    given:
      'absent speaker seat whose worker control is unknown for less than the bound',
    should: 'postpone instead of forfeiting the uncontrolled seat',
    actual: decideWith(['n0'], lost('a0', 30001)),
    expected: null,
  });
  assert({
    given:
      'absent speaker seat whose worker control is unknown for exactly the bound',
    should: 'abandon without a winner instead of forfeiting',
    actual: decideWith(['n0'], lost('a0', 30000)),
    expected: { decision: 'abandoned', effectiveDeadlineMs: 50000 },
  });
  assert({
    given:
      'absent opponent seat with unknown control that could make a forfeit',
    should: 'postpone the absent human speaker decision within the bound',
    actual: decideWith([], lost('n0', 59999)),
    expected: null,
  });
  assert({
    given: 'uncontrolled seat that already holds an on-time receipt',
    should: 'decide from the durable receipt',
    actual: decideWith(['a0'], lost('a0', 59999)),
    expected: { decision: 'attended', effectiveDeadlineMs: 50000 },
  });
  assert({
    given: 'present speaker and an uncontrolled absent opponent',
    should: 'record attendance because the opponent receipt cannot change it',
    actual: decideWith(['a0'], lost('n0', 59999)),
    expected: { decision: 'attended', effectiveDeadlineMs: 50000 },
  });
  assert({
    given: 'unknown control on a seat outside the current eligible debaters',
    should: 'ignore it',
    actual: decideWith(['n0'], lost('judge', 59999)),
    expected: {
      decision: 'forfeit',
      winner: 'negative',
      effectiveDeadlineMs: 50000,
    },
  });
});
