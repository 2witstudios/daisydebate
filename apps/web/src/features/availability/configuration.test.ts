import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readPublicCheckInProbe } from './configuration';
setupRitewayBun();
test('public check-in configuration is explicit isolated resource data and missing remains disabled', async () => {
  assert({
    given: 'no configured public check-in fixture',
    should: 'return no probe resource',
    actual: readPublicCheckInProbe(undefined),
    expected: null,
  });
  for (const raw of [
    'not-json',
    '{}',
    JSON.stringify({
      origin: 'http://localhost:13140',
      roundId: 'a'.repeat(24),
      segmentId: 'b'.repeat(24),
      participantId: 'c'.repeat(24),
      cookie: 'synthetic-test-only',
      actorId: 'd'.repeat(24),
    }),
  ])
    await assertRejects({
      given: 'invalid or authority-bearing probe configuration',
      should: 'reject without copying secret input into error details',
      actual: () => readPublicCheckInProbe(raw),
      code: 'VALIDATION',
    });
});
