import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  adjudicateAttendance,
  attendancePolicy,
  requireAttendanceWindow,
} from './attendance';
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
const botSeatIds: readonly string[] = [];
const decide = (ids: readonly string[], lastSpeech = false) =>
  adjudicateAttendance({
    window: { ...window, lastSpeech },
    availability,
    botSeatIds,
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
      evidence: 'settled_availability',
    },
  });
  assert({
    given: 'all eligible debaters absent',
    should: 'abandon without a winner',
    actual: decide([]),
    expected: {
      evidence: 'settled_availability',
      decision: 'abandoned',
      effectiveDeadlineMs: 50000,
    },
  });
  assert({
    given: 'only speaker teammate present',
    should: 'resolve without abandonment or forfeit',
    actual: decide(['a1']),
    expected: {
      evidence: 'settled_availability',
      decision: 'none',
      effectiveDeadlineMs: 50000,
    },
  });
  assert({
    given: 'speaker present, opponents absent',
    should: 'record attendance without punishing opponents',
    actual: decide(['a0']),
    expected: {
      decision: 'attended',
      evidence: 'on_time_receipt',
      participantId: 'a0',
      receivedAtMs: 50000,
    },
  });
  assert({
    given: 'last speech with nobody present',
    should: 'exclude the last speech from all adjudication',
    actual: decide([], true),
    expected: null,
  });
});

test('timestamp decides including equality and duplicate arrivals', () => {
  const base = { window, availability, botSeatIds, finalized: false };
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
      {
        decision: 'attended',
        evidence: 'on_time_receipt',
        participantId: 'a0',
        receivedAtMs: 49999,
      },
      {
        decision: 'attended',
        evidence: 'on_time_receipt',
        participantId: 'a0',
        receivedAtMs: 49999,
      },
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
        botSeatIds,
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
        botSeatIds,
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
        botSeatIds,
        checkIns: [],
        finalized: false,
      }),
      expected: {
        evidence: 'settled_availability',
        decision: 'none',
        effectiveDeadlineMs: 50000,
      },
    });
});

test('bot worker loss never produces a forfeit: decisions a missing bot receipt would change abandon', () => {
  const decideWith = (ids: readonly string[], bots: readonly string[]) =>
    adjudicateAttendance({
      window,
      availability,
      botSeatIds: bots,
      checkIns: ids.map((participantId) => ({
        participantId,
        receivedAtMs: 50000,
      })),
      finalized: false,
    });
  assert({
    given:
      'an absent bot speaker and a present human opponent, whatever its worker lease says now',
    should: 'abandon without a winner instead of forfeiting the bot',
    actual: decideWith(['n0'], ['a0']),
    expected: {
      evidence: 'settled_availability',
      decision: 'abandoned',
      effectiveDeadlineMs: 50000,
    },
  });
  assert({
    given: 'an absent human speaker whose only present-able opponent is a bot',
    should:
      'abandon rather than let the bot infrastructure decide a forfeit either way',
    actual: decideWith([], ['n0']),
    expected: {
      evidence: 'settled_availability',
      decision: 'abandoned',
      effectiveDeadlineMs: 50000,
    },
  });
  assert({
    given: 'a bot speaker with an on-time receipt',
    should: 'record attendance from the durable receipt',
    actual: decideWith(['a0'], ['a0']),
    expected: {
      decision: 'attended',
      evidence: 'on_time_receipt',
      participantId: 'a0',
      receivedAtMs: 50000,
    },
  });
  assert({
    given: 'a present human speaker and an absent bot opponent',
    should: 'record attendance because the bot receipt cannot change it',
    actual: decideWith(['a0'], ['n0', 'n1']),
    expected: {
      decision: 'attended',
      evidence: 'on_time_receipt',
      participantId: 'a0',
      receivedAtMs: 50000,
    },
  });
  assert({
    given: 'a present bot opponent and an absent human speaker',
    should: 'forfeit the human by the ordinary rule (DEC-200)',
    actual: decideWith(['n0'], ['n0']),
    expected: {
      decision: 'forfeit',
      winner: 'negative',
      effectiveDeadlineMs: 50000,
      evidence: 'settled_availability',
    },
  });
  assert({
    given: 'a bot id outside the current eligible debaters',
    should: 'ignore it and forfeit the absent human speaker',
    actual: decideWith(['n0'], ['judge']),
    expected: {
      decision: 'forfeit',
      winner: 'negative',
      effectiveDeadlineMs: 50000,
      evidence: 'settled_availability',
    },
  });
});

