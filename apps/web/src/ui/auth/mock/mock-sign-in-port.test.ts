import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  MOCK_EMAIL,
  mockFlowState,
  mockLinkOutcome,
  mockSignInPort,
  parseMockPreview,
} from './mock-sign-in-port';

setupRitewayBun();

describe('mockLinkOutcome', () => {
  test('picks the outcome from the address', () => {
    assert({
      given: 'bounce, limit, down, and plain addresses',
      should: 'map each to its outcome, case-insensitively',
      actual: [
        'j.bounce@school.edu',
        'LIMIT@school.edu',
        'down@school.edu',
        'jordan@lincoln.edu',
      ].map((email) => mockLinkOutcome(email).kind),
      expected: ['undeliverable', 'rate-limited', 'unavailable', 'sent'],
    });
  });
});

describe('mockSignInPort', () => {
  test('never reports a passkey success', async () => {
    assert({
      given: 'a passkey ceremony on the mock',
      should: 'report it as cancelled',
      actual: await mockSignInPort.signInWithPasskey(),
      expected: { kind: 'cancelled' },
    });
  });
});

describe('parseMockPreview', () => {
  test('accepts known steps and falls back on anything else', () => {
    assert({
      given: 'a known step, an unknown string, an array, and nothing',
      should: 'keep the known step and fall back to sign-in otherwise',
      actual: [
        parseMockPreview('confirm'),
        parseMockPreview('<script>'),
        parseMockPreview(['confirm']),
        parseMockPreview(undefined),
      ],
      expected: ['confirm', 'sign-in', 'sign-in', 'sign-in'],
    });
  });
});

describe('mockFlowState', () => {
  const now = '2026-09-21T12:00:00.000Z';

  test('opens the inbox step stamped with now', () => {
    assert({
      given: 'the check-inbox preview',
      should: 'start a fresh cooldown for the mock address',
      actual: mockFlowState('check-inbox', now),
      expected: {
        step: 'check-inbox',
        email: MOCK_EMAIL,
        sentAt: now,
        resending: false,
      },
    });
  });

  test('opens a notice preview on the email step', () => {
    assert({
      given: 'the undeliverable preview',
      should: 'show the email step with that notice',
      actual: mockFlowState('undeliverable', now),
      expected: {
        step: 'enter-email',
        email: MOCK_EMAIL,
        pending: 'none',
        notice: 'undeliverable',
      },
    });
  });
});
