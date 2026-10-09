import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  cleanFilePdf,
  openComposedFileFixture,
  startFileFinalization,
} from './messaging-files-composed.test-support';
import { requireFileScannerPort } from './messaging-files.test-support';
import {
  finalizeMessagingFile,
  readMessagingFile,
  renewMessagingFile,
} from '../src/features/messaging/files/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const port = requireFileScannerPort(process.env.CLAMD_TEST_PORT);

for (const mutation of ['posting', 'generation'] as const) {
  test(`late actual clean scan refuses changed ${mutation} authority`, async () => {
    const f = await openComposedFileFixture(databaseUrl, port);
    let scan: ReturnType<typeof startFileFinalization> | undefined;
    try {
      const token = await f.quarantine();
      scan = startFileFinalization(f, token);
      await scan.waitForScan(scan.finalizing);
      if (mutation === 'posting') {
        await f.client.unsafe(
          'update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
          [f.fixture.low, f.fixture.high],
        );
        await f.client.unsafe(
          'update messaging_channels set authority_revision=authority_revision+1 where id=$1',
          [f.fixture.channelId],
        );
      } else {
        await renewMessagingFile(token, f.principal, f.dependencies);
      }
      scan.release();
      await assertRejects({
        given: `real clean scan completes after ${mutation} changed`,
        should: 'refuse late attachment and preserve the newer canonical state',
        actual: () => scan!.finalizing,
        code: mutation === 'posting' ? 'AUTHORIZATION' : 'CONFLICT',
      });
      const row = await f.fileRow(token.fileId);
      assert({
        given: 'late scanner and cleanup completion',
        should:
          'retain the actual current generation without attaching the stale result',
        actual: {
          lifecycle: row.lifecycle,
          generation: row.generation,
          messageId: row.message_id,
        },
        expected: {
          lifecycle: mutation === 'posting' ? 'deleting' : 'quarantined',
          generation: 2,
          messageId: null,
        },
      });
      if (mutation === 'generation') {
        const current = { ...token, generation: 2 };
        await finalizeMessagingFile(
          { ...current, messageId: f.messageId },
          f.principal,
          f.dependencies,
        );
        const access = await readMessagingFile(
          current,
          f.principal,
          f.dependencies,
        );
        assert({
          given: 'current generation rescanned by the real daemon',
          should: 'attach only its admitted immutable content',
          actual: [...access.bytes],
          expected: [...cleanFilePdf],
        });
      }
    } finally {
      scan?.release();
      await scan?.finalizing.catch(() => {});
      await f.close();
    }
  }, 30000);
}

test('canonical own-message removal revokes attached access and retains the real object until delete acknowledgement', async () => {
  const f = await openComposedFileFixture(databaseUrl, port);
  try {
    const token = await f.quarantine();
    await finalizeMessagingFile(
      { ...token, messageId: f.messageId },
      f.principal,
      f.dependencies,
    );
    await f.removeMessage();
    await assertRejects({
      given: 'actual message-removal transaction invokes the parent file hook',
      should: 'make protected attachment access unavailable immediately',
      actual: () => readMessagingFile(token, f.principal, f.dependencies),
      code: 'NOT_FOUND',
    });
    const row = await f.fileRow(token.fileId);
    assert({
      given:
        'own message and its attached file were removed in one canonical transaction',
      should:
        'scrub attachment metadata but retain the actual object pending acknowledgement',
      actual: {
        lifecycle: row.lifecycle,
        filename: row.filename,
        mime: row.mime,
        messageId: row.message_id,
        bytes: [
          ...(await f.objects.read(
            String(row.object_key),
            cleanFilePdf.length,
          )),
        ],
      },
      expected: {
        lifecycle: 'deleting',
        filename: null,
        mime: null,
        messageId: null,
        bytes: [...cleanFilePdf],
      },
    });
    const bells = await f.client.unsafe(
      "select payload from outbox where payload->>'channelId'=$1 order by id",
      [f.fixture.channelId],
    );
    assert({
      given: 'attachment and then canonical message removal',
      should:
        'emit exactly one content-free bell per mutation in the same transactions',
      actual: bells.map((row) => Object.keys(row.payload).sort()),
      expected: [
        ['changeVersion', 'channelId', 'kind'],
        ['changeVersion', 'channelId', 'kind'],
      ],
    });
  } finally {
    await f.close();
  }
}, 30000);
