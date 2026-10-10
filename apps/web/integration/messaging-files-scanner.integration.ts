import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  openFileScannerRelay,
  requireFileScannerPort,
} from './messaging-files.test-support';
import { createClamdScanner } from '../src/features/messaging/files/clamd';
import {
  fileProofEicar,
  infectedFilePdf,
} from './messaging-files-samples.test-support';
setupRitewayBun();
requireTestServices(process.env);
// Explicit isolated service, supplied by the scheduled local/CI edge; no public/default scanner.
const port = requireFileScannerPort(process.env.CLAMD_TEST_PORT);

const limits = { maxBytes: 1024, serviceMs: 5000 };

test('production INSTREAM scanner proves actual clean, EICAR and recoverable outage classification', async () => {
  const relay = await openFileScannerRelay({ host: '127.0.0.1', port });
  const scanner = createClamdScanner(relay);
  try {
    for (const [bytes, expected] of [
      [new TextEncoder().encode('%PDF-1.7\nclean document\n%%EOF'), 'clean'],
      [new TextEncoder().encode(fileProofEicar), 'infected'],
      [infectedFilePdf(), 'infected'],
    ] as const) {
      assert({
        given: 'real bytes streamed to local clamd',
        should: 'use actual daemon classification',
        actual: await scanner.scan(bytes, limits),
        expected,
      });
    }
    await assertRejects({
      given: 'a stream above its injected admission bound',
      should: 'reject without treating it clean',
      actual: () => scanner.scan(new Uint8Array(1025), limits),
      code: 'PAYLOAD_TOO_LARGE',
    });
    relay.pause();
    await assertRejects({
      given: 'actual scanner transport outage',
      should: 'fail closed without a clean result',
      actual: () => scanner.scan(new Uint8Array([1]), limits),
      code: 'INFRASTRUCTURE',
    });
    relay.resume();
    assert({
      given: 'the actual daemon transport recovered',
      should: 'scan clean bytes again',
      actual: await scanner.scan(new TextEncoder().encode('Clean'), limits),
      expected: 'clean',
    });
  } finally {
    await relay.close();
  }
}, 15000);
