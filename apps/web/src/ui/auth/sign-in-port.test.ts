import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  offerPasskeyAutofillSafely,
  requestLinkSafely,
  signInWithPasskeySafely,
  type SignInPort,
} from './sign-in-port';

setupRitewayBun();

const throwingPort: SignInPort = {
  requestLink: () => Promise.reject(new Error('network down')),
  signInWithPasskey: () => Promise.reject(new Error('ceremony blew up')),
  offerPasskeyAutofill: () => Promise.reject(new Error('autofill blew up')),
};

// Throws before any promise exists: client init or argument validation.
const synchronouslyThrowingPort: SignInPort = {
  requestLink: () => {
    throw new Error('client not initialised');
  },
  signInWithPasskey: () => {
    throw new Error('WebAuthn options invalid');
  },
  offerPasskeyAutofill: () => {
    throw new Error('WebAuthn options invalid');
  },
};

const passingPort: SignInPort = {
  requestLink: (email) =>
    Promise.resolve(
      email === 'j@school.edu' ? { kind: 'sent' } : { kind: 'rate-limited' },
    ),
  signInWithPasskey: () => Promise.resolve({ kind: 'signed-in' }),
  offerPasskeyAutofill: () => Promise.resolve({ kind: 'signed-in' }),
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

  test('turns a synchronous throw into unavailable', async () => {
    assert({
      given: 'a port that throws before returning a promise',
      should: 'still settle as unavailable instead of escaping',
      actual: await requestLinkSafely(
        synchronouslyThrowingPort,
        'j@school.edu',
      ),
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

  test('turns a synchronous throw into a failure', async () => {
    assert({
      given: 'a ceremony that throws before returning a promise',
      should: 'still settle as a failure instead of escaping',
      actual: await signInWithPasskeySafely(synchronouslyThrowingPort),
      expected: { kind: 'failed' },
    });
  });
});

describe('offerPasskeyAutofillSafely', () => {
  test('passes the outcome through', async () => {
    assert({
      given: 'an autofilled passkey the server verified',
      should: 'return signed-in',
      actual: await offerPasskeyAutofillSafely(passingPort),
      expected: { kind: 'signed-in' },
    });
  });

  test('turns an asynchronous or synchronous throw into unavailable', async () => {
    assert({
      given:
        'autofill requests that throw after and before returning a promise',
      should:
        'settle both as unavailable so autofill stops instead of retrying a broken port',
      actual: [
        await offerPasskeyAutofillSafely(throwingPort),
        await offerPasskeyAutofillSafely(synchronouslyThrowingPort),
      ],
      expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
    });
  });
});
