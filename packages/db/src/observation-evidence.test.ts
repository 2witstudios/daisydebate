import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observationEvidence } from './observation-evidence';
setupRitewayBun();
test('canonical renewals change lifetime without changing semantic body/evidence identity', () => {
  const dependencies = [
    {
      key: 'age:a',
      revision: '1:adult',
      nextBoundary: '2026-11-01T00:00:00.000Z',
    },
  ];
  const renewals = Array.from({ length: 100 }, (_, i) =>
    observationEvidence(
      dependencies,
      new Date(Date.parse('2026-10-12T00:00:00.000Z') + i * 100).toISOString(),
      null,
    ),
  );
  const expired = observationEvidence(
    dependencies,
    '2026-11-01T00:00:00.000Z',
    null,
  );
  const newBand = observationEvidence(
    [{ ...dependencies[0]!, revision: '1:16-17' }],
    '2026-10-12T00:00:00.000Z',
    null,
  );
  assert({
    given: '100 unchanged canonical reads and a no-write expiry boundary',
    should:
      'keep semantic fingerprint stable, expire independently and include age classification',
    actual: {
      identities: new Set(renewals.map((e) => e.fingerprint)).size,
      remaining: renewals[0]!.remainingMs,
      expired: expired.remainingMs,
      bandChanges: newBand.fingerprint !== renewals[0]!.fingerprint,
    },
    expected: { identities: 1, remaining: 5000, expired: 0, bandChanges: true },
  });
});
