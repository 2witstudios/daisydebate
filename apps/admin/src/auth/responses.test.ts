import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseAuthentication, parseRegistration } from './responses';
import { softAuthenticator } from './soft-authenticator.test-support';
import { canonicalCeremony } from './webauthn';

setupRitewayBun();
test('ceremony result shapes', async () => {
  const device = await softAuthenticator(9);
  const created = await device.register('c', canonicalCeremony);
  const asserted = await device.assert('c', canonicalCeremony, 1);
  assert({
    given: 'well-formed registration and assertion results',
    should: 'parse each as its own kind only',
    actual: [
      parseRegistration(created)?.id,
      parseAuthentication(asserted)?.id,
      parseRegistration(asserted),
      parseAuthentication(created),
    ],
    expected: [device.id, device.id, null, null],
  });
  assert({
    given: 'an oversized or non-base64url field, or no object at all',
    should: 'refuse it',
    actual: [
      parseAuthentication({ ...asserted, id: 'x'.repeat(4097) }),
      parseAuthentication({ ...asserted, id: 'not base64' }),
      parseRegistration('{}'),
    ],
    expected: [null, null, null],
  });
});
