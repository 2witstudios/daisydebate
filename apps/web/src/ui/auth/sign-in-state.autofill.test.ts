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

  test('honours a verified autofill that lands after the email step is left', () => {
    assert({
      given: 'the inbox step and a late autofill sign-in the server verified',
      should: 'move to signed-in, since the session already exists',
      actual: signInReducer(inbox, {
        type: 'passkey-autofilled',
        outcome: { kind: 'signed-in' },
      }),
      expected: { step: 'signed-in' },
    });
  });

  test('says so when the server refuses the picked passkey', () => {
    assert({
      given: 'the idle email step and a picked passkey the server refused',
      should: 'keep the email and show the passkey failure notice',
      actual: signInReducer(idle, {
        type: 'passkey-autofilled',
        outcome: { kind: 'refused' },
      }),
      expected: { ...idle, notice: 'passkey-failed' },
    });
  });

  test('stays silent when the request ends without a pick', () => {
    const state: SignInState = { ...idle, notice: 'rate-limited' };
    const settle = (kind: 'superseded' | 'interrupted' | 'unavailable') =>
      signInReducer(state, { type: 'passkey-autofilled', outcome: { kind } });
    assert({
      given: 'an autofill request superseded, interrupted or unavailable',
      should: 'leave the state unchanged, with no notice of its own',
      actual: [
        settle('superseded'),
        settle('interrupted'),
        settle('unavailable'),
      ],
      expected: [state, state, state],
    });
  });

  test('ignores a refused pick while another request is pending', () => {
    const state: SignInState = { ...idle, pending: 'link' };
    assert({
      given: 'a pending link request and a refused autofill pick',
      should: 'leave the state unchanged',
      actual: signInReducer(state, {
        type: 'passkey-autofilled',
        outcome: { kind: 'refused' },
      }),
      expected: state,
    });
  });
});
