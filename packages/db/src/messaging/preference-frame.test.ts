import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { channelPreferenceFrame } from './preference-frame';
setupRitewayBun();
const scope = { channelId: 'c'.repeat(24), actorId: 'a'.repeat(24) };
const choices = {
  following: false,
  hidden: true,
  notificationLevel: 'none' as const,
};
test('current preference reading counts only unread surviving contributions without making following a grant', async () => {
  const { client, queries } = fakeSql([
    [[false, true, 'none', 3]],
    [[2]],
    [[false, true, 'none', 3]],
  ]);
  let checked = 0;
  const frame = channelPreferenceFrame(drizzle({ client }), scope, async () => {
    checked += 1;
  });
  const read = await frame.read();
  const updated = await frame.update(choices);
  assert({
    given: 'eligible but unfollowed state and explicit mute selection',
    should:
      'return actual read progress, scoped surviving peer unread count and preserve progress on update',
    actual: [
      read,
      updated,
      checked,
      queries[1]?.params.includes(scope.actorId),
      queries[1]?.query.includes('removed_at'),
    ],
    expected: [
      { state: { ...choices, readSequence: 3 }, unread: 2 },
      { ...choices, readSequence: 3 },
      2,
      true,
      true,
    ],
  });
  assert({
    given: 'preference upsert SQL',
    should: 'update selections only and never reset a concurrent read marker',
    actual: queries[2]?.query
      .split('do update set')[1]
      ?.split('returning')[0]
      ?.includes('read_sequence'),
    expected: false,
  });
});
test('preference absence is not a fabricated row and current refusal precedes every SQL operation', async () => {
  const { client, queries } = fakeSql([[], [[0]]]);
  const database = drizzle({ client });
  const read = await channelPreferenceFrame(
    database,
    scope,
    async () => {},
  ).read();
  assert({
    given: 'no saved state',
    should: 'return honest absence without writing defaults',
    actual: [read, queries.some(({ query }) => query.includes('insert'))],
    expected: [{ state: null, unread: 0 }, false],
  });
  const before = queries.length;
  const denied = channelPreferenceFrame(database, scope, async () => {
    throw createAppError('NOT_FOUND');
  });
  for (const actual of [() => denied.read(), () => denied.update(choices)])
    await assertRejects({
      given: 'revoked reading authority even when previously followed',
      should: 'refuse the protected preference operation',
      actual,
      code: 'NOT_FOUND',
    });
  assert({
    given: 'fresh refusal',
    should: 'leave the driver untouched',
    actual: queries.length,
    expected: before,
  });
});
