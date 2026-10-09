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
    context: { account: adultAccount('a').account },
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
