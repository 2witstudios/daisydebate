import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildDrillReport, drillReportTable, type DrillSample } from './report';

setupRitewayBun();

const coverage = {
  owedMs: 100_000,
  observedMs: 80_000,
  missingMs: 20_000,
  coverage: 0.8,
  missingOutsideOutageMs: 0,
  coverageOutsideOutage: 1,
  holes: [],
};
const sample = (overrides: Partial<DrillSample> = {}): DrillSample => ({
  index: 0,
  moment: 'mid-speech',
  killed: true,
  node: 'daisy-mr-lk-a',
  roundId: 'round1',
  killCommandMs: 900,
  seats: [
    {
      seat: 'first-speaker',
      lostMs: 1000,
      backMs: 9000,
      relapses: 0,
      udpBefore: true,
      udpAfter: true,
      admissionsAfterKill: 1,
      admissionStatuses: [200],
      lastStatuses: ['Connected'],
    },
    {
      seat: 'second-speaker',
      lostMs: 1000,
      backMs: 11_000,
      relapses: 0,
      udpBefore: true,
      udpAfter: false,
      admissionsAfterKill: 1,
      admissionStatuses: [200],
      lastStatuses: ['Connected'],
    },
  ],
  captureBackMs: 20_000,
  coverage,
  streams: [
    {
      state: 'partial',
      partialReasons: ['session-interrupted'],
      gapCount: 1,
      gapMs: 20_000,
      missingMs: 20_000,
    },
  ],
  penalties: 0,
  roundStatus: 'completed',
  roundMs: 1_800_000,
  incidents: 1,
  returnedMs: 9000,
  airtimeLostMs: 200,
  killSentAt: '2026-11-03T18:33:39.000Z',
  unsafeSeen: false,
  unsafeAfter60s: false,
  nodeBackMs: 40_000,
  nodeStartedBy: 'drill',
  errors: [],
  ...overrides,
});
const report = (samples: readonly DrillSample[], planned = samples.length) =>
  buildDrillReport({
    label: 'baseline',
    commit: 'abc',
    nodes: ['daisy-mr-lk-a'],
    planned,
    samples,
  });
const barsOf = (samples: readonly DrillSample[]) => report(samples).bars;

test('a clean drill passes every bar', () => {
  assert({
    given: 'recovery inside each bar, a partial seal with its gap, no penalty',
    should: 'pass all of them',
    actual: Object.values(barsOf([sample()])),
    expected: Array(8).fill('pass'),
  });
});

test('summaries state their sample sizes', () => {
  const result = report([
    sample({ incidents: null }),
    sample({ index: 1, incidents: null }),
  ]);
  assert({
    given: 'two kills of two seats',
    should: 'report four seat samples and two capture samples',
    actual: [result.seatBackMs.n, result.captureBackMs.n, result.udp.n],
    expected: [4, 2, 4],
  });
  assert({
    given: 'two Rounds of half an hour with no incident table',
    should: 'report the hours and no rate, not a zero rate',
    actual: [result.incidents.roundHours, result.incidents.per1000RoundHours],
    expected: [1, null],
  });
  assert({
    given: 'coverage of two Rounds',
    should: 'weigh by time owed',
    actual: result.captureCoverage.coverage,
    expected: 0.8,
  });
  assert({
    given: 'one seat that left UDP after recovery',
    should: 'count it',
    actual: [result.udp.directUdpBeforeKill, result.udp.directUdpAfterRecovery],
    expected: [4, 2],
  });
});

test('each bar can fail', () => {
  const never = {
    ...sample().seats[0]!,
    backMs: null,
  };
  const cases: readonly (readonly [
    string,
    Partial<DrillSample>,
    keyof ReturnType<typeof barsOf>,
  ])[] = [
    [
      'a seat at 16 s',
      { seats: [{ ...never, backMs: 16_000 }] },
      'seatsBackWithin15sP95',
    ],
    ['a seat that never returned', { seats: [never] }, 'seatsBackWithin15sP95'],
    ['capture at 31 s', { captureBackMs: 31_000 }, 'captureBackWithin30s'],
    [
      'capture that never returned',
      { captureBackMs: null },
      'captureBackWithin30s',
    ],
    [
      'a hole sealed complete',
      {
        streams: [
          {
            state: 'complete',
            partialReasons: [],
            gapCount: 0,
            gapMs: 0,
            missingMs: 20_000,
          },
        ],
      },
      'sealedHonestly',
    ],
    [
      'a partial seal that names no gap',
      {
        streams: [
          {
            state: 'partial',
            partialReasons: ['session-interrupted'],
            gapCount: 0,
            gapMs: 0,
            missingMs: 20_000,
          },
        ],
      },
      'sealedHonestly',
    ],
    [
      'a stream never sealed',
      {
        streams: [
          {
            state: 'open',
            partialReasons: [],
            gapCount: 0,
            gapMs: 0,
            missingMs: 0,
          },
        ],
      },
      'sealedHonestly',
    ],
    ['a kill with no incident', { incidents: 0 }, 'everyKillPausedTheRound'],
    ['a table not there', { incidents: null }, 'everyKillPausedTheRound'],
    ['speech not returned', { airtimeLostMs: 1_001 }, 'noAirtimeLost'],
    ['a forfeit', { penalties: 1 }, 'noAttendancePenalty'],
    ['a penalty never read', { penalties: null }, 'noAttendancePenalty'],
    ['a Round still active', { roundStatus: 'active' }, 'roundCompletes'],
    [
      'a session still unsafe after a minute',
      { unsafeAfter60s: true },
      'neverUnsafeOrUnrecoveredAfter60s',
    ],
    [
      'a seat back at 61 s',
      { seats: [{ ...never, backMs: 61_000 }] },
      'neverUnsafeOrUnrecoveredAfter60s',
    ],
  ];
  for (const [given, overrides, bar] of cases)
    assert({
      given,
      should: `fail ${bar}`,
      actual: barsOf([sample(overrides)])[bar],
      expected: 'fail',
    });
});

test('a session unsafe for a moment', () => {
  assert({
    given: 'a session unsafe during recovery and clear within a minute',
    should: 'keep the fact without failing the 60 s bar',
    actual: barsOf([sample({ unsafeSeen: true })])
      .neverUnsafeOrUnrecoveredAfter60s,
    expected: 'pass',
  });
});

test('a kill that did not run', () => {
  const skipped = sample({
    killed: false,
    index: 1,
    seats: [],
    streams: [],
    coverage: null,
    captureBackMs: null,
    errors: ['no node carried the seats'],
  });
  const result = report([sample(), skipped], 2);
  assert({
    given: 'one kill run and one refused',
    should: 'leave it out of the numbers and name it',
    actual: [result.killsRun, result.seatBackMs.n, result.notRun[0]?.errors],
    expected: [1, 2, ['no node carried the seats']],
  });
  assert({
    given: 'no kill run at all',
    should: 'report every bar as not run, never as a pass',
    actual: [...new Set(Object.values(barsOf([skipped])))],
    expected: ['not-run'],
  });
});

test('drillReportTable', () => {
  const table = drillReportTable(report([sample({ incidents: null })]));
  for (const line of [
    '1 of 1 kills ran',
    'n=2',
    'Capture coverage: 80.0%',
    'no table to read',
    'Direct UDP: 2 of 2 seats before the kill, 1 of 2 recovered seats after',
    'seatsBackWithin15sP95: pass',
  ])
    assert({
      given: 'a report',
      should: `read "${line}"`,
      actual: table.includes(line),
      expected: true,
    });
});
