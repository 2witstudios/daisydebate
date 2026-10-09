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
import { rejectedBy } from './constraint-helpers';
import {
  withFileProofFrame,
  fileDatabaseProofPolicy as policy,
} from './messaging-files.test-support';
import {
  acknowledgeFileDeletion,
  eraseSubjectFiles,
  exportSubjectFiles,
  chargedFileBytes,
  acknowledgeErasedFileDeletion,
} from '../src/messaging-files';
import type { FileFrame } from '../src/messaging-files';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('file quota is fenced and remains charged until actual object deletion acknowledgement', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  try {
    await client.unsafe('select id from messaging_files limit 0');
    await client.unsafe(
      'select object_key from messaging_file_deletion_intents limit 0',
    );
  } catch (error) {
    await client.close();
    throw error;
  }
  const fixture = await createMessagingTestFixture(client);
  const { channelId, actorId, otherActorId, now } = fixture;
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
  ) => withFileProofFrame(database, fixture, work, denied);
  let erasedKey: string | null = null;
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
    const messageId = createId();
    await client.unsafe(
      "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,1,1,'Attachment message',$4)",
      [messageId, channelId, actorId, now],
    );
    await client.unsafe(
      'update messaging_channels set message_sequence=1,change_version=1 where id=$1',
      [channelId],
    );
    assert({
      given: 'an active file with its MIME removed directly in SQL',
      should: 'reject unknown-valued metadata instead of accepting SQL NULL',
      actual: await rejectedBy(() =>
        client.unsafe('update messaging_files set mime=null where id=$1', [
          token.fileId,
        ]),
      ),
      expected: 'messaging_files_metadata',
    });
    await withFrame((f) => f.quarantine(token, 40, now));
    const renewed = await withFrame((f) => f.renew(token, now, policy));
    await assertRejects({
      given: 'an old scanner callback after reservation generation renewal',
      should: 'refuse late attachment',
      actual: () => withFrame((f) => f.finalize(token, messageId, now, policy)),
      code: 'CONFLICT',
    });
    const liveToken = { fileId: renewed.id, generation: renewed.generation };
    await withFrame((f) => f.finalize(liveToken, messageId, now, policy));
    await withFrame((f) =>
      f.finalize(liveToken, messageId, '2026-10-09T18:00:02.000Z', policy),
    );
    await assertRejects({
      given: 'a revoked reader with a known attached file identifier',
      should: 'refuse before metadata replay',
      actual: () => withFrame((f) => f.access(liveToken, now, policy), true),
      code: 'AUTHORIZATION',
    });
    await client.unsafe(
      'update messaging_channels set authority_revision=authority_revision+1 where id=$1',
      [channelId],
    );
    const access = await withFrame((f) => f.access(liveToken, now, policy));
    assert({
      given: 'a surviving authorized member after authority revision changes',
      should: 'retain shared attached access without deleting the object',
      actual: { messageId: access.messageId, storedBytes: access.storedBytes },
      expected: { messageId, storedBytes: 40 },
    });
    await withFrame((f) => f.cancel(liveToken));
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
    erasedKey = next.objectKey;
    const chargedBefore = await chargedFileBytes(database);
    await database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
      const exported = await exportSubjectFiles(tx, otherActorId);
      assert({
        given: 'a different subject exporting',
        should: 'exclude the author reservation',
        actual: exported.messaging_files.length,
        expected: 0,
      });
      await tx.execute(
        sql`select low_actor_id from messaging_contact_pairs where low_actor_id=${fixture.low} and high_actor_id=${fixture.high} for update`,
      );
      await tx.execute(
        sql`select id from messaging_channels where id=${channelId} for update`,
      );
      await eraseSubjectFiles(tx, actorId);
    });
    assert({
      given: 'subject erasure before vendor availability',
      should:
        'remove every personal file row while retaining charged unlinked intent',
      actual: {
        rows: Number(
          (
            await client.unsafe(
              'select count(*) as count from messaging_files where owner_actor_id=$1',
              [actorId],
            )
          )[0]!.count,
        ),
        bytes: await chargedFileBytes(database),
      },
      expected: { rows: 0, bytes: chargedBefore },
    });
    await assertRejects({
      given: 'vendor outage after local erasure',
      should: 'retain unlinked charged intent',
      actual: () =>
        acknowledgeErasedFileDeletion(database, next.objectKey, async () => {
          throw createAppError('INFRASTRUCTURE');
        }),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'failed erased-object acknowledgement',
      should: 'retain charged storage independently of subject associations',
      actual: await chargedFileBytes(database),
      expected: chargedBefore,
    });
    await acknowledgeErasedFileDeletion(
      database,
      next.objectKey,
      async () => {},
    );
    assert({
      given: 'actual erased-object deletion acknowledgement',
      should: 'remove unlinked intent and release storage charge',
      actual: await chargedFileBytes(database),
      expected: '0',
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
    if (erasedKey)
      await client.unsafe(
        'delete from messaging_file_deletion_intents where object_key=$1',
        [erasedKey],
      );
    await client.unsafe('delete from messaging_files where channel_id=$1', [
      channelId,
    ]);
    await fixture.cleanup();
    await client.close();
  }
}, 30000);
