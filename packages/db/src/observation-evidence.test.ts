import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observationEvidence } from './observation-evidence';
setupRitewayBun();
test('canonical renewals change lifetime without changing semantic body/evidence identity', () => {
  const dependencies = [
    {
      scope: 'cohort' as const,
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
test('duplicate semantic evidence cannot change identity or extend the earliest boundary', () => {
  const now = '2026-10-12T00:00:00.000Z';
  const fact = {
    scope: 'subject' as const,
    key: 'account-a',
    revision: '1',
    nextBoundary: '2026-10-12T00:00:00.100Z',
  };
  const single = observationEvidence([fact], now, null);
  const duplicate = observationEvidence(
    [fact, { ...fact, nextBoundary: '2026-11-01T00:00:00.000Z' }],
    now,
    null,
  );
  assert({
    given:
      'identical subject facts from canonical account and pure callback sources',
    should: 'deduplicate identity and retain earliest expiry',
    actual: duplicate,
    expected: single,
  });
});
