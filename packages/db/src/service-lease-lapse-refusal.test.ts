import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('a lapse is recognised through native cause wrappers', async () => {
  const { createAppError, createRefusal } = await import('@daisy/errors');
  const { isServiceLeaseLapse } = await import('./web-service-authority');
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  assert({
    given:
      'the lapse refusal itself, the lapse wrapped by a worker stage error, and an unrelated authorization failure',
    should: 'recognise the first two and not the third (DAISY-WEB-9)',
    actual: [
      isServiceLeaseLapse(lapse),
      isServiceLeaseLapse(
        createAppError('INFRASTRUCTURE', 'stage failed', lapse),
      ),
      isServiceLeaseLapse(createAppError('AUTHORIZATION', 'denied')),
    ],
    expected: [true, true, false],
  });
});
