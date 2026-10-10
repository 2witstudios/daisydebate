import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { dmRequestFrame } from './social-request';
setupRitewayBun();
import {
  peerId,
  channelId,
  now,
  input,
  pair,
  command,
  request,
} from './social-request.test-support';
test('a new admitted DM persists pending authority once and emits only content-free invalidations', async () => {
  const { client, queries } = fakeSql([
    [],
    [[0, 0]],
    [],
    [],
    [[1, '9']],
    [],
    [[2, '9']],
    [],
    [[3, '9']],
    [],
    [],
  ]);
  let admitted = 0;
  const frame = dmRequestFrame(drizzle({ client }), input, [pair], async () => {
    admitted += 1;
  });
  const result = await frame.commitDmRequest(command);
  const inserts = queries.filter((entry) =>
    entry.query.startsWith('insert into'),
  );
  const bells = inserts
    .filter((entry) => entry.query.includes('"outbox"'))
    .map((entry) =>
      entry.params.find((value) => typeof value === 'object' && value !== null),
    );
  assert({
    given: 'a fresh fenced pair with available capacity',
    should:
      'persist pending DM authority, creator receipt and thin inbox/channel bells only',
    actual: [
      result,
      admitted,
      inserts.map((entry) => entry.query.match(/insert into "([^"]+)"/)?.[1]),
      bells,
    ],
    expected: [
      { channelId, state: 'pending' },
      1,
      [
        'messaging_channels',
        'messaging_dm_pairs',
        'outbox',
        'outbox',
        'outbox',
        'messaging_social_commands',
      ],
      [
        { kind: 'messaging.inbox.changed' },
        { kind: 'messaging.inbox.changed' },
        { kind: 'channel.changed', channelId, changeVersion: 1 },
      ],
    ],
  });
  assert({
    given: 'durable receipt and private introduction',
    should:
      'bind the exact counterpart and keep introduction out of all notification queries',
    actual: [
      inserts.at(-1)?.params.includes(peerId),
      queries
        .filter((entry) => entry.query.includes('"outbox"'))
        .some((entry) => entry.params.includes(command.introduction)),
    ],
    expected: [true, false],
  });
});
for (const state of ['pending', 'accepted'])
  test(`existing ${state} pair converges without replacing authority`, async () => {
    const { client, queries } = fakeSql([[request(state)], []]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    assert({
      given: `an existing ${state} DM`,
      should:
        'return the durable channel and bind the new request receipt without creating channels or renewing pair state',
      actual: [
        await frame.commitDmRequest(command),
        queries.map((entry) => entry.query.split(' ')[0]),
        queries.at(-1)?.params.includes(channelId),
      ],
      expected: [{ channelId, state }, ['select', 'insert'], true],
    });
  });
test('authority loss, pair ambiguity and policy drift refuse before request mutation', async () => {
  const { client, queries } = fakeSql([]),
    tx = drizzle({ client });
  const denied = dmRequestFrame(tx, input, [pair], async () => {
    throw createAppError('AUTHORIZATION');
  });
  for (const operation of [
    () => denied.readDmRequest(),
    () => denied.commitDmRequest(command),
  ])
    await assertRejects({
      given: 'fresh creation authority refusal',
      should: 'perform no pair discovery or writes',
      actual: operation,
      code: 'AUTHORIZATION',
    });
  await assertRejects({
    given: 'a stale policy revision',
    should: 'refuse before pair read',
    actual: () =>
      dmRequestFrame(tx, input, [pair], async () => {}).commitDmRequest({
        ...command,
        policyRevision: 2,
      }),
    code: 'CONFLICT',
  });
  await assertRejects({
    given: 'more than one pair for a DM command',
    should: 'refuse ambiguous authority',
    actual: () =>
      dmRequestFrame(tx, input, [pair, pair], async () => {}).readDmRequest(),
    code: 'VALIDATION',
  });
  assert({
    given: 'refused admission boundaries',
    should: 'leave driver untouched',
    actual: queries.length,
    expected: 0,
  });
});
for (const counts of [[], [[3, 0]], [[0, 5]]])
  test(`request limits refuse ${JSON.stringify(counts)} before inserts`, async () => {
    const { client, queries } = fakeSql([[], counts]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    await assertRejects({
      given: 'missing count facts or an exhausted pending/new pair bound',
      should: 'refuse without creating personal pair history',
      actual: () => frame.commitDmRequest(command),
      code: 'RATE_LIMIT',
    });
    assert({
      given: 'request refusal',
      should: 'perform reads only',
      actual: queries.every((entry) => entry.query.startsWith('select')),
      expected: true,
    });
  });
test('a recently decided pair preserves cooldown and malformed limits never query counts', async () => {
  for (const [current, next, code] of [
    [request('declined', new Date(now)), command, 'RATE_LIMIT'],
    [
      request('cancelled', new Date('2026-10-09T17:00:00Z')),
      { ...command, now: 'invalid' },
      'VALIDATION',
    ],
    [
      null,
      { ...command, limits: { ...command.limits, maxPending: 0 } },
      'VALIDATION',
    ],
  ] as const) {
    const { client, queries } = fakeSql([current ? [current] : []]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    await assertRejects({
      given: 'cooldown or invalid time/bounds',
      should: 'refuse without counts or writes',
      actual: () => frame.commitDmRequest(next),
      code,
    });
    assert({
      given: 'the refused request',
      should: 'read only its existing pair',
      actual: queries.length,
      expected: 1,
    });
  }
});
