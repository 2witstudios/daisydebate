import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { lockAuthorizationActors } from '../src/authorization';
import {
  channelFileFrame,
  acknowledgeFileDeletion,
  eraseSubjectFiles,
  exportSubjectFiles,
} from '../src/messaging-files';
import type { FileFrame, FilePolicy } from '../src/messaging-files';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const policy: FilePolicy = {
  maxFileBytes: 100,
  maxStoredBytes: 100,
  maxStoredFiles: 2,
  maxFilesPerMessage: 1,
  reservationMs: 1000,
  accessMs: 100,
  maxFilenameUnits: 50,
  maxImagePixels: 100,
  serviceMs: 1000,
};

test('file quota is fenced and remains charged until actual object deletion acknowledgement', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  try {
    await client.unsafe('select id from messaging_files limit 0');
  } catch (error) {
    await client.close();
    throw error;
  }
  const fixture = await createMessagingTestFixture(client);
  const { channelId, actorId, userId, otherActorId, now } = fixture;
  const scope = { channelId, actorId, userId };
  const command = () => ({
    id: createId(),
    objectKey: createId(),
    requestId: createId(),
    bytes: 60,
    filename: 'notes.pdf',
    mime: 'application/pdf' as const,
  });
  const withFrame = <T>(
    work: (frame: FileFrame) => Promise<T>,
    denied = false,
  ) =>
    database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [actorId, otherActorId].sort(), {
        maxActors: 2,
      });
      const rows = await tx.execute(
        sql`select id, change_version from messaging_channels where id=${channelId} for update`,
      );
      const counters = {
        channelId,
        changeVersion: Number(rows[0]!.change_version),
      };
      return work(
        channelFileFrame(tx, scope, counters, async () => {
          if (denied) throw createAppError('AUTHORIZATION');
        }),
      );
    });
  try {
    const results = await Promise.allSettled([
      withFrame((f) => f.reserve(command(), now, policy)),
      withFrame((f) => f.reserve(command(), now, policy)),
    ]);
    assert({
      given:
        'two concurrent sixty-byte admissions into a hundred-byte actor quota',
      should: 'commit exactly one reservation',
      actual: results.map((r) => r.status).sort(),
      expected: ['fulfilled', 'rejected'],
    });
    const reservation = results.find((r) => r.status === 'fulfilled')!;
    if (reservation.status !== 'fulfilled')
      throw new Error('Expected reserved object');
    const token = { fileId: reservation.value.id, generation: 1 };
    await assertRejects({
      given: 'current authority revoked before reservation replay',
      should: 'refuse protected metadata',
      actual: () => withFrame((f) => f.reserve(command(), now, policy), true),
      code: 'AUTHORIZATION',
    });
    await withFrame((f) => f.cancel(token));
    await assertRejects({
      given: 'a deleted local association with unacknowledged vendor object',
      should: 'keep its storage quota charged',
      actual: () => withFrame((f) => f.reserve(command(), now, policy)),
      code: 'PAYLOAD_TOO_LARGE',
    });
    await assertRejects({
      given: 'vendor delete unavailable',
      should: 'preserve the pending durable deletion',
      actual: () =>
        acknowledgeFileDeletion(database, token.fileId, now, async () => {
          throw createAppError('INFRASTRUCTURE');
        }),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'failed acknowledgement followed by admission retry',
      should: 'still refuse excess quota',
      actual: () => withFrame((f) => f.reserve(command(), now, policy)),
      code: 'PAYLOAD_TOO_LARGE',
    });
    await acknowledgeFileDeletion(database, token.fileId, now, async () => {});
    const next = await withFrame((f) => f.reserve(command(), now, policy));
    assert({
      given: 'acknowledged object deletion',
      should: 'release quota for new reservation',
      actual: next.reservedBytes,
      expected: 60,
    });
    await database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
      const exported = await exportSubjectFiles(tx, otherActorId);
      assert({
        given: 'a different subject exporting',
        should: 'exclude the author reservation',
        actual: exported.messaging_files.length,
        expected: 0,
      });
      await eraseSubjectFiles(tx, actorId);
    });
    await assertRejects({
      given: 'late completion after subject erasure',
      should: 'never restore association',
      actual: () =>
        withFrame((f) =>
          f.quarantine(
            { fileId: next.id, generation: next.generation },
            30,
            now,
          ),
        ),
      code: 'NOT_FOUND',
    });
  } finally {
    await client.unsafe('delete from messaging_files where channel_id=$1', [
      channelId,
    ]);
    await fixture.cleanup();
    await client.close();
  }
}, 30000);
