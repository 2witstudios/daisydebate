import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  canOfferPasskeyAutofill,
  signInReducer,
  type SignInState,
} from './sign-in-state';

setupRitewayBun();

const idle: SignInState = {
  step: 'enter-email',
  email: 'jordan@lincoln.edu',
  pending: 'none',
};

const inbox: SignInState = {
  step: 'check-inbox',
  email: 'jordan@lincoln.edu',
  sentAt: '2026-09-21T12:00:00.000Z',
  resending: false,
};

describe('canOfferPasskeyAutofill', () => {
  test('offers autofill only while the email step is idle', () => {
    assert({
      given: 'idle, a pending link, a pending ceremony, and the inbox step',
      should: 'arm autofill only for the idle email step',
      actual: [
        canOfferPasskeyAutofill(idle),
        canOfferPasskeyAutofill({ ...idle, pending: 'link' }),
        canOfferPasskeyAutofill({ ...idle, pending: 'passkey' }),
        canOfferPasskeyAutofill(inbox),
      ],
      expected: [true, false, false, false],
    });
  });
});

describe('signInReducer: passkey autofill', () => {
  test('signs in when the browser autofills a passkey', () => {
    assert({
      given: 'the email step and an autofilled passkey the server verified',
      should: 'move to signed-in',
      actual: signInReducer(idle, {
        type: 'passkey-autofilled',
        outcome: { kind: 'signed-in' },
      }),
      expected: { step: 'signed-in' },
    });
  });

  test('stays silent when the autofill request ends without a sign-in', () => {
    const state: SignInState = { ...idle, notice: 'rate-limited' };
    const settle = (kind: 'cancelled' | 'unsupported' | 'failed') =>
      signInReducer(state, { type: 'passkey-autofilled', outcome: { kind } });
    assert({
      given: 'an autofill request that was aborted, unsupported or refused',
      should: 'leave the state unchanged, with no notice of its own',
      actual: [settle('cancelled'), settle('unsupported'), settle('failed')],
      expected: [state, state, state],
    });
  });

  test('ignores an autofill that settles after the email step is left', () => {
    assert({
      given: 'the inbox step',
      should: 'leave the state unchanged',
      actual: signInReducer(inbox, {
        type: 'passkey-autofilled',
        outcome: { kind: 'signed-in' },
      }),
      expected: inbox,
    });
  });
});
