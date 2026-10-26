import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  withMediaRound,
  tokenClaims,
  captureWorkerScope,
  captureOperations,
  mediaDependencies,
} from './round-media.test-support';
import { signedCaptureBroker } from './capture-token.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a capture token for a safe live session is issued while a foreign reconcile holds it', async () => {
  await withMediaRound(async (f) => {
    const worker = await captureWorkerScope(f);
    const { epoch } = await captureOperations(f).claimMediaWorkerLease({
      ...worker,
      leaseMs: 15000,
    });
    const scope = { ...worker, epoch };
    const sessions = f.store.mediaSessions;
    // Another reconcile (recovery, a browser) holds the session's live lease
    // when the worker asks, as on staging (ISSUE-551).
    const claim = () =>
      sessions.claimMediaReconcile({
        sessionId: scope.sessionId,
        owner: createId(),
      });
    let foreign = await claim();
    while (foreign.kind !== 'claimed') {
      await Bun.sleep(10);
      foreign = await claim();
    }
    const { fence } = foreign;
    let waits = 0;
    const operations = createRoundMediaOperations({
      ...mediaDependencies(f, f.media),
      // A wait for the claim would mean the token queued behind it (ISSUE-571).
      wait: async () => {
        waits += 1;
        await Bun.sleep(10);
      },
    });
    const { broker, principal } = signedCaptureBroker(
      f,
      scope,
      operations.holdForCapture,
    );
    const granted = await broker.captureToken(scope, principal);
    await sessions.finishMediaReconcile({ ...fence, absenceProof: null });
    assert({
      given:
        "a leased worker's token request while a foreign reconcile holds the live, safe session",
      should:
        'issue the hidden token at once, neither waiting for that reconcile nor refusing it as unresolved recovery (ISSUE-551, ISSUE-571)',
      actual: [waits, tokenClaims(granted.token).video.hidden],
      expected: [0, true],
    });
  });
});