{
  const unknownHealth = {
    historyStartsAtMs: null,
    settledHorizonMs: null,
    intervals: [],
  };
  const openOutage = {
    historyStartsAtMs: 0,
    settledHorizonMs: 900000,
    intervals: [{ startMs: 1, endMs: null }],
  };
  const decideOn = (
    checkIns: readonly { participantId: string; receivedAtMs: number }[],
    evidence: typeof unknownHealth | typeof openOutage = unknownHealth,
  ) =>
    adjudicateAttendance({
      window,
      availability: evidence,
      botSeatIds,
      checkIns,
      finalized: false,
    });
  const onTime = window.openedAtMs + attendancePolicy.graceMs;
  const credited = (receivedAtMs: number) =>
    ({
      decision: 'attended',
      evidence: 'on_time_receipt',
      participantId: 'a0',
      receivedAtMs,
    }) as const;
  test('an on-time speaker receipt proves attendance with no health history', () => {
    for (const [given, evidence] of [
      ['no availability history at all', unknownHealth],
      ['a permanently open outage', openOutage],
    ] as const)
      assert({
        given,
        should: 'credit the speaker from the receipt alone',
        actual: decideOn(
          [{ participantId: 'a0', receivedAtMs: window.openedAtMs }],
          evidence,
        ),
        expected: credited(window.openedAtMs),
      });
    assert({
      given: 'a receipt exactly at the end of the base window',
      should: 'still credit it',
      actual: decideOn([{ participantId: 'a0', receivedAtMs: onTime }]),
      expected: credited(onTime),
    });
    const earliest = window.openedAtMs - attendancePolicy.leadMs;
    assert({
      given: 'a receipt exactly at the start of the lead',
      should: 'still credit it',
      actual: decideOn([{ participantId: 'a0', receivedAtMs: earliest }]),
      expected: credited(earliest),
    });
  });
  test('nothing else takes the positive path', () => {
    const postponed: [
      string,
      { participantId: string; receivedAtMs: number }[],
    ][] = [
      ['no receipts', []],
      [
        'the opponent on time and no speaker',
        [{ participantId: 'n0', receivedAtMs: window.openedAtMs }],
      ],
      [
        'the teammate on time and no speaker',
        [{ participantId: 'a1', receivedAtMs: window.openedAtMs }],
      ],
      [
        'a late speaker (DEC-278)',
        [{ participantId: 'a0', receivedAtMs: onTime + 1 }],
      ],
      [
        'a speaker before the lead',
        [
          {
            participantId: 'a0',
            receivedAtMs: window.openedAtMs - attendancePolicy.leadMs - 1,
          },
        ],
      ],
    ];
    for (const [given, checkIns] of postponed)
      assert({
        given: `${given}, with unknown health`,
        should: 'postpone: unknown health forfeits nobody',
        actual: decideOn(checkIns),
        expected: null,
      });
    assert({
      given: 'an ineligible speaker whose receipt is on time',
      should: 'not credit a seat that cannot attend',
      actual: adjudicateAttendance({
        window: {
          ...window,
          eligibleSeats: window.eligibleSeats.filter((s) => s.id !== 'a0'),
        },
        availability: unknownHealth,
        botSeatIds,
        checkIns: [{ participantId: 'a0', receivedAtMs: window.openedAtMs }],
        finalized: false,
      }),
      expected: null,
    });
    assert({
      given: 'the last speech with an on-time receipt',
      should: 'stay exempt',
      actual: adjudicateAttendance({
        window: { ...window, lastSpeech: true },
        availability: unknownHealth,
        botSeatIds,
        checkIns: [{ participantId: 'a0', receivedAtMs: window.openedAtMs }],
        finalized: false,
      }),
      expected: null,
    });
  });
}
