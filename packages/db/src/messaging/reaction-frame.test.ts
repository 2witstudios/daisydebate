import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { channelReactionFrame } from './reaction-frame';
setupRitewayBun();
const scope = { channelId: 'c'.repeat(24), actorId: 'a'.repeat(24) };
const command = {
  version: 1 as const,
  channelId: scope.channelId,
  messageId: 'm'.repeat(24),
  requestId: 'r'.repeat(24),
  reaction: '👍',
  active: true,
};
const policy = { reactionUnits: 8, choices: ['👍', '❤️'] };
const digest = '1'.repeat(64);
const message = {
  id: command.messageId,
  channelId: scope.channelId,
  available: true,
};

test('reaction additions refuse before protected SQL and forbid cross-channel command scope', async () => {
  const { client, queries } = fakeSql([]);
  const frame = channelReactionFrame(
    drizzle({ client }),
    scope,
    8,
    policy,
    async () => {
      throw createAppError('AUTHORIZATION');
    },
  );
  await assertRejects({
    given: 'a denied addition under the canonical operation fence',
    should:
      'leave reaction, receipt, counters and notification state untouched',
    actual: () => frame.change(command, digest),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'refused reaction authority',
    should: 'perform no protected query',
    actual: queries.length,
    expected: 0,
  });
});

test('fresh reaction retry reads current aggregate without restoring a subsequently removed association', async () => {
  const { client, queries } = fakeSql([
    [message],
    [],
    [{ messageId: command.messageId, payloadDigest: digest }],
    [{ reaction: '❤️', count: '2', own: false }],
  ]);
  const { frame, guards } = readableFrame(client);
  const result = await frame.change(command, digest);
  assert({
    given:
      'a bound original addition receipt whose own reaction has since been removed',
    should:
      'recheck current authority and return only current aggregate without insertion or a bell',
    actual: [
      result,
      guards,
      queries.some((q) => /^(insert|update|delete)/.test(q.query)),
    ],
    expected: [
      {
        version: 1,
        channelId: scope.channelId,
        messageId: command.messageId,
        changeVersion: 8,
        replayed: true,
        reactions: [{ reaction: '❤️', count: 2, own: false }],
      },
      ['add', 'read'],
      false,
    ],
  });
});

test('adding and removing an own reaction atomically advance changes and emit one content-free bell', async () => {
  for (const active of [true, false]) {
    const own = {
      actorId: scope.actorId,
      channelId: scope.channelId,
      messageId: command.messageId,
      reaction: command.reaction,
    };
    const { client, queries } = fakeSql([
      [message],
      active ? [] : [own],
      [],
      [{ actorId: scope.actorId }],
      [{ id: scope.channelId }],
      [{ id: command.messageId }],
      [],
      [[1n, '1']],
      [],
      active ? [{ reaction: command.reaction, count: '1', own: true }] : [],
    ]);
    const guards: unknown[] = [];
    const frame = channelReactionFrame(
      drizzle({ client }),
      scope,
      8,
      policy,
      async (operation, association) => {
        guards.push([operation, association ?? null]);
      },
    );
    const result = await frame.change({ ...command, active }, digest);
    const associationWrite = queries.find((q) =>
      q.query.includes(
        active
          ? 'insert into messaging_reactions'
          : 'delete from messaging_reactions',
      ),
    );
    const bell = queries.find((q) => q.query.includes('insert into "outbox"'));
    assert({
      given: active
        ? 'a current authorized addition'
        : 'an actual locked own association with canonical removal authority',
      should:
        'scope the association and receipt, advance only the change counter and publish no choice/actor/body',
      actual: [
        result.changeVersion,
        result.replayed,
        result.reactions,
        guards,
        associationWrite?.params,
        bell?.params.find(
          (value) => value !== null && typeof value === 'object',
        ),
        queries.filter((q) => q.query.includes('pg_notify')).length,
      ],
      expected: [
        9,
        false,
        active ? [{ reaction: command.reaction, count: 1, own: true }] : [],
        active
          ? [
              ['add', null],
              ['add', null],
              ['add', null],
              ['read', null],
            ]
          : [
              ['read', null],
              ['remove', own],
              ['read', null],
            ],
        [scope.actorId, scope.channelId, command.messageId, command.reaction],
        {
          kind: 'channel.changed',
          channelId: scope.channelId,
          changeVersion: 9,
        },
        1,
      ],
    });
  }
});

