import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { claimedUsername } from './claimed-username';

setupRitewayBun();

const principal = { kind: 'user', userId: 'u', actorId: 'a' } as const;

test('settings shows the claimed username of a member and of a waitlisted account (ISSUE-690)', () => {
  const identities: Identity[] = [
    { state: 'member', username: 'ada', principal },
    { state: 'waitlisted', username: 'grace', reason: 'pending', principal },
    { state: 'provisional', principal },
    { state: 'anonymous', principal: { kind: 'anonymous' } },
  ];
  assert({
    given:
      'a member, a waitlisted account, a provisional and an anonymous identity',
    should:
      'name the claimed username where there is one, and nothing otherwise',
    actual: identities.map(claimedUsername),
    expected: ['ada', 'grace', null, null],
  });
});
