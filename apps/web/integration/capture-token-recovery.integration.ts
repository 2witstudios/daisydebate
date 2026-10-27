import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  withMediaRound,
  captureWorkerScope,
  captureOperations,
} from './round-media.test-support';
import { signedCaptureBroker } from './capture-token.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a leased capture reaches recovery while unsafe, but never mints into unresolved admission', async () => {
  await withMediaRound(async (f) => {
    const identity = await captureWorkerScope(f);
    const lease = await captureOperations(f).claimMediaWorkerLease({
      ...identity,
      leaseMs: 30000,
    });
    const scope = { ...identity, epoch: lease.epoch };
    let holds = 0;
    const { broker, principal } = signedCaptureBroker(
      f,
      scope,
      async (sessionId, work) => {
        holds++;
        return f.mediaOperations.holdForCapture(sessionId, work);
      },
    );
    await assertRejects({
      given: 'a signed worker claiming another worker identity',
      should: 'refuse before acquiring a recovery hold',
      actual: () =>
        broker.captureToken({ ...scope, workerId: createId() }, principal),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'that foreign scope',
      should: 'make no session recovery mutation',
      actual: holds,
      expected: 0,
    });
    await f.sql`update media_sessions set unsafe_at=clock_timestamp() where id=${scope.sessionId}`;
    await assertRejects({
      given:
        'an exact live lease whose session became unsafe before token preflight',
      should:
        'reach recovery and refuse retryably instead of returning a definite conflict',
      actual: () => broker.captureToken(scope, principal),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'the unsafe session',
      should:
        'have reached its own reconcile hold through the real lease witness',
      actual: holds,
      expected: 1,
    });
    await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${f.roundId}`;
    await assertRejects({
      given: 'a terminal round with the same lease',
      should: 'refuse definitely rather than recover or issue a token',
      actual: () => broker.captureToken(scope, principal),
      code: 'CONFLICT',
    });
    assert({
      given: 'the terminal refusal',
      should: 'acquire no additional recovery hold',
      actual: holds,
      expected: 1,
    });
  });
});
