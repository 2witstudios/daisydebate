import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fakeSql } from '../index.test-support';
import { expireChannelFiles } from './cleanup';
import {
  fileFrameScope as scope,
  fileFrameNow as now,
  fileFrameCommand as command,
} from './frame.test-support';
setupRitewayBun();

test('selected expiry retains pending/channel/time fences and only selected file IDs', async () => {
  const { client, queries } = fakeSql([[]]);
  const ids = Object.freeze([command.id, 'g'.repeat(24)]);
  await expireChannelFiles(drizzle({ client }), scope.channelId, now, ids);
  const { query, params } = queries[0]!;
  assert({
    given: 'two globally selected reservations after canonical parent locks',
    should:
      'bind only those IDs while retaining channel, pending and expiry fences',
    actual: [
      params,
      query.includes("lifecycle in ('reserved','quarantined')"),
      query.includes('expires_at <= $2'),
      query.includes('and id in ($3, $4)'),
    ],
    expected: [[scope.channelId, new Date(now), ...ids], true, true, true],
  });
  assert({
    given: 'selected pending expiration',
    should:
      'scrub personal metadata and advance generation without releasing byte charge',
    actual: [
      query.includes("lifecycle = 'deleting'"),
      ['filename', 'mime', 'request_id', 'message_id'].every((field) =>
        query.includes(`${field} = null`),
      ),
      query.includes('generation = generation + 1'),
      /(?:reserved_bytes|stored_bytes)\s*=/u.test(query),
      queries.length,
    ],
    expected: [true, true, true, false, 1],
  });
});

test('unscoped channel expiry retains the existing full-channel behavior', async () => {
  const { client, queries } = fakeSql([[]]);
  await expireChannelFiles(drizzle({ client }), scope.channelId, now);
  assert({
    given: 'the existing storage consumer without a selected file list',
    should: 'keep the channel and time binds without adding an ID filter',
    actual: [queries[0]!.params, queries[0]!.query.includes('and id in')],
    expected: [[scope.channelId, new Date(now)], false],
  });
});

test('invalid bounded expiry lists refuse before executing any SQL', async () => {
  const { client, queries } = fakeSql([]);
  const tx = drizzle({ client });
  for (const ids of [
    [],
    [command.id, command.id],
    ['not-an-id'],
    [command.id, ''],
    new Array<string>(1),
  ])
    await assertRejects({
      given: 'an empty, duplicate, invalid or sparse selected reservation list',
      should: 'refuse rather than broaden expiry scope',
      actual: () => expireChannelFiles(tx, scope.channelId, now, ids),
      code: 'VALIDATION',
    });
  assert({
    given: 'all invalid bounded lists',
    should: 'leave durable reservations unchanged',
    actual: queries.length,
    expected: 0,
  });
});

test('invalid channel or clock still refuses a valid selected list', async () => {
  const { client, queries } = fakeSql([]);
  for (const [channelId, at] of [
    ['', now],
    [scope.channelId, 'invalid-time'],
  ] as const)
    await assertRejects({
      given: 'invalid scope or expiry time with a valid selected file',
      should: 'refuse before SQL',
      actual: () =>
        expireChannelFiles(drizzle({ client }), channelId, at, [command.id]),
      code: 'VALIDATION',
    });
  assert({
    given: 'invalid channel/time',
    should: 'leave state unchanged',
    actual: queries.length,
    expected: 0,
  });
});
