import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { adultAccount } from './social.test-support';
setupRitewayBun();

const pair = {
  kind: 'contact_pair' as const,
  lowActorId: 'a',
  highActorId: 'b',
  blocked: false,
  revision: 1,
};
const input = (
  capability: 'social.friend.request' | 'social.friend.end',
  overrides: { blocked?: boolean; peerMember?: boolean } = {},
) => ({
  principal: { kind: 'user' as const, userId: 'a', actorId: 'a' },
  capability,
  resource: { ...pair, blocked: overrides.blocked ?? false },
  context: {
    account: adultAccount('a').account,
    contactAccounts: [
      adultAccount('a').account,
      { ...adultAccount('b').account, member: overrides.peerMember ?? true },
    ],
  },
});

test('friendship authority over the contact pair', () => {
  assert({
    given: 'two current members with no block',
    should: 'allow asking, accepting and ending',
    actual: [
      authorize(input('social.friend.request')).allow,
      authorize(input('social.friend.end')).allow,
    ],
    expected: [true, true],
  });
  assert({
    given: 'a block on either side',
    should: 'deny asking or accepting and still allow ending',
    actual: [
      authorize(input('social.friend.request', { blocked: true })).allow,
      authorize(input('social.friend.end', { blocked: true })).allow,
    ],
    expected: [false, true],
  });
  assert({
    given: 'a peer that is not a current member',
    should: 'deny asking',
    actual: authorize(input('social.friend.request', { peerMember: false }))
      .allow,
    expected: false,
  });
  assert({
    given: 'an outsider to the pair',
    should: 'deny both',
    actual: [
      authorize({
        ...input('social.friend.request'),
        principal: { kind: 'user', userId: 'c', actorId: 'c' },
        context: { account: adultAccount('c').account },
      }).allow,
      authorize({
        ...input('social.friend.end'),
        principal: { kind: 'user', userId: 'c', actorId: 'c' },
        context: { account: adultAccount('c').account },
      }).allow,
    ],
    expected: [false, false],
  });
});
