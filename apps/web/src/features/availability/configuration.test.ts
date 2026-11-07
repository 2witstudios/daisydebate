import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readPublicCheckInProbe } from './configuration';
setupRitewayBun();
test('public check-in configuration is explicit isolated resource data and missing remains disabled', async () => {
  assert({
    given: 'no configured public check-in fixture',
    should: 'return no probe resource',
    actual: readPublicCheckInProbe(undefined, 'https://canonical.example'),
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
      actual: () => readPublicCheckInProbe(raw, 'https://canonical.example'),
      code: 'VALIDATION',
    });
});

test('probe origin has exactly one trusted owner', () => {
  const fixture = {
    roundId: 'a'.repeat(24),
    segmentId: 'b'.repeat(24),
    participantId: 'c'.repeat(24),
    cookie: 'synthetic-test-only',
  };
  assert({
    given: 'fixture credentials without a destination and the trusted app URL',
    should: 'derive both public destination and Origin from that URL',
    actual: readPublicCheckInProbe(
      JSON.stringify(fixture),
      'https://canonical.example/',
    ),
    expected: { ...fixture, origin: 'https://canonical.example' },
  });
});

test('a fixture cannot retain an independent destination', async () => {
  await assertRejects({
    given: 'otherwise-valid fixture data with its own origin',
    should:
      'reject the duplicate authority rather than silently keep a fallback',
    actual: () =>
      readPublicCheckInProbe(
        JSON.stringify({
          origin: 'https://other.example',
          roundId: 'a'.repeat(24),
          segmentId: 'b'.repeat(24),
          participantId: 'c'.repeat(24),
          cookie: 'fixture-only',
        }),
        'https://canonical.example',
      ),
    code: 'VALIDATION',
  });
});
