import { addMs } from '@daisy/clock';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingFileCleanup } from '../src/messaging/file-cleanup';
import { expireChannelFiles } from '../src/messaging-files/cleanup';
import { createMessagingTestFixture } from '../src/testing';
import {
  fileDatabaseProofPolicy as policy,
  withFileProofFrame,
} from './messaging-files.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('selected and unscoped pending expiry leave unrelated reservations untouched', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const otherRoom = await createMessagingTestFixture(client);
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const reserve = (owner: typeof fixture, at: string) =>
    withFileProofFrame(database, owner, (frame) =>
      frame.reserve(
        {
          id: createId(),
          objectKey: createId(),
          requestId: createId(),
          filename: 'pending.pdf',
          mime: 'application/pdf',
          bytes: 15,
        },
        at,
        { ...policy, maxStoredFiles: 3 },
      ),
    );
  const channelId = fixture.channelId;
  const now = addMs(fixture.now, policy.reservationMs);
  try {
    const selected = await reserve(fixture, fixture.now);
    const other = await reserve(fixture, fixture.now);
    const future = await reserve(fixture, addMs(fixture.now, 1000));
    const foreign = await reserve(otherRoom, fixture.now);
    statements.length = 0;
    for (const ids of [
      [],
      [selected.id, selected.id],
      ['not-an-id'],
      [selected.id, ''],
      new Array<string>(1),
    ])
      await assertRejects({
        given: 'malformed selected reservation IDs',
        should: 'refuse without widening the selection',
        actual: () => expireChannelFiles(database, channelId, now, ids),
        code: 'VALIDATION',
      });
    for (const [id, at] of [
      ['', now],
      [channelId, 'invalid-time'],
    ] as const)
      await assertRejects({
        given: 'invalid channel or clock with a valid selection',
        should: 'refuse before expiry SQL',
        actual: () => expireChannelFiles(database, id, at, [selected.id]),
        code: 'VALIDATION',
      });
    const invalidSql = statements.length;
    const read = async () =>
      Promise.all(
        [selected, other, future, foreign].map(
          async ({ id }) =>
            (
              await client`select lifecycle, generation::int as generation, reserved_bytes::int as bytes, filename from messaging_files where id=${id}`
            )[0],
        ),
      );
    await expireChannelFiles(database, channelId, now, [
      selected.id,
      future.id,
      foreign.id,
    ]);
    const scoped = await read();
    await expireChannelFiles(database, channelId, now);
    const pending = {
      lifecycle: 'reserved',
      generation: 1,
      bytes: 15,
      filename: 'pending.pdf',
    };
    const deleting = {
      lifecycle: 'deleting',
      generation: 2,
      bytes: 15,
      filename: null,
    };
    assert({
      given:
        'one selected and one unselected due file, a future file, and a foreign channel file',
      should:
        'refuse invalid input without SQL, expire only the selected due file, and then expire other due files in the channel without releasing charge',
      actual: [invalidSql, scoped, await read()],
      expected: [
        0,
        [deleting, pending, pending, pending],
        [deleting, deleting, pending, pending],
      ],
    });
  } finally {
    await client`delete from messaging_files where channel_id in (${channelId}, ${otherRoom.channelId})`;
    await otherRoom.cleanup();
    await fixture.cleanup();
    await client.close();
  }
});

test('pending cleanup holds its fence and changes only the authorized file generation', async () => {
  const client = new SQL(databaseUrl);
  const observer = new SQL(databaseUrl, { max: 1 });
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { actorId, userId, channelId } = fixture;
  const scope = { actorId, userId, channelId };
  try {
    for (const original of ['reserved', 'quarantined'] as const) {
      const token = await withFileProofFrame(
        database,
        fixture,
        async (frame) => {
          const reserved = await frame.reserve(
            {
              id: createId(),
              objectKey: createId(),
              requestId: createId(),
              filename: 'notes.pdf',
              mime: 'application/pdf',
              bytes: 25,
            },
            fixture.now,
            policy,
          );
          const token = {
            fileId: reserved.id,
            generation: reserved.generation,
          };
          if (original === 'reserved') return token;
          await frame.quarantine(token, 20, fixture.now);
          return token;
        },
      );
      const row = async () =>
        (
          await observer`select lifecycle, generation::int as generation from messaging_files where id=${token.fileId}`
        )[0];
      let deny = true;
      const cleanup = createMessagingFileCleanup({
        database,
        authorize: async (tx, received, { fact, accounts }) => {
          const [channel] = await tx.execute(
            sql`select authority_revision::float8 as revision from messaging_channels where id=${channelId}`,
          );
          let blocked: string | undefined;
          try {
            await observer`select id from messaging_files where id=${token.fileId} for update nowait`;
          } catch (error) {
            blocked = (error as { errno?: string }).errno;
          }
          assert({
            given: 'the cleanup authorization callback',
            should:
              'receive the owner scope and the fenced file and channel at their current revision',
            actual: [
              received,
              fact.fileId,
              fact.generation,
              fact.channel.revision,
              accounts.some((account) => account?.actorId === actorId),
              blocked,
            ],
            expected: [
              scope,
              token.fileId,
              token.generation,
              channel?.revision,
              true,
              '55P03',
            ],
          });
          if (deny) throw createAppError('AUTHORIZATION');
        },
      });
      await assertRejects({
        given: 'the authorization refusal',
        should: 'reject pending cleanup before updating',
        actual: () => cleanup(scope, token),
        code: 'AUTHORIZATION',
      });
      const afterRefusal = await row();
      deny = false;
      await cleanup(scope, { ...token, generation: token.generation + 1 });
      const afterStale = await row();
      await cleanup(scope, token);
      assert({
        given: `a refused, stale, and allowed cleanup of a ${original} file`,
        should:
          'leave the pending file unchanged until the exact generation is authorized',
        actual: [afterRefusal, afterStale, await row()],
        expected: [
          { lifecycle: original, generation: token.generation },
          { lifecycle: original, generation: token.generation },
          { lifecycle: 'deleting', generation: token.generation + 1 },
        ],
      });
    }
  } finally {
    await client`delete from messaging_files where channel_id=${channelId}`;
    await fixture.cleanup();
    await observer.close();
    await client.close();
  }
});
