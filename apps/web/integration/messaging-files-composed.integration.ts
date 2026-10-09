import { requireFileScannerPort } from './messaging-files.test-support';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  cleanFilePdf,
  openComposedFileFixture,
} from './messaging-files-composed.test-support';
import {
  finalizeMessagingFile,
  readMessagingFile,
  uploadMessagingFile,
} from '../src/features/messaging/files/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const port = requireFileScannerPort(process.env.CLAMD_TEST_PORT);

test('real file consumer attaches only scanned content and preserves clean quarantine after wrong association', async () => {
  const f = await openComposedFileFixture(databaseUrl, port);
  try {
    const token = await f.quarantine();
    await assertRejects({
      given: 'a real clean scan with an absent message association',
      should: 'refuse attachment without destroying the valid quarantine',
      actual: () =>
        finalizeMessagingFile(
          { ...token, messageId: createId() },
          f.principal,
          f.dependencies,
        ),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'refused message association',
      should: 'retain the immutable quarantined generation',
      actual: (await f.fileRow(token.fileId)).lifecycle,
      expected: 'quarantined',
    });
    const command = { ...token, messageId: f.messageId };
    await finalizeMessagingFile(command, f.principal, f.dependencies);
    await finalizeMessagingFile(command, f.principal, f.dependencies);
    await uploadMessagingFile(token, cleanFilePdf, f.principal, f.dependencies);
    const access = await readMessagingFile(token, f.principal, f.dependencies);
    assert({
      given:
        'actual scanner, private filesystem and PostgreSQL composed through the canonical store',
      should: 'return admitted content through fresh read authority',
      actual: { bytes: [...access.bytes], mime: access.mime },
      expected: { bytes: [...cleanFilePdf], mime: 'application/pdf' },
    });
    const bells = await f.client.unsafe(
      "select payload from outbox where payload->>'channelId'=$1 order by txid, seq",
      [f.fixture.channelId],
    );
    assert({
      given: 'successful attachment and immutable retries',
      should: 'emit one content-free canonical notification',
      actual: bells.map((row) => Object.keys(row.payload).sort()),
      expected: [['changeVersion', 'channelId', 'kind']],
    });
  } finally {
    await f.close();
  }
}, 30000);

for (const failure of ['age', 'scanner', 'infected'] as const) {
  test(`canonical pending cleanup after ${failure} refusal`, async () => {
    const f = await openComposedFileFixture(databaseUrl, port);
    try {
      const bytes =
        failure === 'infected'
          ? new TextEncoder().encode(
              '%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF',
            )
          : cleanFilePdf;
      const token = await f.quarantine(bytes);
      if (failure === 'age')
        await f.client.unsafe('delete from account_age where user_id=$1', [
          f.fixture.userId,
        ]);
      if (failure === 'scanner') f.relay.pause();
      // Every failure uses the delivered own-pending cleanup capability.
      await assertRejects({
        given: 'posting became unavailable after quarantine',
        should: 'refuse and scrub the still-owned pending association',
        actual: () =>
          finalizeMessagingFile(
            { ...token, messageId: f.messageId },
            f.principal,
            f.dependencies,
          ),
        code:
          failure === 'age'
            ? 'AUTHORIZATION'
            : failure === 'scanner'
              ? 'INFRASTRUCTURE'
              : 'VALIDATION',
      });
      const row = await f.fileRow(token.fileId);
      assert({
        given: 'canonical cleanup without posting/age prerequisites',
        should: 'remove metadata and retain durable deletion accounting',
        actual: {
          lifecycle: row.lifecycle,
          filename: row.filename,
          mime: row.mime,
          requestId: row.request_id,
          messageId: row.message_id,
        },
        expected: {
          lifecycle: 'deleting',
          filename: null,
          mime: null,
          requestId: null,
          messageId: null,
        },
      });
      assert({
        given: 'delete acknowledgement has not occurred',
        should: 'retain the real private object',
        actual: [
          ...(await f.objects.read(String(row.object_key), bytes.length)),
        ],
        expected: [...bytes],
      });
    } finally {
      await f.close();
    }
  }, 30000);
}

test('former group member loses file access while the surviving member keeps shared content', async () => {
  const f = await openComposedFileFixture(databaseUrl, port, true);
  try {
    const token = await f.quarantine();
    await finalizeMessagingFile(
      { ...token, messageId: f.messageId },
      f.principal,
      f.dependencies,
    );
    const peer = {
      kind: 'user' as const,
      actorId: f.fixture.otherActorId,
      userId: f.fixture.otherUserId,
    };
    await readMessagingFile(token, peer, f.dependenciesFor(peer));
    await f.client.unsafe(
      'update messaging_group_grants set revoked_at=$1,generation=generation+1 where channel_id=$2 and actor_id=$3',
      [f.fixture.now, f.fixture.channelId, peer.actorId],
    );
    await f.client.unsafe(
      'update messaging_channels set authority_revision=authority_revision+1 where id=$1',
      [f.fixture.channelId],
    );
    await assertRejects({
      given: 'a former member with the exact file identifier',
      should: 'refuse protected file replay',
      actual: () => readMessagingFile(token, peer, f.dependenciesFor(peer)),
      code: 'AUTHORIZATION',
    });
    const access = await readMessagingFile(token, f.principal, f.dependencies);
    assert({
      given: 'surviving current manager after membership revision changed',
      should: 'keep the attached shared object',
      actual: [...access.bytes],
      expected: [...cleanFilePdf],
    });
  } finally {
    await f.close();
  }
}, 30000);
