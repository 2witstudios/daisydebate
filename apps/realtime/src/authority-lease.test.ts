import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAuthorityLease } from './authority-lease';

setupRitewayBun();

describe('authority lease fencing', () => {
  test('transient observations do not supersede or extend durable authority', () => {
    let now = 0;
    const lease = createAuthorityLease({ now: () => now, lifetimeMs: 100 });
    const durable = lease.begin('session', 'revision');
    const observation = lease.observe();
    const allowed = lease.observes(observation, 1_000);
    const accepted = lease.accept(durable, 50);
    now = 50;
    assert({
      given: 'an observational hint overlapping a pending durable check',
      should: 'preserve that attempt and its shorter canonical deadline',
      actual: { allowed, accepted, current: lease.current() },
      expected: { allowed: true, accepted: true, current: false },
    });
  });
  test('observation checks retain generation and deadline fences', () => {
    let now = 0;
    const lease = createAuthorityLease({ now: () => now, lifetimeMs: 100 });
    const observation = lease.observe();
    const malformed = lease.observes(observation, Number.NaN);
    now = 50;
    const expired = lease.observes(observation, 50);
    lease.invalidate();
    const stale = lease.observes(observation, 100);
    assert({
      given: 'malformed deadline, exact expiry and a changed generation',
      should: 'refuse every stale observational allow',
      actual: { malformed, expired, stale },
      expected: { malformed: false, expired: false, stale: false },
    });
  });
  test('session and age deadlines dominate the accepted maximum', () => {
    let now = 0;
    const lease = createAuthorityLease({ now: () => now, lifetimeMs: 60_000 });
    const attempt = lease.begin('session', 'revision');
    const accepted = lease.accept(attempt, 100);
    now = 100;
    assert({
      given: 'an authority deadline earlier than the periodic maximum',
      should: 'refuse at that exact deadline without waiting for a timer',
      actual: [accepted, lease.current(), lease.accept(attempt, 100)],
      expected: [true, false, false],
    });
  });
  test('an invalid deadline never becomes authority', () => {
    const lease = createAuthorityLease({ now: () => 0, lifetimeMs: 60_000 });
    assert({
      given: 'NaN from an unvalidated producer deadline',
      should: 'refuse the allow',
      actual: lease.accept(lease.begin('session', 'revision'), Number.NaN),
      expected: false,
    });
  });
  for (const invalidation of [
    'revocation',
    'unsubscribe',
    'replacement',
    'close',
  ]) {
    test(`late allow cannot survive ${invalidation}`, () => {
      let now = 10;
      const lease = createAuthorityLease({ now: () => now, lifetimeMs: 100 });
      const attempt = lease.begin('session-a', 'revision-a');
      lease.invalidate();
      now = 20;
      assert({
        given: `an allow resolved after ${invalidation}`,
        should: 'never attach or emit',
        actual: [lease.accept(attempt), lease.current()],
        expected: [false, false],
      });
    });
  }
  test('check start bounds expiry, including stalled timers', () => {
    let now = 10;
    const lease = createAuthorityLease({ now: () => now, lifetimeMs: 100 });
    const attempt = lease.begin('session-a', 'revision-a');
    now = 109;
    const accepted = lease.accept(attempt);
    now = 110;
    assert({
      given: 'a slow allow followed by elapsed expiry without a timer',
      should: 'expire at check start plus lifetime',
      actual: [accepted, lease.current(), lease.accept(attempt)],
      expected: [true, false, false],
    });
  });
  test('resource revision and session replacements fence old attempts', () => {
    const lease = createAuthorityLease({ now: () => 10, lifetimeMs: 100 });
    const old = lease.begin('session-a', 'revision-a');
    const fresh = lease.begin('session-b', 'revision-b');
    assert({
      given: 'a newer session and resource revision attempt',
      should: 'accept only the current attempt',
      actual: [lease.accept(old), lease.accept(fresh), lease.current()],
      expected: [false, true, true],
    });
  });
});
