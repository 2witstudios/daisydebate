import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingFileCleanup } from '../src/messaging/file-cleanup';
import { createMessagingTestFixture } from '../src/testing';
import {
  fileDatabaseProofPolicy as policy,
  withFileProofFrame,
} from './messaging-files.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

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
