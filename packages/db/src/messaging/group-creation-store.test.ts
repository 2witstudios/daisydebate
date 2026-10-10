import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects, rejectionOf } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { createMessagingGroupCreationStore } from './group-creation-store';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  peerId = 'b'.repeat(24),
  channelId = 'c'.repeat(24);
const scope = {
  actorId,
  userId: 'u'.repeat(24),
  requestId: 'r'.repeat(24),
  proposedActorIds: [peerId, actorId],
  policyRevision: 1,
};
const accounts = [actorId, peerId].map((id, index) => ({
  actorId: id,
  userId: ['u'.repeat(24), 'v'.repeat(24)][index],
  member: true,
  erased: false,
  revision: 1,
}));
const pair = { low_blocks_high: false, high_blocks_low: false, revision: '1' };
const command = {
  channelId,
  title: 'Private group title',
  digest: 'd'.repeat(64),
  now: '2026-10-09T18:00:00.000Z',
};
const fact = {
  kind: 'channel',
  channelId,
  policyKey: 'social.private_group',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 1,
  authority: {
    kind: 'private_group',
    actorId,
    role: 'manager',
    generation: 1,
    activeMemberActorIds: [actorId],
  },
};

test('creation persists only after observing absent receipt and fresh account/pair admission', async () => {
  const { client, queries } = fakeSql([
    [],
    accounts,
    [],
    [pair],
    [],
    [],
    [],
    [],
    [],
    [[1, '9']],
    [],
    [[2, '9']],
    [],
    [[3, '9']],
    [],
  ]);
  const fences: string[] = [];
  const store = createMessagingGroupCreationStore(
    drizzle({ client }),
    async (_tx, _scope, projected) => {
      fences.push(projected.kind);
      if (projected.kind === 'create')
        assert({
          given: 'ordered current locked facts',
          should:
            'project canonical pairs and accounts rather than proposed grants',
          actual: [
            projected.accounts.map((a) => a?.actorId),
            projected.contacts,
          ],
          expected: [
            [actorId, peerId],
            [
              {
                lowActorId: actorId,
                highActorId: peerId,
                blocked: false,
                revision: 1,
              },
            ],
          ],
        });
    },
  );
  const result = await store.withCreation(scope, async (frame) => {
    assert({
      given: 'unobserved receipt',
      should: 'refuse writing',
      actual: await rejectionOf(() => frame.commit(command)),
      expected: { code: 'CONFLICT' },
    });
    assert({
      given: 'new creation',
      should: 'observe absence',
      actual: await frame.readResult(),
      expected: null,
    });
    const created = await frame.commit(command);
    await assertRejects({
      given: 'observed closed/committed receipt',
      should: 'refuse a second write',
      actual: () => frame.commit(command),
      code: 'CONFLICT',
    });
    return created;
  });
  const inserts = queries.filter((q) => q.query.startsWith('insert into'));
  const bells = inserts
    .filter((q) => q.query.includes('"outbox"'))
    .map((q) => q.params.find((p) => typeof p === 'object' && p !== null));
  assert({
    given: 'one admitted creation',
    should:
      'write manager, invitations, subject-bound receipt and thin bells once',
    actual: [
      result,
      fences,
      inserts.map((q) => q.query.match(/insert into "([^"]+)"/)?.[1]),
      bells,
    ],
    expected: [
      { channelId, lifecycle: 'active' },
      ['create'],
      [
        'messaging_contact_pairs',
        'messaging_channels',
        'messaging_group_grants',
        'messaging_group_invitations',
        'messaging_social_commands',
        'messaging_social_command_subjects',
        'outbox',
        'outbox',
        'outbox',
      ],
      [
        { kind: 'channel.changed', channelId, changeVersion: 1 },
        { kind: 'messaging.inbox.changed' },
        { kind: 'messaging.inbox.changed' },
      ],
    ],
  });
  assert({
    given: 'same transaction ordered locks',
    should:
      'bind users before contact fence and persist exact invitation association',
    actual: [
      queries[1]?.query.includes('daisy_authorization_accounts'),
      queries[3]?.query.includes('for update'),
      queries[3]?.params,
      inserts[3]?.params.includes(peerId),
      inserts[5]?.params.includes(peerId),
    ],
    expected: [true, true, [actorId, peerId], true, true],
  });
});

