import { createAppError } from '@daisy/errors';
import { messagingAuthorityFixture } from '../messaging/social.test-support';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createMessagingFileMaintenance } from './maintenance';
import { fakeSql } from '../index.test-support';
import { fileRow, fileFrameNow, fileFrameCommand } from './frame.test-support';
setupRitewayBun();
test('bounded cleanup acknowledges actual vendor deletion before releasing charged files', async () => {
  const { client, queries } = fakeSql([
    [],
    [{ kind: 'file', key: fileFrameCommand.id }],
    fileRow({
      lifecycle: 'deleting',
      filename: null,
      mime: null,
      requestId: null,
    }),
    [],
  ]);
  const removed: string[] = [];
  const result = await createMessagingFileMaintenance(drizzle({ client })).run({
    now: fileFrameNow,
    maxItems: 1,
    remove: async (key) => {
      assert({
        given: 'vendor deletion still pending',
        should: 'keep charge until acknowledgement',
        actual: queries.some((q) => q.query.startsWith('update')),
        expected: false,
      });
      removed.push(key);
    },
  });
  assert({
    given: 'physical acknowledgement',
    should: 'release exactly the discovered deleting object',
    actual: [result, removed, queries.at(-1)?.params[0]],
    expected: [
      { expiredChannels: 0, acknowledged: 1 },
      [fileFrameCommand.objectKey],
      'deleted',
    ],
  });
});
test('invalid discovery bounds refuse before touching SQL or private objects', async () => {
  const { client, queries } = fakeSql([]);
  const maintenance = createMessagingFileMaintenance(drizzle({ client }));
  for (const maxItems of [0, 1.5, 65536])
    await assertRejects({
      given: 'invalid technical discovery bound',
      should: 'refuse before I/O',
      actual: () =>
        maintenance.run({
          now: fileFrameNow,
          maxItems,
          remove: async () => {
            throw new Error('Unexpected vendor call');
          },
        }),
      code: 'VALIDATION',
    });
  assert({
    given: 'all invalid bounds',
    should: 'issue no SQL',
    actual: queries.length,
    expected: 0,
  });
});

test('failed physical deletion leaves file and unlinked erasure charges intact', async () => {
  for (const erased of [false, true]) {
    const selected = erased
      ? [[fileFrameCommand.objectKey, 60]]
      : fileRow({
          lifecycle: 'deleting',
          filename: null,
          mime: null,
          requestId: null,
        });
    const { client, queries } = fakeSql([
      [],
      [
        {
          kind: erased ? 'erased' : 'file',
          key: erased ? fileFrameCommand.objectKey : fileFrameCommand.id,
        },
      ],
      selected,
    ]);
    const run = createMessagingFileMaintenance(drizzle({ client }));
    await assertRejects({
      given: 'private store cannot acknowledge deletion',
      should: 'surface failure and retain charged state',
      actual: () =>
        run.run({
          now: fileFrameNow,
          maxItems: 1,
          remove: async () => {
            throw createAppError('INFRASTRUCTURE');
          },
        }),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'unacknowledged private object',
      should: 'perform no charge-releasing write',
      actual: queries.some((q) => /^(update|delete)/.test(q.query)),
      expected: false,
    });
  }
});

test('expired reservations fence all discovered owners and reread after account/channel waits', async () => {
  const fact = messagingAuthorityFixture();
  const owner = { actorId: 'a'.repeat(24), userId: 'u'.repeat(24) };
  const accounts = [
    owner,
    { actorId: 'b'.repeat(24), userId: 'v'.repeat(24) },
  ].map((binding) => ({
    ...binding,
    member: true,
    erased: false,
    revision: 1,
  }));
  for (const changed of [false, true]) {
    const { client, queries } = fakeSql([
      [{ id: fact.channelId }],
      [owner],
      [{ fact }],
      accounts,
      [{ locked: true }],
      [{ fact }],
      [changed ? { actorId: 'x'.repeat(24), userId: 'y'.repeat(24) } : owner],
      ...(changed ? [] : [[]]),
      [],
    ]);
    const result = await createMessagingFileMaintenance(
      drizzle({ client }),
    ).run({
      now: fileFrameNow,
      maxItems: 1,
      remove: async () => {
        throw new Error('No deletions expected');
      },
    });
    const update = queries.find((q) =>
      q.query.includes('update messaging_files'),
    );
    assert({
      given: changed
        ? 'new expired owner after the ordered fence waits'
        : 'same expired owner under fresh canonical locks',
      should: changed
        ? 'defer expiry without touching unfenced owner rows'
        : 'expire only due pending lifecycles after the fence',
      actual: [
        result.expiredChannels,
        Boolean(update),
        queries.some((q) => q.query.includes('daisy_messaging_channel_fence')),
      ],
      expected: [changed ? 0 : 1, !changed, true],
    });
    if (update)
      assert({
        given: 'fresh expiry write',
        should: 'exclude attached/deleting/deleted content',
        actual: update.query.includes(
          "lifecycle in ('reserved','quarantined') and expires_at <=",
        ),
        expected: true,
      });
  }
});

test('unlinked erasure intent is removed only after exact private object acknowledgement', async () => {
  const { client, queries } = fakeSql([
    [],
    [{ kind: 'erased', key: fileFrameCommand.objectKey }],
    [[fileFrameCommand.objectKey, 60]],
    [],
  ]);
  const keys: string[] = [];
  await createMessagingFileMaintenance(drizzle({ client })).run({
    now: fileFrameNow,
    maxItems: 1,
    remove: async (key) => {
      keys.push(key);
      assert({
        given: 'unlinked object pending acknowledgement',
        should: 'keep its intent and charge',
        actual: queries.some((q) => q.query.startsWith('delete')),
        expected: false,
      });
    },
  });
  assert({
    given: 'acknowledged erasure object',
    should: 'delete only its opaque intent without subject association',
    actual: [
      keys,
      queries
        .at(-1)
        ?.query.includes('delete from "messaging_file_deletion_intents"'),
      queries.at(-1)?.params,
    ],
    expected: [
      [fileFrameCommand.objectKey],
      true,
      [fileFrameCommand.objectKey],
    ],
  });
});
