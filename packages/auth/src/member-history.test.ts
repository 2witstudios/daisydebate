import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { input, ownResourceDenials, resource } from './channel.test-support';
setupRitewayBun();
test('member history grants a current member only their own private history', () => {
  const own = {
    ...input,
    capability: 'member.history.read' as const,
    resource: { kind: 'member_history' as const, actorId: 'a' },
  };
  const cases = [
    own,
    ...ownResourceDenials(own),
    { ...own, context: { ...own.context, account: null } },
    {
      ...own,
      principal: { kind: 'user' as const, userId: 'foreign', actorId: 'a' },
    },
    { ...own, capability: 'round.read' as const },
    { ...own, resource },
    {
      ...own,
      principal: {
        kind: 'service' as const,
        serviceId: 'worker',
        scope: 'foundation' as const,
        capabilities: ['member.history.read' as const],
      },
    },
  ];
  assert({
    given:
      'the owner, another member, a visitor, a provisional, erased, unrevisioned or missing account, an unbound principal, a foreign capability or resource, and a service',
    should: 'grant only the bound current member their own history',
    actual: cases.map((candidate) => authorize(candidate).allow),
    expected: [true, ...Array.from({ length: 10 }, () => false)],
  });
});
