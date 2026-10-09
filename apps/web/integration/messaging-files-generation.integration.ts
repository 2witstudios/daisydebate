import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  cleanFilePdf,
  openComposedFileFixture,
} from './messaging-files-composed.test-support';
import {
  requireFileScannerPort,
  controlledFileScan,
} from './messaging-files.test-support';
import {
  finalizeMessagingFile,
  readMessagingFile,
  renewMessagingFile,
} from '../src/features/messaging/files/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const port = requireFileScannerPort(process.env.CLAMD_TEST_PORT);

test('actual delayed clean scan cannot mutate a renewed generation or mask its original conflict', async () => {
  const f = await openComposedFileFixture(databaseUrl, port);
  const scan = controlledFileScan(f.dependencies.scanner);
  let finalizing: Promise<unknown> | undefined;
  try {
    const token = await f.quarantine();
    finalizing = finalizeMessagingFile(
      { ...token, messageId: f.messageId },
      f.principal,
      { ...f.dependencies, scanner: scan.scanner },
    );
    const rejection = assertRejects({
      given: 'clean scan completes after actual reservation renewal',
      should:
        'preserve conflict while canonical cleanup refuses the newer generation',
      actual: () => finalizing!,
      code: 'CONFLICT',
    });
    await scan.waitForScan(finalizing);
    const renewed = await renewMessagingFile(
      token,
      f.principal,
      f.dependencies,
    );
    scan.release();
    await rejection;
    const row = await f.fileRow(token.fileId);
    assert({
      given: 'stale scanner and stale cleanup token',
      should: 'leave the renewed quarantine unchanged',
      actual: {
        lifecycle: row.lifecycle,
        generation: row.generation,
        messageId: row.message_id,
      },
      expected: {
        lifecycle: 'quarantined',
        generation: renewed.generation,
        messageId: null,
      },
    });
    const current = { ...token, generation: renewed.generation };
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
      should: 'attach and return only its admitted immutable content',
      actual: [...access.bytes],
      expected: [...cleanFilePdf],
    });
  } finally {
    scan.release();
    await finalizing?.catch(() => {});
    await f.close();
  }
}, 30000);
