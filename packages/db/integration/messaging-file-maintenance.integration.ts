import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingFileMaintenance } from '../src/messaging-files/maintenance';
import {
  withFileProofFrame,
  fileDatabaseProofPolicy,
} from './messaging-files.test-support';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('trusted maintenance expires real pending reservations and releases quota only after actual private filesystem ACK', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const directory = await mkdtemp(join(tmpdir(), 'daisy-file-maintenance-'));
  const objectKey = createId();
  const [firstId, secondId] = [createId(), createId()].sort();
  try {
    const file = await withFileProofFrame(database, fixture, (frame) =>
      frame.reserve(
        {
          id: firstId!,
          objectKey,
          requestId: createId(),
          filename: 'notes.pdf',
          mime: 'application/pdf',
          bytes: 60,
        },
        fixture.now,
        fileDatabaseProofPolicy,
      ),
    );
    const later = await withFileProofFrame(database, fixture, (frame) =>
      frame.reserve(
        {
          id: secondId!,
          objectKey: createId(),
          requestId: createId(),
          filename: 'later.pdf',
          mime: 'application/pdf',
          bytes: 20,
        },
        new Date(Date.parse(fixture.now) + 1).toISOString(),
        fileDatabaseProofPolicy,
      ),
    );
    const path = join(directory, objectKey);
    await writeFile(path, 'private pending upload', {
      flag: 'wx',
      mode: 0o600,
    });
    const now = new Date(
      Date.parse(fixture.now) + fileDatabaseProofPolicy.reservationMs + 1,
    ).toISOString();
    const maintenance = createMessagingFileMaintenance(database);
    await assertRejects({
      given: 'real reservation expires but vendor deletion is unavailable',
      should: 'surface outage after expiry while retaining charge',
      actual: () =>
        maintenance.run({
          now,
          maxItems: 1,
          remove: async () => {
            throw createAppError('INFRASTRUCTURE');
          },
        }),
      code: 'INFRASTRUCTURE',
    });
    const [pending] = await client.unsafe(
      'select lifecycle,filename,mime,request_id,message_id,generation::int,reserved_bytes::int from messaging_files where id=$1',
      [file.id],
    );
    assert({
      given: 'unacknowledged expired upload',
      should:
        'scrub metadata and fence retries while retaining physical bytes and quota',
      actual: [
        pending.lifecycle,
        pending.filename,
        pending.mime,
        pending.request_id,
        pending.message_id,
        pending.generation,
        pending.reserved_bytes,
        await Bun.file(path).exists(),
      ],
      expected: ['deleting', null, null, null, null, 2, 60, true],
    });
    const [untouched] = await client.unsafe(
      'select lifecycle,filename,mime,generation::int,reserved_bytes::int from messaging_files where id=$1',
      [later.id],
    );
    assert({
      given: 'two expired reservations in one channel and maxItems one',
      should:
        'leave the later selected-out reservation metadata/generation/charge intact',
      actual: untouched,
      expected: {
        lifecycle: 'reserved',
        filename: 'later.pdf',
        mime: 'application/pdf',
        generation: 1,
        reserved_bytes: 20,
      },
    });
    await maintenance.run({
      now,
      maxItems: 1,
      remove: async (key) => {
        if (key !== objectKey)
          throw new Error('Foreign maintenance fixture object refused');
        await rm(path, { force: true });
        if (await Bun.file(path).exists())
          throw createAppError('INFRASTRUCTURE');
      },
    });
    const [done] = await client.unsafe(
      'select lifecycle,deleted_at from messaging_files where id=$1',
      [file.id],
    );
    assert({
      given: 'actual private filesystem acknowledgement',
      should: 'release charge by marking deleted only after bytes disappear',
      actual: [
        done.lifecycle,
        Boolean(done.deleted_at),
        await Bun.file(path).exists(),
      ],
      expected: ['deleted', true, false],
    });
  } finally {
    try {
      await client.unsafe('delete from messaging_files where channel_id=$1', [
        fixture.channelId,
      ]);
      await fixture.cleanup();
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 30000);
