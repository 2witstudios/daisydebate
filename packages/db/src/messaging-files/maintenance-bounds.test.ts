import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { fileRow, fileFrameNow, fileFrameCommand } from './frame.test-support';
import { fakeSql } from '../index.test-support';
import { drizzle } from 'drizzle-orm/bun-sql';
import { messagingAuthorityFixture } from '../messaging/social.test-support';
import { createMessagingFileMaintenance } from './maintenance';
setupRitewayBun();
test('one poison object cannot starve healthy physical deletion later in the same bounded batch', async () => {
  const nextKey = 'n'.repeat(24);
  const { client, queries } = fakeSql([
    [],
    [
      { kind: 'file', key: fileFrameCommand.id },
      { kind: 'erased', key: nextKey },
    ],
    fileRow({
      lifecycle: 'deleting',
      filename: null,
      mime: null,
      requestId: null,
    }),
    [[nextKey, 60]],
    [],
  ]);
  const removed: string[] = [];
  await assertRejects({
    given: 'a poison file before a healthy erased-subject object',
    should: 'surface the run failure after attempting every bounded deletion',
    actual: () =>
      createMessagingFileMaintenance(drizzle({ client })).run({
        now: fileFrameNow,
        maxItems: 2,
        remove: async (key) => {
          removed.push(key);
          if (key === fileFrameCommand.objectKey)
            throw createAppError('INFRASTRUCTURE');
        },
      }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'one failed physical ACK and one successful ACK',
    should:
      'retain the failed charge and release only the healthy opaque intent',
    actual: [
      removed,
      queries
        .filter((q) => /^(update|delete)/.test(q.query))
        .map((q) => q.params),
    ],
    expected: [[fileFrameCommand.objectKey, nextKey], [[nextKey]]],
  });
});

test('a crowded channel expires only the globally selected reservation batch', async () => {
  const fact = messagingAuthorityFixture();
  const actorId = 'a'.repeat(24),
    userId = 'u'.repeat(24),
    selected = 's'.repeat(24);
  const selectedOwner = { fileId: selected, actorId, userId };
  const accounts = [
    { actorId, userId },
    { actorId: 'b'.repeat(24), userId: 'v'.repeat(24) },
  ].map((binding) => ({
    ...binding,
    member: true,
    erased: false,
    revision: 1,
  }));
  const { client, queries } = fakeSql([
    [{ fileId: selected, channelId: fact.channelId }],
    [selectedOwner],
    [{ fact }],
    accounts,
    [{ locked: true }],
    [{ fact }],
    [selectedOwner],
    [],
    [],
  ]);
  const result = await createMessagingFileMaintenance(drizzle({ client })).run({
    now: fileFrameNow,
    maxItems: 1,
    remove: async () => {
      throw new Error('No deletion selected');
    },
  });
  const discovery = queries[0]!,
    expiry = queries.find((q) => q.query.includes('update messaging_files'));
  assert({
    given:
      'one selected file from a channel containing arbitrary later pending reservations',
    should:
      'bound discovery and every owner reread/expiry predicate to the selected file',
    actual: [
      result,
      discovery.query.includes('distinct'),
      discovery.params.at(-1),
      queries
        .filter((q) => q.query.includes('join actors'))
        .every(
          (q) =>
            q.params.includes(selected) &&
            q.query.includes('f.id in (') &&
            !q.query.includes('::text[]'),
        ),
      expiry?.params.includes(selected),
    ],
    expected: [{ expiredChannels: 1, acknowledged: 0 }, false, 1, true, true],
  });
});
