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
  input,
  pair,
  command,
  request,
  budget,
} from './social-request.test-support';
test('a new admitted DM persists pending authority once and emits only content-free invalidations', async () => {
  const { client, queries } = fakeSql([
    [],
    budget(),
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
      inserts.map((entry) => entry.query.match(/insert into "?([a-z_]+)/)?.[1]),
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
    const { client, queries } = fakeSql([[request(state)], budget(), []]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    assert({
      given: `an existing ${state} DM`,
      should:
        'return the durable channel and spend the new request receipt without creating channels or renewing pair state',
      actual: [
        await frame.commitDmRequest(command),
        queries.map((entry) => entry.query.split(/\s/)[0]),
        queries.at(-1)?.params.includes(channelId),
      ],
      expected: [{ channelId, state }, ['select', 'select', 'insert'], true],
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
for (const [facts, code] of [
  [[], 'INFRASTRUCTURE'],
  [budget({ declined: true }), 'AUTHORIZATION'],
  [budget({ daily: 20 }), 'RATE_LIMIT'],
  [budget({ hourly: 5 }), 'RATE_LIMIT'],
] as const)
  test(`a ${code} budget read refuses before any write`, async () => {
    const { client, queries } = fakeSql([[], facts]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    await assertRejects({
      given:
        'missing budget facts, a decline block, a spent day or a spent unrelated hour',
      should:
        'refuse a block as a block is refused, and an exhausted budget as a rate limit',
      actual: () => frame.commitDmRequest(command),
      code,
    });
    assert({
      given: 'the refused request',
      should: 'perform reads only, leaving no pair history or ledger row',
      actual: queries.every((entry) => entry.query.startsWith('select')),
      expected: true,
    });
  });
test('a request to a related account is not held to the unrelated hour', async () => {
  const { client, queries } = fakeSql([
    [request('accepted')],
    budget({ unrelated: false, hourly: 5, daily: 19 }),
    [],
  ]);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  await frame.commitDmRequest(command);
  const ledger = queries.find((entry) =>
    entry.query.startsWith('insert into messaging_social_commands'),
  );
  assert({
    given:
      'a request to a DM partner inside the day budget with the unrelated hour spent',
    should: 'spend the request and record it as related',
    actual: ledger?.params.at(-1),
    expected: false,
  });
});
test('malformed time or limits never query the budget', async () => {
  for (const next of [
    { ...command, now: 'invalid' },
    { ...command, limits: { ...command.limits, daily: 0 } },
  ]) {
    const { client, queries } = fakeSql([[]]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    await assertRejects({
      given: 'an invalid time or a zero budget',
      should: 'refuse without counts or writes',
      actual: () => frame.commitDmRequest(next),
      code: 'VALIDATION',
    });
    assert({
      given: 'the refused request',
      should: 'read only its existing pair',
      actual: queries.length,
      expected: 1,
    });
  }
});
