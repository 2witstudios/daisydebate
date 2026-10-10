import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
import { input, channel, actorId } from './group.test-support';
import { adultAccount } from './social.test-support';
setupRitewayBun();
const invitees = ['d'.repeat(24), 'e'.repeat(24)];
const grant = channel.authority;
if (grant.kind !== 'private_group') throw new Error('Expected group fixture');
const members = [...grant.activeMemberActorIds, ...invitees];
const pairs = members.flatMap((lowActorId, index) =>
  members.slice(index + 1).map((highActorId) => ({
    lowActorId,
    highActorId,
    blocked: false,
    revision: 1,
  })),
);
const accounts = members.map((id) => {
  const row = adultAccount(id);
  return id === actorId
    ? {
        ...row,
        account: input.context.account!,
        age: { ...row.age, accountRevision: input.context.account!.revision },
      }
    : row;
});
const resource = {
  kind: 'group_invitation_creation' as const,
  channel,
  inviteeActorIds: invitees,
  contactPairs: pairs,
};
const context: AuthorizationInput['context'] = {
  ...input.context,
  now: '2026-10-10T00:00:00.000Z',
  socialAccounts: accounts,
  socialCreationPolicy: {
    state: 'approved',
    decision: 'isolated explicit test policy',
    key: 'social.private_group',
    revision: 1,
    groupBlockScope: 'all_pairs',
    allowedBandPairs: [['adult', 'adult']],
  },
};
const candidate = {
  ...input,
  capability: 'channel.group.invite' as const,
  resource,
  context,
};
test('batch invitation intent needs current manager plus exact admission facts', () => {
  assert({
    given:
      'active manager and complete current cast plus proposed accounts, pairs and explicit policy',
    should:
      'authorize prospective invitation issuance without any invitation row or grant',
    actual: authorize(candidate).allow,
    expected: true,
  });
});
test('invitation issuance respects only the explicitly selected block scope', () => {
  const policy = context.socialCreationPolicy;
  if (!policy || policy.state !== 'approved')
    throw new Error('Expected approved test policy');
  const contactPairs = pairs.map((pair) => ({
    ...pair,
    blocked: pair.lowActorId !== actorId,
  }));
  const scopes = ['all_pairs', 'initiator'] as const;
  assert({
    given:
      'complete group and proposed-target facts with a blocked non-initiator pair',
    should:
      'deny all-pairs and allow initiator scope only when explicitly approved',
    actual: scopes.map(
      (groupBlockScope) =>
        authorize({
          ...candidate,
          resource: { ...resource, contactPairs },
          context: {
            ...context,
            socialCreationPolicy: { ...policy, groupBlockScope },
          },
        }).allow,
    ),
    expected: [false, true],
  });
});
test('issuance refuses missing/pending eligibility and stale or unsafe projections', () => {
  const policy = context.socialCreationPolicy;
  if (!policy || policy.state !== 'approved')
    throw new Error('Expected approved test policy');
  const missingPolicy = { ...context };
  delete missingPolicy.socialCreationPolicy;
  const missingScope = { ...policy };
  delete missingScope.groupBlockScope;
  const cases = [
    { ...candidate, context: missingPolicy },
    {
      ...candidate,
      context: {
        ...context,
        socialCreationPolicy: { state: 'pending' as const },
      },
    },
    {
      ...candidate,
      context: { ...context, socialCreationPolicy: missingScope },
    },
    {
      ...candidate,
      context: { ...context, socialCreationPolicy: { ...policy, revision: 2 } },
    },
    {
      ...candidate,
      context: { ...context, socialAccounts: accounts.slice(1) },
    },
    {
      ...candidate,
      context: {
        ...context,
        socialAccounts: accounts.map((row) => ({
          ...row,
          age: { state: 'unknown' as const },
        })),
      },
    },
    { ...candidate, context: { ...context, now: '2026-11-01T00:00:00.000Z' } },
    { ...candidate, resource: { ...resource, inviteeActorIds: [] } },
    { ...candidate, resource: { ...resource, inviteeActorIds: [actorId] } },
    {
      ...candidate,
      resource: { ...resource, inviteeActorIds: [invitees[0]!, invitees[0]!] },
    },
    { ...candidate, resource: { ...resource, inviteeActorIds: ['invalid'] } },
    { ...candidate, resource: { ...resource, contactPairs: pairs.slice(1) } },
    {
      ...candidate,
      resource: {
        ...resource,
        contactPairs: pairs.map((pair) => ({ ...pair, blocked: true })),
      },
    },
    {
      ...candidate,
      resource: {
        ...resource,
        channel: { ...channel, lifecycle: 'archived' as const },
      },
    },
    {
      ...candidate,
      resource: {
        ...resource,
        channel: {
          ...channel,
          authority: { ...grant, role: 'member' as const },
        },
      },
    },
    {
      ...candidate,
      resource: {
        ...resource,
        channel: { ...channel, authority: { ...grant, generation: 0 } },
      },
    },
    {
      ...candidate,
      resource: { ...resource, channel: { ...channel, revision: 0 } },
    },
    ...(
      [
        'channel.create.private_group',
        'channel.read',
        'channel.manage',
        'channel.group.result',
        'channel.invitation.accept',
      ] as const
    ).map((capability) => ({ ...candidate, capability })),
  ];
  assert({
    given:
      'missing scope/policy, invalid target sets, stale age/account/pair/core or other capabilities',
    should: 'deny without producing invitations, membership or broader grants',
    actual: cases.map((value) => authorize(value).allow),
    expected: cases.map(() => false),
  });
});
