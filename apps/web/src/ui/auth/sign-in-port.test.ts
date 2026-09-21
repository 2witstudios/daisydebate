import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  requestLinkSafely,
  signInWithPasskeySafely,
  type SignInPort,
} from './sign-in-port';

setupRitewayBun();

const throwingPort: SignInPort = {
  requestLink: () => Promise.reject(new Error('network down')),
  signInWithPasskey: () => Promise.reject(new Error('ceremony blew up')),
};

const passingPort: SignInPort = {
  requestLink: (email) =>
    Promise.resolve(
      email === 'j@school.edu' ? { kind: 'sent' } : { kind: 'rate-limited' },
    ),
  signInWithPasskey: () => Promise.resolve({ kind: 'signed-in' }),
};

describe('requestLinkSafely', () => {
  test('passes the outcome through', async () => {
    assert({
      given: 'a port that answers',
      should: 'return its outcome for the email it was given',
      actual: await requestLinkSafely(passingPort, 'j@school.edu'),
      expected: { kind: 'sent' },
    });
  });

  test('turns a throw into unavailable', async () => {
    assert({
      given: 'a port that throws',
      should: 'report the service as unavailable',
      actual: await requestLinkSafely(throwingPort, 'j@school.edu'),
      expected: { kind: 'unavailable' },
    });
  });
});

describe('signInWithPasskeySafely', () => {
  test('passes the outcome through', async () => {
    assert({
      given: 'a ceremony that succeeds',
      should: 'return signed-in',
      actual: await signInWithPasskeySafely(passingPort),
      expected: { kind: 'signed-in' },
    });
  });

  test('turns a throw into a failure, never a success', async () => {
    assert({
      given: 'a ceremony that throws',
      should: 'report a failure',
      actual: await signInWithPasskeySafely(throwingPort),
      expected: { kind: 'failed' },
    });
  });
});
