import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { adultAccount } from './social.test-support';
setupRitewayBun();
test('safety block authority does not depend on contact admission or known age', () => {
  const input = {
    principal: { kind: 'user' as const, userId: 'a', actorId: 'a' },
    capability: 'social.block' as const,
    resource: {
      kind: 'contact_pair' as const,
      lowActorId: 'a',
      highActorId: 'b',
      blocked: true,
      revision: 1,
    },
    context: {
      account: adultAccount('a').account,
      contactAccounts: [
        adultAccount('a').account,
        { ...adultAccount('b').account, member: false },
      ],
    },
  };
  assert({
    given:
      'a bound current pair participant without any age or admission evidence',
    should:
      'allow safety block changes and deny outsiders, erased accounts and invalid pairs',
    actual: [
      authorize(input).allow,
      authorize({
        ...input,
        principal: { kind: 'user', userId: 'c', actorId: 'c' },
        context: { account: adultAccount('c').account },
      }).allow,
      authorize({
        ...input,
        context: { account: { ...input.context.account, erased: true } },
      }).allow,
      authorize({ ...input, resource: { ...input.resource, revision: 0 } })
        .allow,
      authorize({
        ...input,
        resource: { ...input.resource, lowActorId: 'b', highActorId: 'a' },
      }).allow,
    ],
    expected: [true, false, false, false, false],
  });
});

test('safety authority requires exact current nonerased pair accounts', () => {
  const account = adultAccount('a').account;
  const peer = { ...adultAccount('b').account, member: false };
  const input = {
    principal: { kind: 'user' as const, userId: 'a', actorId: 'a' },
    capability: 'social.block' as const,
    resource: {
      kind: 'contact_pair' as const,
      lowActorId: 'a',
      highActorId: 'b',
      blocked: false,
      revision: 1,
    },
    context: { account },
  };
  const projections = [
    undefined,
    [account],
    [account, { ...peer, erased: true, revision: 2 }],
    [account, { ...peer, actorId: 'c' }],
    [account, { ...peer, revision: 0 }],
    [{ ...account, revision: 2 }, peer],
    [{ ...account, userId: 'foreign' }, peer],
    [account, peer, peer],
    [account, { ...peer, userId: account.userId }],
    [peer, account],
  ];
  assert({
    given:
      'missing, erased, foreign, invalid, stale, duplicate accounts and a current unverified peer control',
    should:
      'deny invalid projections and preserve safety without age or peer membership',
    actual: projections.map(
      (contactAccounts) =>
        authorize({ ...input, context: { account, contactAccounts } }).allow,
    ),
    expected: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ],
  });
});
