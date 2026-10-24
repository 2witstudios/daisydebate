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
      'a foreign Round, precision loss, a contradictory health/cause pair or an unresolved marker',
    should: 'refuse every observation',
    actual: refusals,
    expected: [true, true, true, true, true],
  });
});

test('only a sample inside a committed, in-budget check-in commit is excused (ISSUE-541)', () => {
  const pending = (sampleAt: string, cause = 'check_in_pending' as const) => ({
    at: sampleAt,
    healthy: false,
    cause,
  });
  const marker = (
    resolvedAt: string,
    state: 'committed' | 'aborted' = 'committed',
  ) => [{ state, receivedAt: at, resolvedAt }];
  const inside = '2026-10-22T00:00:00.020001Z';
  assert({
    given:
      'a pending sample inside a 40 ms commit, after it resolved, inside one over the 2 s budget, inside an aborted one, and a stale-web sample inside the commit',
    should: 'excuse only the first',
    actual: [
      duringCheckInCommit(
        pending(inside),
        marker('2026-10-22T00:00:00.040001Z'),
      ),
      duringCheckInCommit(
        pending('2026-10-22T00:00:00.040002Z'),
        marker('2026-10-22T00:00:00.040001Z'),
      ),
      duringCheckInCommit(
        pending(inside),
        marker('2026-10-22T00:00:02.000002Z'),
      ),
      duringCheckInCommit(
        pending(inside),
        marker('2026-10-22T00:00:00.040001Z', 'aborted'),
      ),
      duringCheckInCommit(
        { at: inside, healthy: false, cause: 'web_stale' },
        marker('2026-10-22T00:00:00.040001Z'),
      ),
    ],
    expected: [true, false, false, false, false],
  });
});
