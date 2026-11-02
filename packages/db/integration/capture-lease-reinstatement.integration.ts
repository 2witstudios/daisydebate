import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withClaimedCapture } from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('an expired lease refuses writes until its own worker reinstates the untouched epoch', async () => {
  await withClaimedCapture(async (f, capture) => {
    const expire = () =>
      f.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${capture.lease.sessionId}`;
    await expire();
    await assertRejects({
      given: 'an expired lease',
      should: 'admit no write',
      code: 'CONFLICT',
      actual: () => capture.store.appendCapturedTranscript(capture.clip),
    });
    const renewed = await capture.store.claimMediaWorkerLease({
      ...capture.lease,
      leaseMs: 15000,
      expectedEpoch: 1,
    });
    const appended = await capture.store.appendCapturedTranscript(capture.clip);
    assert({
      given: 'a renewal naming the untouched epoch after expiry',
      should: 'keep the epoch and admit the same clip again',
      actual: [renewed.epoch, appended.duplicate],
      expected: [1, false],
    });
  });
});

test('a takeover or rotation during expiry fences the old worker for good', async () => {
  await withClaimedCapture(async (f, capture) => {
    const expire = () =>
      f.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${capture.lease.sessionId}`;
    await expire();
    const successor = createId();
    const taken = await capture.store.claimMediaWorkerLease({
      ...capture.lease,
      workerId: successor,
      leaseMs: 15000,
    });
    await assertRejects({
      given: 'a successor holding the live lease',
      should: 'refuse the old worker',
      code: 'CONFLICT',
      actual: () =>
        capture.store.claimMediaWorkerLease({
          ...capture.lease,
          leaseMs: 15000,
          expectedEpoch: 1,
        }),
    });
    await expire();
    await assertRejects({
      given: 'that successor expired too',
      should: 'still refuse the old worker, since the row moved',
      code: 'CONFLICT',
      actual: () =>
        capture.store.claimMediaWorkerLease({
          ...capture.lease,
          leaseMs: 15000,
          expectedEpoch: 1,
        }),
    });
    await f.sql`update media_worker_leases set epoch=epoch+1,expires_at=clock_timestamp() where session_id=${capture.lease.sessionId}`;
    await assertRejects({
      given: 'a rotation that moved the epoch on for the same worker',
      should: 'refuse the epoch it held before',
      code: 'CONFLICT',
      actual: () =>
        capture.store.claimMediaWorkerLease({
          ...capture.lease,
          workerId: successor,
          leaseMs: 15000,
          expectedEpoch: taken.epoch,
        }),
    });
  });
});

test('releasing a lease frees it at once, and only for its exact epoch', async () => {
  await withClaimedCapture(async (_f, capture) => {
    const successor = {
      ...capture.lease,
      workerId: createId(),
      leaseMs: 15000,
    };
    await capture.store.releaseMediaWorkerLease({
      ...capture.lease,
      epoch: 7,
    });
    await assertRejects({
      given: 'a release naming another epoch',
      should: 'leave the live lease held',
      code: 'CONFLICT',
      actual: () => capture.store.claimMediaWorkerLease(successor),
    });
    await capture.store.releaseMediaWorkerLease({
      ...capture.lease,
      epoch: 1,
    });
    const claimed = await capture.store.claimMediaWorkerLease(successor);
    assert({
      given: 'the holder releasing its own epoch',
      should: 'let a successor claim the next epoch immediately',
      actual: claimed.epoch,
      expected: 2,
    });
  });
});

for (const framesLost of [false, true])
  test(`a reinstated epoch with contiguous evidence seals by what it held: framesLost ${framesLost}`, async () => {
    await withClaimedCapture(async (f, capture) => {
      await f.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${capture.lease.sessionId}`;
      await capture.store.claimMediaWorkerLease({
        ...capture.lease,
        leaseMs: 15000,
        expectedEpoch: 1,
      });
      await capture.store.observeCapturedStream({
        ...capture.stream,
        trackId: capture.clip.trackId,
        observedFrom: capture.start.toISOString(),
        observedUntil: capture.end.toISOString(),
      });
      const sealed = await capture.store.sealCapturedStream({
        ...capture.stream,
        expectedChunkCount: 0,
        framesLost,
      });
      assert({
        given: framesLost
          ? 'full observations from a process that lost held frames'
          : 'full observations from the process that held every frame',
        should: framesLost ? 'seal partial' : 'seal complete',
        actual: sealed.state,
        expected: framesLost ? 'partial' : 'complete',
      });
    });
  });
