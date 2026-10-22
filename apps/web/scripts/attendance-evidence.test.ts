import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decodeAttendanceEvidence } from '../e2e/support/attendance-evidence-decoder';
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
  instances: [],
  segments: [],
  receipts: [],
  adjudications: [],
};

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
    given: 'a foreign Round, precision loss or contradictory health/cause pair',
    should: 'refuse every observation',
    actual: refusals,
    expected: [true, true, true, true],
  });
});
