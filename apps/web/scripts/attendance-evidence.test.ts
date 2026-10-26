import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decodeAttendanceEvidence,
  duringCheckInCommit,
  elapsedAttendanceObservationUs,
} from '../e2e/support/attendance-evidence-decoder';
setupRitewayBun();
const roundId = 'r'.repeat(24);
const at = '2026-10-22T00:00:00.000001Z';
const observation = {
  roundId,
  observedAt: at,
  status: 'active' as const,
  version: 2,
  pendingAttempts: 0,
  ratingChanges: 0,
  checkInCommands: 0,
  samples: [{ at, healthy: false, cause: 'public_probe_failed' as const }],
  checkInAttempts: [
    {
      state: 'committed' as const,
      receivedAt: at,
      resolvedAt: '2026-10-22T00:00:00.040001Z',
    },
  ],
  instances: [],
  segments: [],
  receipts: [],
  adjudications: [],
};

test('browser outage witnesses never floor a native microsecond beyond the allowed gap', () => {
  assert({
    given: 'native PG samples exactly two seconds and one microsecond apart',
    should: 'observe the gap beyond two seconds rather than floor it closed',
    actual: elapsedAttendanceObservationUs('2026-10-22T00:00:02.000002Z', at),
    expected: 2_000_001n,
  });
});

test('attendance observations retain native PG precision and actual unhealthy cause', () => {
  assert({
    given: 'a scoped read-only PG observation with six fractional digits',
    should:
      'preserve exact native text without timestamp flooring or healthy defaults',
    actual: decodeAttendanceEvidence(JSON.stringify(observation), roundId),
    expected: observation,
  });
});

test('foreign, malformed or contradictory observations never become browser proof', () => {
  const inputs = [
    { ...observation, roundId: 'f'.repeat(24) },
    { ...observation, observedAt: '2026-10-22T00:00:00.000Z' },
    { ...observation, samples: [{ at, healthy: true, cause: 'web_stale' }] },
    { ...observation, samples: [{ at, healthy: false, cause: null }] },
    {
      ...observation,
      checkInAttempts: [{ state: 'pending', receivedAt: at, resolvedAt: at }],
    },
    {
      ...observation,
      checkInAttempts: [
        { state: 'committed', receivedAt: at, resolvedAt: null },
      ],
    },
  ];
  const refusals = inputs.map((input) => {
    try {
      decodeAttendanceEvidence(JSON.stringify(input), roundId);
      return false;
    } catch (error) {
      return (
        error instanceof Error &&
        error.message === 'Invalid attendance evidence payload'
      );
    }
  });
  assert({
    given:
      'a foreign Round, precision loss, a contradictory health/cause pair, or a marker whose state and resolution disagree',
    should: 'refuse every observation',
    actual: refusals,
    expected: [true, true, true, true, true, true],
  });
});

test("only a sample inside the writer's own check-in slice is excused (ISSUE-541)", () => {
  const pending = (sampleAt: string) => ({
    at: sampleAt,
    healthy: false,
    cause: 'check_in_pending' as const,
  });
  const marker = (
    resolvedAt: string,
    state: 'committed' | 'aborted' = 'committed',
  ) => [{ state, receivedAt: at, resolvedAt }];
  const quick = marker('2026-10-22T00:00:00.040001Z');
  const inside = '2026-10-22T00:00:00.020001Z';
  assert({
    given: [
      'a pending sample inside a 40 ms committed marker',
      'one in the COMMIT tail just after resolved_at',
      'one after the 900 ms slice',
      'one before the marker opened',
      'one inside a committed marker that took 1.5 s (a reconcile-settled orphan)',
      'one inside an aborted marker',
      'a stale-web sample inside the marker',
    ].join(', '),
    should: 'excuse only the first two',
    actual: [
      duringCheckInCommit(pending(inside), quick),
      duringCheckInCommit(pending('2026-10-22T00:00:00.045001Z'), quick),
      duringCheckInCommit(pending('2026-10-22T00:00:00.900002Z'), quick),
      duringCheckInCommit(pending('2026-10-21T23:59:59.999999Z'), quick),
      duringCheckInCommit(
        pending(inside),
        marker('2026-10-22T00:00:01.500001Z'),
      ),
      duringCheckInCommit(
        pending(inside),
        marker('2026-10-22T00:00:00.040001Z', 'aborted'),
      ),
      duringCheckInCommit(
        { at: inside, healthy: false, cause: 'web_stale' },
        quick,
      ),
    ],
    expected: [true, true, false, false, false, false, false],
  });
});

test('no excuse while another marker could be holding the sample (ISSUE-541)', () => {
  const sample = {
    at: '2026-10-22T00:00:00.600001Z',
    healthy: false,
    cause: 'check_in_pending' as const,
  };
  const quick = {
    state: 'committed' as const,
    receivedAt: at,
    resolvedAt: '2026-10-22T00:00:00.040001Z',
  };
  const from500ms = '2026-10-22T00:00:00.500001Z';
  assert({
    given:
      'a pending sample at 600 ms inside a quick marker, beside an aborted marker from 500 ms to 1.4 s, a committed one from 500 ms to 2.1 s, one still pending from 500 ms, an aborted one resolved 50 ms earlier (its COMMIT may be open), or an aborted one opened after the sample; then the quick marker alone',
    should:
      'excuse it only when no other marker could hold it open, counting a commit tail',
    actual: [
      duringCheckInCommit(sample, [
        quick,
        {
          state: 'aborted',
          receivedAt: from500ms,
          resolvedAt: '2026-10-22T00:00:01.400001Z',
        },
      ]),
      duringCheckInCommit(sample, [
        quick,
        {
          state: 'committed',
          receivedAt: from500ms,
          resolvedAt: '2026-10-22T00:00:02.100001Z',
        },
      ]),
      duringCheckInCommit(sample, [
        quick,
        { state: 'pending', receivedAt: from500ms, resolvedAt: null },
      ]),
      duringCheckInCommit(sample, [
        quick,
        {
          state: 'aborted',
          receivedAt: '2026-10-22T00:00:00.100001Z',
          resolvedAt: '2026-10-22T00:00:00.550001Z',
        },
      ]),
      duringCheckInCommit(sample, [
        quick,
        {
          state: 'aborted',
          receivedAt: '2026-10-22T00:00:00.700001Z',
          resolvedAt: '2026-10-22T00:00:01.400001Z',
        },
      ]),
      duringCheckInCommit(sample, [quick]),
    ],
    expected: [false, false, false, false, true, true],
  });
});
