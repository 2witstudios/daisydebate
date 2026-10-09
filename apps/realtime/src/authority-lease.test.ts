import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAuthorityLease } from './authority-lease';

setupRitewayBun();

describe('authority lease fencing', () => {
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
