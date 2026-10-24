import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  withMediaRound,
  tokenClaims,
  captureWorkerScope,
  captureOperations,
} from './round-media.test-support';
import { signedCaptureBroker } from './capture-token.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a capture token is issued while recovery reconciles the same session back to back', async () => {
  await withMediaRound(async (f) => {
    const worker = await captureWorkerScope(f);
    const capture = captureOperations(f);
    const { epoch } = await capture.claimMediaWorkerLease({
      ...worker,
      leaseMs: 15000,
    });
    const scope = { ...worker, epoch };
    const { broker, principal } = signedCaptureBroker(f, scope);
    // A recovery loop with no pause between passes: a reconcile lease is live
    // almost all the time, as on staging (ISSUE-551).
    const recovery = { running: true, passes: 0 };
    const looping = (async () => {
      while (recovery.running) {
        await f.mediaOperations.recoverActiveSessions();
        recovery.passes += 1;
      }
    })();
    try {
      while (recovery.passes < 2) await Bun.sleep(5);
      const issued = [];
      for (let attempt = 0; attempt < 3; attempt += 1)
        issued.push(
          tokenClaims((await broker.captureToken(scope, principal)).token).video
            .hidden,
        );
      assert({
        given:
          'three capture token requests while recovery reconciles the live session back to back',
        should:
          'issue each inside its own reconcile, never refused as unresolved recovery',
        actual: issued,
        expected: [true, true, true],
      });
    } finally {
      recovery.running = false;
      await looping;
    }
  });
}, 20_000);
