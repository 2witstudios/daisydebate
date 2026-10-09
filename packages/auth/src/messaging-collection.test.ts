import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
import {
  input,
  resource,
  accounts,
  pendingResource,
} from './channel.test-support';
setupRitewayBun();
test('messaging collection grants only current member own-association discovery', () => {
  const own = {
    ...input,
    capability: 'channel.inbox.read' as const,
    resource: { kind: 'messaging_collection' as const, actorId: 'a' },
  };
  const cases = [
    own,
    { ...own, resource: { ...own.resource, actorId: 'b' } },
    { ...own, principal: { kind: 'anonymous' as const } },
    {
      ...own,
      context: {
        ...own.context,
        account: { ...own.context.account!, member: false },
      },
    },
    {
      ...own,
      context: {
        ...own.context,
        account: { ...own.context.account!, erased: true },
      },
    },
    {
      ...own,
      context: {
        ...own.context,
        account: { ...own.context.account!, revision: 0 },
      },
    },
    {
      ...own,
      principal: { kind: 'user' as const, userId: 'foreign', actorId: 'a' },
    },
    { ...own, capability: 'channel.read' as const },
    { ...own, capability: 'channel.post' as const },
    { ...own, resource },
    {
      ...own,
      principal: {
        kind: 'service' as const,
        serviceId: 'worker',
        scope: 'foundation' as const,
        capabilities: ['channel.inbox.read' as const],
      },
    },
  ];
  assert({
    given:
      'current own, foreign, erased, provisional, unbound and isolated resource cases',
    should:
      'grant only own collection discovery without any channel entitlement',
    actual: cases.map((candidate) => authorize(candidate).allow),
    expected: [true, ...Array.from({ length: 10 }, () => false)],
  });
});
test('pending status is sender-only minimal metadata with fresh reading evidence', () => {
  const pending = pendingResource;
  const own: AuthorizationInput = {
    ...input,
    capability: 'channel.request.status',
    resource: pending,
  };
  const recipient: AuthorizationInput = {
    ...own,
    principal: { kind: 'user', userId: 'v', actorId: 'b' },
    context: { ...own.context, account: accounts[1]!.account },
  };
  const noReading = { ...own.context };
  delete noReading.socialReading;
  const cases: AuthorizationInput[] = [
    own,
    recipient,
    { ...own, context: noReading },
    {
      ...own,
      resource: {
        ...pending,
        authority: { ...pending.authority, state: 'accepted' },
      },
    },
    {
      ...own,
      resource: {
        ...pending,
        authority: { ...pending.authority, state: 'declined' },
      },
    },
    {
      ...own,
      resource: {
        ...pending,
        lifecycle: 'archived',
        authority: { ...pending.authority, blocked: true },
      },
    },
    { ...own, capability: 'channel.read' },
    { ...own, capability: 'channel.post' },
    { ...own, capability: 'channel.request.read' },
    { ...recipient, capability: 'channel.request.read' },
    {
      ...own,
      context: {
        ...own.context,
        socialReading: {
          ...input.context.socialReading!,
          relationshipRevision: 4,
        },
      },
    },
  ];
  assert({
    given:
      'sender/recipient, pending/closed, unavailable/stale policy and content capabilities',
    should:
      'expose only own pending status while retaining all introduction/content and freshness gates',
    actual: cases.map((candidate) => authorize(candidate).allow),
    expected: [
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
  });
});
