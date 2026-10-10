import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoutes } from '../src/server/routes';
import { createTestApp, origin } from './fixtures';
import {
  messagingRouteActors,
  seedMessagingRouteDm,
  messagingRoutePolicy,
} from './messaging-route.test-support';
import { requireFileScannerPort } from './messaging-files.test-support';
import { messagingFileProofRuntime } from './messaging-file-runtime.test-support';
import { nativeFileResponse } from '../src/features/messaging/files/form-response';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scannerPort = requireFileScannerPort(process.env.CLAMD_TEST_PORT);
test('mounted native multipart attaches scanned private content and peers download only through current canonical authority', async () => {
  const app = createTestApp();
  const { first, second, me, peer } = await messagingRouteActors(app);
  const client = new SQL(databaseUrl),
    channelId = createId(),
    requestId = createId();
  const directory = await mkdtemp(join(tmpdir(), 'daisy-native-files-'));
  const now = app.app.clock.now();
  const routes = createRoutes({
    ...app.app,
    messagingPolicy: messagingRoutePolicy,
    messagingFiles: messagingFileProofRuntime(directory, scannerPort),
  });
  try {
    await seedMessagingRouteDm(client, me, peer, channelId, now);
    const sent = await routes.messaging.send(
      app.jsonPost(
        '/api/messaging/messages',
        {
          version: 1,
          channelId,
          requestId: createId(),
          text: 'Native attachment message',
        },
        { cookie: first.cookie },
      ),
    );
    const message = await sent.json();
    const pdf = '%PDF-1.7\nprivate native attachment\n%%EOF';
    const form = () => {
      const body = new FormData();
      body.set('requestId', requestId);
      body.set(
        'file',
        new File([pdf], 'notes.pdf', { type: 'application/pdf' }),
      );
      return body;
    };
    const attach = () =>
      routes.messaging.files.attach(
        new Request(
          `${origin}/api/messaging/channels/${channelId}/messages/${message.id}/attachments`,
          {
            method: 'POST',
            headers: { origin, cookie: first.cookie },
            body: form(),
          },
        ),
        channelId,
        message.id,
        (state) => nativeFileResponse(channelId, message.id, state),
      );
    const attached = await attach(),
      replay = await attach();
    const list = await routes.messaging.files.list(
      new Request(
        `${origin}/api/messaging/channels/${channelId}/files?messageId=${message.id}`,
        { headers: { cookie: second.cookie } },
      ),
      channelId,
    );
    const metadata = await list.json(),
      file = metadata.files[0];
    const downloaded = await routes.messaging.files.download(
      new Request(
        `${origin}/api/messaging/channels/${channelId}/files/${file.fileId}?generation=${file.generation}`,
        { headers: { cookie: second.cookie } },
      ),
      channelId,
      file.fileId,
    );
    assert({
      given:
        'real signed-in native multipart and immutable retry through actual scanner/private store',
      should:
        'attach once and serve authorized bytes without private keys or URLs',
      actual: [
        sent.status,
        attached.status,
        replay.status,
        list.status,
        metadata.files.length,
        Object.keys(file).sort(),
        downloaded.status,
        await downloaded.text(),
        downloaded.headers.has('location'),
      ],
      expected: [
        200,
        303,
        303,
        200,
        1,
        ['bytes', 'fileId', 'filename', 'generation', 'messageId', 'mime'],
        200,
        pdf,
        false,
      ],
    });
    await client.unsafe('delete from messaging_dm_pairs where channel_id=$1', [
      channelId,
    ]);
    const denied = await routes.messaging.files.download(
      new Request(`${origin}/files?generation=${file.generation}`, {
        headers: { cookie: second.cookie },
      }),
      channelId,
      file.fileId,
    );
    assert({
      given: 'durable pair entitlement removed after successful download',
      should: 'refuse private bytes on fresh authority',
      actual: denied.status,
      expected: 404,
    });
    // An injected reading policy still governs retained history; pending evidence cannot grant private bytes.
    const unavailable = createRoutes({ ...app.app, messagingPolicy: null });
    const held = await unavailable.messaging.files.download(
      new Request(`${origin}/files?generation=${file.generation}`, {
        headers: { cookie: second.cookie },
      }),
      channelId,
      file.fileId,
    );
    assert({
      given: 'missing explicitly configured file/reading runtime',
      should: 'remain unavailable rather than return stored bytes',
      actual: held.status,
      expected: 503,
    });
  } finally {
    try {
      await client.unsafe('delete from messaging_files where channel_id=$1', [
        channelId,
      ]);
      await client.unsafe('delete from messaging_channels where id=$1', [
        channelId,
      ]);
      await client.unsafe(
        'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
        [...[me.actorId, peer.actorId].sort()],
      );
      await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
        channelId,
      ]);
      await client.unsafe('delete from account_age where user_id in ($1,$2)', [
        me.userId,
        peer.userId,
      ]);
    } finally {
      try {
        await client.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}, 30000);