test('reaction removal cannot invent an absent association or accept a foreign row or receipt', async () => {
  const scenarios = [
    { active: false, own: [], receipt: [], code: 'NOT_FOUND' as const },
    {
      active: false,
      own: [
        {
          actorId: 'b'.repeat(24),
          channelId: scope.channelId,
          messageId: command.messageId,
          reaction: command.reaction,
        },
      ],
      receipt: [],
      code: 'CONFLICT' as const,
    },
    {
      active: true,
      own: [],
      receipt: [{ messageId: 'f'.repeat(24), payloadDigest: digest }],
      code: 'CONFLICT' as const,
    },
    {
      active: true,
      own: [],
      receipt: [
        { messageId: command.messageId, payloadDigest: '2'.repeat(64) },
      ],
      code: 'CONFLICT' as const,
    },
  ];
  for (const scenario of scenarios) {
    const { client, queries } = fakeSql([
      [message],
      scenario.own,
      scenario.receipt,
    ]);
    const guards: string[] = [];
    const frame = channelReactionFrame(
      drizzle({ client }),
      scope,
      8,
      policy,
      async (operation) => {
        guards.push(operation);
      },
    );
    await assertRejects({
      given: 'missing, foreign or mismatched authoritative state',
      should: 'refuse before association/receipt/counter writes',
      actual: () =>
        frame.change({ ...command, active: scenario.active }, digest),
      code: scenario.code,
    });
    assert({
      given: 'a refused reaction operation',
      should: 'never mint an absent-row removal fact or write',
      actual: [
        guards.includes('remove'),
        queries.some((q) => /^(insert|update|delete)/.test(q.query)),
      ],
      expected: [false, false],
    });
  }
});

test('reaction summary authorizes both sides of scoped protected discovery and rejects removed message metadata', async () => {
  const { client, queries } = fakeSql([
    [{ id: command.messageId }],
    [{ reaction: '❤️', count: '2', own: false }],
  ]);
  const { frame, guards } = readableFrame(client);
  const result = await frame.read(command.messageId);
  assert({
    given: 'an authorized current message summary',
    should:
      'bind discovery and aggregate SQL to the actual channel and recheck reading before projection',
    actual: [guards, queries[0]?.params, queries[1]?.params, result],
    expected: [
      ['read', 'read'],
      [command.messageId, scope.channelId],
      [scope.actorId, scope.channelId, command.messageId],
      {
        version: 1,
        channelId: scope.channelId,
        messageId: command.messageId,
        changeVersion: 8,
        replayed: false,
        reactions: [{ reaction: '❤️', count: 2, own: false }],
      },
    ],
  });
  const removed = fakeSql([[]]);
  await assertRejects({
    given: 'a removed message excluded by the actual discovery predicate',
    should: 'refuse counts without querying private reaction metadata',
    actual: () =>
      channelReactionFrame(
        drizzle({ client: removed.client }),
        scope,
        8,
        policy,
        async () => {},
      ).read(command.messageId),
    code: 'NOT_FOUND',
  });
  assert({
    given: 'unavailable message discovery',
    should: 'not read the aggregate',
    actual: removed.queries.length,
    expected: 1,
  });
});

function readableFrame(client: ReturnType<typeof fakeSql>['client']) {
  const guards: string[] = [];
  const frame = channelReactionFrame(
    drizzle({ client }),
    scope,
    8,
    policy,
    async (operation) => {
      guards.push(operation);
    },
  );
  return { frame, guards };
}
