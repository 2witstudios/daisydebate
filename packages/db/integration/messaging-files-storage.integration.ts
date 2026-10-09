import { SQL } from 'bun';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingPrivacyAdopter } from '../src/messaging';
import {
  exportPrivacySubject,
  messagingPrivacyExpectedColumns,
} from '../src/privacy';
import {
  acknowledgeFileDeletion,
  expireChannelFiles,
  acknowledgeErasedFileDeletion,
  chargedFileBytes,
} from '../src/messaging-files';
import {
  withFileProofFrame,
  withFileProofTransaction,
  fileDatabaseProofPolicy as policy,
} from './messaging-files.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('real private storage deletion acknowledgement alone releases durable quota and erased intents', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  // Mandatory schema/function prerequisites before any fixture is created.
  try {
    await client.unsafe(
      'select public.daisy_authorization_accounts(null::text[],null::text,false) limit 0',
    );
    await client.unsafe(
      'select object_key from messaging_file_deletion_intents limit 0',
    );
  } catch (error) {
    await client.close();
    throw error;
  }
  const fixture = await createMessagingTestFixture(client);
  const directory = await mkdtemp(join(tmpdir(), 'daisy-file-db-proof-'));
  const keys: string[] = [];
  const reserve = async () => {
    const objectKey = createId();
    keys.push(objectKey);
    const row = await withFileProofFrame(database, fixture, (frame) =>
      frame.reserve(
        {
          id: createId(),
          objectKey,
          requestId: createId(),
          filename: 'notes.pdf',
          mime: 'application/pdf',
          bytes: 60,
        },
        fixture.now,
        policy,
      ),
    );
    await writeFile(join(directory, objectKey), 'Private quarantined bytes', {
      mode: 0o600,
      flag: 'wx',
    });
    return { row, token: { fileId: row.id, generation: row.generation } };
  };
  const remove = async (key: string) => {
    await rm(join(directory, key), { force: true });
    if (await Bun.file(join(directory, key)).exists())
      throw createAppError('INFRASTRUCTURE');
  };
  try {
    const first = await reserve();
    await withFileProofTransaction(database, fixture, (tx) =>
      expireChannelFiles(
        tx,
        fixture.channelId,
        new Date(
          Date.parse(fixture.now) + policy.reservationMs + 1,
        ).toISOString(),
      ),
    );
    await assertRejects({
      given: 'abandoned upload expired under its complete maintenance fence',
      should: 'refuse the stale completion before acknowledgement',
      actual: () =>
        withFileProofFrame(database, fixture, (frame) =>
          frame.quarantine(first.token, 20, fixture.now),
        ),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given:
        'private object still exists and vendor acknowledgement is unavailable',
      should: 'retain durable charged quota',
      actual: () =>
        acknowledgeFileDeletion(
          database,
          first.row.id,
          fixture.now,
          async () => {
            throw createAppError('INFRASTRUCTURE');
          },
        ),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'unacknowledged abandoned upload cleanup',
      should: 'retain real bytes and their charge',
      actual: {
        exists: await Bun.file(join(directory, first.row.objectKey)).exists(),
        charged: await chargedFileBytes(database),
      },
      expected: { exists: true, charged: '60' },
    });
    await acknowledgeFileDeletion(database, first.row.id, fixture.now, remove);
    assert({
      given: 'physical private object removal acknowledged',
      should: 'release quota only after the object is absent',
      actual: {
        exists: await Bun.file(join(directory, first.row.objectKey)).exists(),
        charged: await chargedFileBytes(database),
      },
      expected: { exists: false, charged: '0' },
    });
    const peerKey = createId();
    keys.push(peerKey);
    const peerFixture = {
      ...fixture,
      actorId: fixture.otherActorId,
      userId: fixture.otherUserId,
      otherActorId: fixture.actorId,
    };
    const peerFile = await withFileProofFrame(database, peerFixture, (frame) =>
      frame.reserve(
        {
          id: createId(),
          objectKey: peerKey,
          requestId: createId(),
          filename: 'peer.pdf',
          mime: 'application/pdf',
          bytes: 20,
        },
        fixture.now,
        policy,
      ),
    );
    await writeFile(join(directory, peerKey), 'Other private bytes', {
      mode: 0o600,
      flag: 'wx',
    });
    const next = await reserve();
    const adoption = {
      requiredAdopters: [
        {
          id: 'messaging',
          phase: 'before-auth' as const,
          expectedColumns: messagingPrivacyExpectedColumns,
        },
      ],
      adopters: [createMessagingPrivacyAdopter()],
    };
    const exported = await exportPrivacySubject(
      database,
      { actorId: fixture.actorId, userId: fixture.userId },
      adoption,
    );
    const peerExport = await exportPrivacySubject(
      database,
      { actorId: fixture.otherActorId, userId: fixture.otherUserId },
      adoption,
    );
    const ownFile = exported.messaging_files!.find(
      (row) => row.id === next.row.id,
    )!;
    assert({
      given: 'canonical gated privacy export for two subjects',
      should:
        'export only own declared metadata and exclude the private deletion key',
      actual: {
        filename: ownFile.filename,
        privateKey: Object.hasOwn(ownFile, 'object_key'),
        peerHasSubjectFile: peerExport.messaging_files!.some(
          (row) => row.id === next.row.id,
        ),
        peerHasOwnFile: peerExport.messaging_files!.some(
          (row) => row.id === peerFile.id,
        ),
      },
      expected: {
        filename: 'notes.pdf',
        privateKey: false,
        peerHasSubjectFile: false,
        peerHasOwnFile: true,
      },
    });
    await fixture.eraseSubject(fixture.actorId);
    const associations = await client.unsafe(
      'select id from messaging_files where owner_actor_id=$1',
      [fixture.actorId],
    );
    const intents = await client.unsafe(
      'select * from messaging_file_deletion_intents where object_key=$1',
      [next.row.objectKey],
    );
    assert({
      given: 'canonical subject erasure before storage acknowledgement',
      should:
        'unlink every personal association and keep only minimal deletion work',
      actual: {
        associations: associations.length,
        intentFields: Object.keys(intents[0]!).sort(),
        exists: await Bun.file(join(directory, next.row.objectKey)).exists(),
        charged: await chargedFileBytes(database),
      },
      expected: {
        associations: 0,
        intentFields: ['charged_bytes', 'object_key'],
        exists: true,
        charged: '80',
      },
    });
    const peerRows = await client.unsafe(
      'select lifecycle from messaging_files where id=$1',
      [peerFile.id],
    );
    assert({
      given: 'erasure targets only the first subject',
      should: 'preserve another author private file association and object',
      actual: {
        lifecycle: peerRows[0]!.lifecycle,
        exists: await Bun.file(join(directory, peerKey)).exists(),
      },
      expected: { lifecycle: 'reserved', exists: true },
    });
    await acknowledgeErasedFileDeletion(database, next.row.objectKey, remove);
    await acknowledgeErasedFileDeletion(database, next.row.objectKey, remove);
    assert({
      given: 'physical erased-object acknowledgement and idempotent retry',
      should: 'release only its own intent charge and preserve the peer charge',
      actual: {
        exists: await Bun.file(join(directory, next.row.objectKey)).exists(),
        charged: await chargedFileBytes(database),
      },
      expected: { exists: false, charged: '20' },
    });
  } finally {
    for (const key of keys)
      await client.unsafe(
        'delete from messaging_file_deletion_intents where object_key=$1',
        [key],
      );
    await client.unsafe('delete from messaging_files where channel_id=$1', [
      fixture.channelId,
    ]);
    await fixture.cleanup();
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
