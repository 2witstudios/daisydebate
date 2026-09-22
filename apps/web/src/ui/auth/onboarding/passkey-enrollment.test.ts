import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  enrollSafely,
  passkeyEnrollmentNotYetAvailable,
} from './passkey-enrollment';

setupRitewayBun();

describe('passkey enrollment seam', () => {
  test('the stage-4 seam never reports a save', async () => {
    assert({
      given: 'the seam before AUTH-5.x fills it',
      should: 'report unavailable, not saved',
      actual: await enrollSafely(passkeyEnrollmentNotYetAvailable),
      expected: { kind: 'unavailable' },
    });
  });

  test('a throwing seam is a failure', async () => {
    assert({
      given: 'a seam that throws before returning a promise',
      should: 'report failed',
      actual: await enrollSafely({
        enroll: () => {
          throw new Error('boom');
        },
      }),
      expected: { kind: 'failed' },
    });
  });
});