test('canonical admission refusal stops durable group/receipt/outbox writes', async () => {
  const { client, queries } = fakeSql([[], accounts, [], [pair]]);
  const store = createMessagingGroupCreationStore(
    drizzle({ client }),
    async () => {
      throw createAppError('AUTHORIZATION');
    },
  );
  await assertRejects({
    given: 'canonical refusal',
    should: 'refuse group creation',
    actual: () =>
      store.withCreation(scope, async (frame) => {
        await frame.readResult();
        return frame.commit(command);
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'fresh canonical refusal',
    should: 'not persist channel, grants, invitation or receipt',
    actual: queries
      .filter((q) => q.query.startsWith('insert into'))
      .map((q) => q.query.match(/insert into "([^"]+)"/)?.[1]),
    expected: ['messaging_contact_pairs'],
  });
});

for (const proposedActorIds of [
  [actorId],
  [peerId, peerId],
  [actorId, actorId],
  [actorId, 'invalid'],
])
  test(`invalid proposed cast ${proposedActorIds.join(',')}`, async () => {
    const { client, queries } = fakeSql([]);
    await assertRejects({
      given: 'invalid or stale group facts',
      should: 'refuse without creating authority',
      actual: () =>
        createMessagingGroupCreationStore(
          drizzle({ client }),
          async () => {},
        ).withCreation({ ...scope, proposedActorIds }, async () => true),
      code: 'VALIDATION',
    });
    assert({
      given: 'invalid/duplicate/missing initiator proposal',
      should: 'refuse before database discovery',
      actual: queries.length,
      expected: 0,
    });
  });

test('closed creation replay fences current group and binds fresh receipt without prospective admission', async () => {
  const { client, queries } = fakeSql([
    [['group.create', channelId]],
    [{ fact }],
    accounts,
    [{ locked: true }],
    [{ fact }],
    [['group.create', command.digest, channelId]],
  ]);
  const modes: string[] = [];
  const result = await createMessagingGroupCreationStore(
    drizzle({ client }),
    async (_tx, _scope, current) => {
      modes.push(current.kind);
    },
  ).withCreation(scope, async (frame) => {
    const found = await frame.readResult();
    await assertRejects({
      given: 'observed closed/committed receipt',
      should: 'refuse a second write',
      actual: () => frame.commit(command),
      code: 'CONFLICT',
    });
    return found;
  });
  assert({
    given: 'own durable creation receipt',
    should: 'authorize only fresh result and never recreate grants or pairs',
    actual: [
      result,
      modes,
      queries.some((q) => q.query.startsWith('insert into')),
      queries[3]?.query.includes('daisy_messaging_channel_fence'),
    ],
    expected: [
      {
        kind: 'group.create',
        digest: command.digest,
        channelId,
        lifecycle: 'active',
      },
      ['result'],
      false,
      true,
    ],
  });
});

for (const scenario of ['lock', 'cast', 'receipt', 'missing'] as const)
  test(`replay refuses ${scenario} drift`, async () => {
    const fresh = {
      ...fact,
      authority: { ...fact.authority, activeMemberActorIds: [actorId, peerId] },
    };
    const scripts = [
      [['group.create', channelId]],
      [{ fact }],
      accounts,
      [{ locked: scenario !== 'lock' }],
      scenario === 'missing'
        ? []
        : [{ fact: scenario === 'cast' ? fresh : fact }],
      [],
    ];
    const { client, queries } = fakeSql(scripts);
    await assertRejects({
      given: 'invalid or stale group facts',
      should: 'refuse without creating authority',
      actual: () =>
        createMessagingGroupCreationStore(
          drizzle({ client }),
          async () => {},
        ).withCreation(scope, (frame) => frame.readResult()),
      code: scenario === 'cast' ? 'CONFLICT' : 'NOT_FOUND',
    });
    assert({
      given: 'lock/current membership/receipt disappearance',
      should: 'refuse without recreating any private authority',
      actual: queries.some((q) => q.query.startsWith('insert into')),
      expected: false,
    });
  });
