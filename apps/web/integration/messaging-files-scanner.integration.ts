import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openFileScannerRelay } from './messaging-files.test-support';
import { createClamdScanner } from '../src/features/messaging/files/clamd';
setupRitewayBun();
requireTestServices(process.env);
// Explicit isolated service, supplied by the scheduled local/CI edge; no public/default scanner.
const port = Number(process.env.CLAMD_TEST_PORT?.replaceAll(' ', ''));
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('CLAMD_TEST_PORT must name the isolated local clamd service');

const limits = { maxBytes: 1024, serviceMs: 5000 };

test('production INSTREAM scanner proves actual clean, EICAR and recoverable outage classification', async () => {
  const relay = await openFileScannerRelay({ host: '127.0.0.1', port });
  const scanner = createClamdScanner(relay);
  try {
    for (const [sample, expected] of [
      ['%PDF-1.7\nclean document\n%%EOF', 'clean'],
      [
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
        'infected',
      ],
    ] as const) {
      assert({
        given: 'real bytes streamed to local clamd',
        should: 'use actual daemon classification',
        actual: await scanner.scan(new TextEncoder().encode(sample), limits),
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
