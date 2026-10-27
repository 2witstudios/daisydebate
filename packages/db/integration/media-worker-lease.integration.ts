import { requireTestServices } from '@daisy/config';
import { CAPTURE_COVERAGE_TOLERANCE } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { mediaCaptureOperations } from '../src/media-capture';
import { withBoundedRound } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('internal capture token admission requires a fresh exact lease and safe nonterminal session', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const scope = {
      roundId,
      sessionId: createId(),
      workerId: createId(),
      epoch: 1,
    };
    const store = mediaCaptureOperations({
      sttLagMs: 60_000,
      coverageTolerance: CAPTURE_COVERAGE_TOLERANCE,
      transaction,
      nextId: createId,
      buildProjection: () => {
        throw new Error(
          'A scheduled Round must not invent a running projection',
        );
      },
    });
    try {
      await fixture.insert('media_sessions', {
        id: scope.sessionId,
        round_id: roundId,
        room_name: createId(),
      });
      await assertRejects({
        given: 'no capture lease',
        should: 'refuse token scope verification',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      const claimed = await store.claimMediaWorkerLease({
        roundId,
        sessionId: scope.sessionId,
        workerId: scope.workerId,
        leaseMs: 15000,
      });
      const verified = await store.verifyMediaWorkerLease(scope, 'mint');
      const { serverNow, ...verifiedScope } = verified;
      assert({
        given: 'the fresh post-lock PostgreSQL calibration stamp',
        should: 'precede this verified lease deadline',
        actual:
          Number.isFinite(Date.parse(serverNow)) &&
          Date.parse(serverNow) < Date.parse(claimed.expiresAt),
        expected: true,
      });
      assert({
        given: 'an exact live capture lease',
        should: 'return only its server scope and lease deadline',
        actual: verifiedScope,
        expected: { ...scope, expiresAt: claimed.expiresAt },
      });
      for (const change of [{ workerId: createId() }, { epoch: 2 }])
        for (const purpose of ['recover', 'mint'] as const)
          await assertRejects({
            given: 'a stale worker epoch or foreign session',
            should: 'refuse token scope',
            code: 'CONFLICT',
            actual: () =>
              store.verifyMediaWorkerLease({ ...scope, ...change }, purpose),
          });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an unsafe session',
        should:
          'refuse token minting retryably while allowing exact leased recovery',
        code: 'INFRASTRUCTURE',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      assert({
        given: 'unsafe vendor state with an exact unexpired lease',
        should:
          'verify only worker authority for recovery without granting token minting',
        actual: (await store.verifyMediaWorkerLease(scope, 'recover')).epoch,
        expected: scope.epoch,
      });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=null where id=$1',
        [scope.sessionId],
      );
      const pendingId = createId();
      await fixture.insert('media_vendor_mutations', {
        id: pendingId,
        session_id: scope.sessionId,
        epoch: 0,
        kind: 'create',
        payload: {},
      });
      await assertRejects({
        given: 'an unresolved vendor operation despite no unsafe timestamp',
        should: 'refuse token minting retryably',
        code: 'INFRASTRUCTURE',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      await fixture.sql.unsafe(
        "update media_vendor_mutations set settled_at=clock_timestamp(),outcome='failed' where id=$1",
        [pendingId],
      );
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=null,ended_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an ended session',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      await fixture.sql.unsafe(
        'update media_sessions set ended_at=null,deletion_requested_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'a session with a deletion request',
        should:
          'refuse capture token minting retryably until recovery completes (CAP-E.1-r6)',
        code: 'INFRASTRUCTURE',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      await fixture.sql.unsafe(
        'update media_sessions set deletion_requested_at=null where id=$1',
        [scope.sessionId],
      );
      await fixture.sql.unsafe(
        "update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=$1",
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an expired lease',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope, 'mint'),
      });
      const fresh = await store.claimMediaWorkerLease({
        roundId,
        sessionId: scope.sessionId,
        workerId: scope.workerId,
        leaseMs: 15000,
      });
      await fixture.sql.unsafe(
        "update rounds set status='abandoned',completed_at=clock_timestamp() where id=$1",
        [roundId],
      );
      await assertRejects({
        given: 'a terminal Round with a still-live worker lease',
        should: 'refuse new capture token admission',
        code: 'CONFLICT',
        actual: () =>
          store.verifyMediaWorkerLease(
            { ...scope, epoch: fresh.epoch },
            'mint',
          ),
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});
