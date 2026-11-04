import type { Identity } from '@daisy/auth';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { followOfferedTo } from './follow-offer';

setupRitewayBun();

const principal = { kind: 'user', userId: 'u', actorId: 'a' } as const;
const member: Identity = { state: 'member', username: 'sam', principal };
const restricted: Identity = {
  state: 'restricted',
  username: 'sam',
  principal,
};
const visitor: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};

test('a provisional identity with no username is offered no Follow', () => {
  assert({
    given: 'a signed-in account that has not claimed a username',
    should: 'not offer what the route would refuse',
    actual: followOfferedTo({
      state: 'member',
      username: null,
      principal,
    } as never),
    expected: false,
  });
});

test('a profile offers Follow only where the route would take it', () => {
  assert({
    given: 'a member, a restricted account and a visitor',
    should: 'offer it to the member alone',
    actual: [member, restricted, visitor].map((who) => followOfferedTo(who)),
    expected: [true, false, false],
  });
});
