import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  challengeExpiry,
  enrollmentExpiry,
  sessionExpiry,
  sessionVerdict,
} from './lifetimes';

setupRitewayBun();
const start = '2026-10-26T12:00:00.000Z';
const session = {
  lastSeenAt: start,
  expiresAt: sessionExpiry(start),
  revokedAt: null,
};
const active = { disabledAt: null };

test('expiries', () => {
  assert({
    given: 'an issue time',
    should: 'expire enrollments in 15 min, challenges in 2, sessions in 12 h',
    actual: [
      enrollmentExpiry(start),
      challengeExpiry(start),
      session.expiresAt,
    ],
    expected: [
      '2026-10-26T12:15:00.000Z',
      '2026-10-26T12:02:00.000Z',
      '2026-10-27T00:00:00.000Z',
    ],
  });
});

test('sessionVerdict', () => {
  assert({
    given: 'a session seen 29 minutes ago with an enabled operator',
    should: 'be active',
    actual: sessionVerdict(session, active, '2026-10-26T12:29:59.999Z'),
    expected: 'active',
  });
  assert({
    given: 'a session idle for 30 minutes',
    should: 'be idle',
    actual: sessionVerdict(session, active, '2026-10-26T12:30:00.000Z'),
    expected: 'idle',
  });
  assert({
    given: 'a session kept busy past its 12 h absolute limit',
    should: 'be expired however recently it was seen',
    actual: sessionVerdict(
      { ...session, lastSeenAt: '2026-10-26T23:59:00.000Z' },
      active,
      '2026-10-27T00:00:00.000Z',
    ),
    expected: 'expired',
  });
  assert({
    given: 'a revoked session',
    should: 'be revoked',
    actual: sessionVerdict({ ...session, revokedAt: start }, active, start),
    expected: 'revoked',
  });
  assert({
    given: 'a live session whose operator is disabled or gone',
    should: 'be refused for the operator',
    actual: [{ disabledAt: start }, null].map((operator) =>
      sessionVerdict(session, operator, start),
    ),
    expected: ['operator_disabled', 'operator_disabled'],
  });
});
