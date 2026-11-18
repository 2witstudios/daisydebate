import { assert, setupRitewayBun, test } from 'riteway/bun';
import { releaseAccountOf } from './release-account';
setupRitewayBun();

const principal = { kind: 'user', userId: 'user-1', actorId: 'actor-1' };

test('releaseAccountOf', () => {
  assert({
    given: 'a member',
    should: 'read release flags for their own account, so overrides apply',
    actual: releaseAccountOf({ state: 'member', principal } as never),
    expected: 'user-1',
  });
  assert({
    given: 'a visitor, a provisional account and a waitlisted account',
    should: 'read the default, with no account',
    actual: [
      releaseAccountOf({ state: 'anonymous', principal: {} } as never),
      releaseAccountOf({ state: 'provisional', principal } as never),
      releaseAccountOf({ state: 'waitlisted', principal } as never),
    ],
    expected: [null, null, null],
  });
});
