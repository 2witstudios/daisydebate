import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { authorize, type AuthorizationInput } from './authorization';
import { requireAuthorization } from './request-authorization';
import { socialPolicyEvidence } from './social-policy';
import { input, resource, accounts } from './channel.test-support';
import { input as manager, channel } from './group.test-support';
setupRitewayBun();
const preferenceCapabilities = [
  'channel.preferences.read',
  'channel.preferences.update',
] as const;
test('own channel preferences follow current read eligibility without posting admission', () => {
  const unknown = accounts.map((row) => ({
    ...row,
    age: { state: 'unknown' as const },
  }));
  const now = input.context.now!;
  const context = {
    ...input.context,
    socialAccounts: unknown,
    socialReading: {
      ...socialPolicyEvidence(resource, unknown, now),
      allowed: true,
    },
  };
  delete context.socialPosting;
  const blocked = resource.authority;
  if (blocked.kind !== 'dm') throw new Error('Expected DM fixture');
  const candidates = [
    { ...input, context },
    {
      ...input,
      context,
      resource: { ...resource, lifecycle: 'archived' as const },
    },
    {
      ...input,
      context,
      resource: { ...resource, authority: { ...blocked, blocked: true } },
    },
  ];
  assert({
    given:
      'current approved read evidence with unknown age, archived or blocked accepted DM',
    should: 'allow explicit preference read/update but refuse new posts',
    actual: candidates.flatMap((candidate) =>
      [...preferenceCapabilities, 'channel.post'].map(
        (capability) =>
          authorize({
            ...candidate,
            capability: capability as AuthorizationInput['capability'],
          }).allow,
      ),
    ),
    expected: [true, true, false, true, true, false, true, true, false],
  });
});
test('preference flags cannot replace current read authority or fresh account evidence', async () => {
  const context = { ...input.context };
  delete context.socialReading;
  const candidates: AuthorizationInput[] = [
    { ...input, context },
    {
      ...input,
      context: {
        ...input.context,
        account: { ...input.context.account!, erased: true },
      },
    },
    {
      ...input,
      context: {
        ...input.context,
        account: { ...input.context.account!, revision: 2 },
      },
    },
    {
      ...input,
      context: {
        ...input.context,
        now: input.context.socialReading!.validUntil,
      },
    },
    {
      ...manager,
      resource: {
        ...channel,
        authority: {
          kind: 'private_group',
          actorId:
            manager.principal.kind === 'user' ? manager.principal.actorId! : '',
          role: null,
          generation: 4,
          activeMemberActorIds: [],
        },
      },
    },
  ];
  assert({
    given:
      'missing read policy, erased/stale accounts, expired evidence or revoked group grant',
    should: 'deny preference read and update regardless of prior flags',
    actual: candidates.flatMap((candidate) =>
      preferenceCapabilities.map(
        (capability) =>
          authorize({
            ...candidate,
            capability: capability as AuthorizationInput['capability'],
          }).allow,
      ),
    ),
    expected: candidates.flatMap(() => [false, false]),
  });
  await assertRejects({
    given: 'denied preference metadata read',
    should: 'mask channel existence',
    actual: () =>
      requireAuthorization({
        ...input,
        context,
        capability:
          'channel.preferences.read' as AuthorizationInput['capability'],
      }),
    code: 'NOT_FOUND',
  });
});
test('revoked actors may clear only their actual own existing preference association', () => {
  const actorId =
    channel.authority.kind === 'private_group' ? channel.authority.actorId : '';
  const own = {
    ...manager,
    capability: 'channel.preferences.clear' as AuthorizationInput['capability'],
    resource: {
      kind: 'channel_preference' as const,
      actorId,
      channelId: channel.channelId,
    },
  };
  const candidates = [
    own,
    { ...own, resource: { ...own.resource, actorId: 'd'.repeat(24) } },
    { ...own, resource: { ...own.resource, channelId: '' } },
    { ...own, context: { account: null } },
    {
      ...own,
      context: { account: { ...manager.context.account!, erased: true } },
    },
    {
      ...own,
      context: { account: { ...manager.context.account!, member: false } },
    },
    ...(
      [
        'channel.read',
        'channel.preferences.read',
        'channel.preferences.update',
        'channel.post',
        'channel.manage',
      ] as const
    ).map((capability) => ({
      ...own,
      capability: capability as AuthorizationInput['capability'],
    })),
    { ...own, resource: channel },
  ];
  assert({
    given:
      'existing own/foreign association and current account with no channel/age/read grant',
    should:
      'permit only own-row clear, never read/update/create or broaden channel access',
    actual: candidates.map((candidate) => authorize(candidate).allow),
    expected: [true, ...candidates.slice(1).map(() => false)],
  });
});
