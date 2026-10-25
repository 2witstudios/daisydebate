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

test('a capture token waits out a live foreign reconcile and is issued under its own claim', async () => {
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
    const released = { at: null as number | null, waits: 0 };
    const operations = createRoundMediaOperations({
      ...mediaDependencies(f, f.media),
      // Capture's first wait for the claim is when the foreign one finishes.
      wait: async () => {
        released.waits += 1;
        if (released.at === null) {
          await sessions.finishMediaReconcile({ ...fence, absenceProof: null });
          released.at = released.waits;
        }
        await Bun.sleep(10);
      },
    });
    const { broker, principal } = signedCaptureBroker(
      f,
      scope,
      operations.holdForCapture,
    );
    const granted = await broker.captureToken(scope, principal);
    assert({
      given:
        "a leased worker's token request while a foreign reconcile holds the live session lease",
      should:
        'wait for that reconcile to finish, then issue the token inside its own claim instead of refusing it as unresolved recovery',
      actual: [released.at, tokenClaims(granted.token).video.hidden],
      expected: [1, true],
    });
  });
});
