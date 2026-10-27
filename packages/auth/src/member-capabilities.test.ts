import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type ChannelAuthorizationFact } from './authorization';
import { input, resource, accounts } from './channel.test-support';
import { socialPostingPolicy } from './social-policy';
import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
  messagingTestPosting,
  messagingTestReading,
} from './testing/social-policy';

setupRitewayBun();
test('Room collection creation and discovery require a current bound member', () => {
  const evaluate = (member: boolean) =>
    ['room.create', 'room.list'].map(
      (capability) =>
        authorize({
          ...input,
          capability: capability as 'room.create' | 'room.list',
          resource: { kind: 'room_collection' },
          context: { account: { ...input.context.account!, member } },
        }).allow,
    );
  assert({
    given: 'bound current membership or a provisional account',
    should:
      'allow explicit collection capabilities only for the current member',
    actual: [evaluate(true), evaluate(false)],
    expected: [
      [true, true],
      [false, false],
    ],
  });
});
test('group management requires a current manager grant and fresh posting authority', () => {
  const group: ChannelAuthorizationFact = {
    ...resource,
    policyKey: 'social.private_group',
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: 'manager',
      generation: 1,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  const evaluate = (channel: ChannelAuthorizationFact) =>
    authorize({
      ...input,
      capability: 'channel.manage',
      resource: channel,
      context: {
        ...input.context,
        socialReading: (channel.authority.kind === 'dm'
          ? messagingTestReading
          : messagingTestGroupReading)({
          channel,
          accounts,
          now: input.context.now!,
        }),
        socialPosting: socialPostingPolicy({
          channel,
          accounts,
          now: input.context.now!,
          policy:
            channel.authority.kind === 'dm'
              ? messagingTestPosting
              : messagingTestGroupPolicy,
        }),
      },
    }).allow;
  const member: ChannelAuthorizationFact = {
    ...group,
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: 'member',
      generation: 1,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  assert({
    given:
      'same current group facts for manager or ordinary member and a DM resource',
    should: 'grant management only to the persisted group manager',
    actual: [evaluate(group), evaluate(member), evaluate(resource)],
    expected: [true, false, false],
  });
});
test('beta access gates participant capabilities but keeps the safety exits (ADR 0075)', () => {
  const room = {
    kind: 'room' as const,
    roomId: 'r',
    hostActorId: 'a',
    visibility: 'public' as const,
    status: 'assembling',
    revision: 1,
    participants: [{ actorId: 'a', role: 'debater', slot: 0 }],
  };
  const evaluate = (beta: 'pending' | 'approved' | 'revoked' | null) =>
    (['room.create', 'room.read', 'room.ready', 'room.leave'] as const).map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource:
            capability === 'room.create' ? { kind: 'room_collection' } : room,
          context: {
            account: {
              ...input.context.account!,
              beta: beta && { state: beta, revision: 1 },
            },
          },
        }).allow,
    );
  assert({
    given: 'an approved, a pending, a revoked and a beta-less member account',
    should: 'allow everything only when approved, and leaving the Room always',
    actual: [
      evaluate('approved'),
      evaluate('pending'),
      evaluate('revoked'),
      evaluate(null),
    ],
    expected: [
      [true, true, true, true],
      [false, false, false, true],
      [false, false, false, true],
      [false, false, false, true],
    ],
  });
});
test('participant access needs a durable age record at the 16+ beta floor (ADR 0075)', () => {
  const evaluate = (ageBand: 'adult' | '16-17' | '13-15' | null) =>
    (['room.create', 'room.leave'] as const).map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource:
            capability === 'room.create'
              ? { kind: 'room_collection' }
              : {
                  kind: 'room',
                  roomId: 'r',
                  hostActorId: 'a',
                  visibility: 'public',
                  status: 'assembling',
                  revision: 1,
                  participants: [{ actorId: 'a', role: 'debater', slot: 0 }],
                },
          context: {
            account: {
              ...input.context.account!,
              beta: { state: 'approved', revision: 2 },
              ageBand,
            },
          },
        }).allow,
    );
  assert({
    given:
      'approved accounts that are adult, 16-17, 13-15, or have no age record',
    should:
      'admit only 16 and older to participant capabilities, and always allow leaving',
    actual: [
      evaluate('adult'),
      evaluate('16-17'),
      evaluate('13-15'),
      evaluate(null),
    ],
    expected: [
      [true, true],
      [true, true],
      [false, true],
      [false, true],
    ],
  });
});
test('only the configured operator service holds the operator capabilities (ADR 0079)', () => {
  const operator = {
    kind: 'operator_service' as const,
    serviceId: 'daisy-admin',
    keyId: 'k20261026',
    operatorRef: 'o'.repeat(24),
    capabilities: [
      'account.collection.read',
      'account.beta_access.update',
    ] as const,
  };
  const target = {
    ...input.context.account!,
    beta: { state: 'pending' as const, revision: 1 },
  };
  const decide = (
    principal: Parameters<typeof authorize>[0]['principal'],
    capability:
      'account.collection.read' | 'account.beta_access.update' | 'room.create',
    account: Parameters<typeof authorize>[0]['context']['account'] = target,
  ) =>
    authorize({
      principal,
      capability,
      resource:
        capability === 'account.collection.read'
          ? { kind: 'account_collection' }
          : capability === 'room.create'
            ? { kind: 'room_collection' }
            : { kind: 'account' },
      context: { account },
    }).allow;
  assert({
    given:
      'the operator service, one missing a capability, a member, and targets that are erased or have no beta row',
    should:
      'allow only configured capabilities on live beta accounts, and nothing else',
    actual: [
      decide(operator, 'account.collection.read', null),
      decide(operator, 'account.beta_access.update'),
      decide(
        { ...operator, capabilities: ['account.collection.read'] },
        'account.beta_access.update',
      ),
      decide(input.principal, 'account.beta_access.update'),
      decide(operator, 'room.create'),
      decide(operator, 'account.beta_access.update', {
        ...target,
        erased: true,
      }),
      decide(operator, 'account.beta_access.update', { ...target, beta: null }),
    ],
    expected: [true, true, false, false, false, false, false],
  });
});
