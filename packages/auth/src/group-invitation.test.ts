import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  type GroupInvitationAuthorizationFact,
} from './authorization';
import {
  accounts,
  invitation,
  input,
  asInviter,
} from './group-invitation.test-support';
setupRitewayBun();
test('invitation-only authority never invents channel membership', () => {
  const unavailable = {
    account: input.context.account,
    contactAccounts: input.context.contactAccounts!,
  };
  assert({
    given:
      'pending invitation before a grant, unavailable admission and own sender cancellation',
    should:
      'allow minimal invited-self read/decline and original-inviter cancellation without granting history or posting',
    actual: [
      authorize({
        ...input,
        capability: 'channel.invitation.read',
        context: unavailable,
      }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.decline',
        context: unavailable,
      }).allow,
      authorize(asInviter('channel.invitation.cancel')).allow,
      authorize(asInviter('channel.invitation.read')).allow,
      authorize({ ...input, capability: 'channel.invitation.cancel' }).allow,
      authorize({ ...input, capability: 'channel.read' }).allow,
      authorize({ ...input, capability: 'channel.post' }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.accept',
        context: unavailable,
      }).allow,
    ],
    expected: [true, true, true, false, false, false, false, false],
  });
});
test('group acceptance requires fresh explicit admission and current inviter manager', () => {
  const missingScope = { ...input.context.socialCreationPolicy! };
  delete missingScope.groupBlockScope;
  const badPeer = accounts.map((row, i) =>
    i === 2
      ? { ...row, age: { ...row.age, validUntil: '2026-10-01T00:00:00.000Z' } }
      : row,
  );
  const resources: GroupInvitationAuthorizationFact[] = [
    invitation,
    { ...invitation, expectedGeneration: 2 },
    {
      ...invitation,
      invitation: { ...invitation.invitation, channelId: 'other' },
    },
    {
      ...invitation,
      channel: { ...invitation.channel, lifecycle: 'archived' },
    },
    { ...invitation, inviterGrant: { ...invitation.inviterGrant, role: null } },
    {
      ...invitation,
      channel: { ...invitation.channel, activeMemberActorIds: ['c'] },
    },
    {
      ...invitation,
      channel: { ...invitation.channel, activeMemberActorIds: ['a', 'b', 'c'] },
    },
    { ...invitation, contactPairs: invitation.contactPairs.slice(0, 1) },
  ];
  assert({
    given:
      'actual/current or stale generation/FK/group manager/membership/pair projections',
    should:
      'allow only exact pending admission without fabricating grant facts',
    actual: resources.map(
      (resource) => authorize({ ...input, resource }).allow,
    ),
    expected: [true, ...Array.from({ length: 7 }, () => false)],
  });
  assert({
    given:
      'missing group scope, stale age and mismatched locked account projection',
    should:
      'refuse incomplete policy or freshness even with a pending invitation',
    actual: [
      authorize({
        ...input,
        context: { ...input.context, socialCreationPolicy: missingScope },
      }).allow,
      authorize({
        ...input,
        context: { ...input.context, socialAccounts: badPeer },
      }).allow,
      authorize({
        ...input,
        context: {
          ...input.context,
          contactAccounts: [
            { ...accounts[0]!.account, revision: 2 },
            accounts[1]!.account,
          ],
        },
      }).allow,
    ],
    expected: [false, false, false],
  });
});
test('invitation revocation and closed receipts retain actor and generation isolation', () => {
  const closed = (
    state: 'accepted' | 'declined' | 'cancelled',
  ): GroupInvitationAuthorizationFact => ({
    ...invitation,
    invitation: { ...invitation.invitation, state },
  });
  assert({
    given: 'archived or blocked pending metadata and explicit closed outcomes',
    should:
      'permit own refusal/cancel/result, never another actor decision or pending result',
    actual: [
      authorize({
        ...input,
        capability: 'channel.invitation.decline',
        resource: {
          ...invitation,
          channel: { ...invitation.channel, lifecycle: 'archived' },
        },
      }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.read',
        resource: {
          ...invitation,
          contactPairs: invitation.contactPairs.map((pair) => ({
            ...pair,
            blocked: true,
          })),
        },
      }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.result',
        resource: closed('accepted'),
      }).allow,
      authorize({
        ...asInviter('channel.invitation.result'),
        resource: closed('accepted'),
      }).allow,
      authorize({
        ...asInviter('channel.invitation.result'),
        resource: closed('cancelled'),
      }).allow,
      authorize({ ...input, capability: 'channel.invitation.result' }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.read',
        context: { ...input.context, contactAccounts: [accounts[0]!.account] },
      }).allow,
      authorize({
        ...input,
        capability: 'channel.invitation.decline',
        context: {
          ...input.context,
          contactAccounts: [
            { ...accounts[0]!.account, erased: true },
            accounts[1]!.account,
          ],
        },
      }).allow,
    ],
    expected: [true, true, true, false, true, false, false, false],
  });
});
