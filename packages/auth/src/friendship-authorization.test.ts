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

test('a member reads only their own friend collection', () => {
  const read = (
    actorId: string,
    account: ReturnType<typeof adultAccount>['account'] | null,
  ) =>
    authorize({
      principal: { kind: 'user', userId: 'a', actorId: 'a' },
      capability: 'social.friend.list',
      resource: { kind: 'messaging_collection', actorId },
      context: { account },
    }).allow;
  assert({
    given:
      'their own collection, another actor’s, and their own with an erased, non-member or missing account',
    should: 'allow only the current member reading their own',
    actual: [
      read('a', adultAccount('a').account),
      read('b', adultAccount('a').account),
      read('a', { ...adultAccount('a').account, erased: true }),
      read('a', { ...adultAccount('a').account, member: false }),
      read('a', null),
    ],
    expected: [true, false, false, false, false],
  });
  assert({
    given: 'the list capability on a contact pair',
    should: 'deny the mismatched resource',
    actual: authorize({
      ...input('social.friend.request'),
      capability: 'social.friend.list',
    }).allow,
    expected: false,
  });
});

test('a member updates only their own presence setting', () => {
  const update = (actorId: string, erased = false) =>
    authorize({
      principal: { kind: 'user', userId: 'a', actorId: 'a' },
      capability: 'social.presence.update',
      resource: { kind: 'messaging_collection', actorId },
      context: { account: { ...adultAccount('a').account, erased } },
    }).allow;
  assert({
    given: 'their own setting, another actor’s, and their own when erased',
    should: 'allow only the current member’s own',
    actual: [update('a'), update('b'), update('a', true)],
    expected: [true, false, false],
  });
});
