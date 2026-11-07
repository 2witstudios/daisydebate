import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('acquisition reconciliation replaces execution without reauthorizing original capture after its cutoff', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(
      f,
      transaction,
      roundId,
      2048,
      65536,
      118000,
    );
    const id = createId();
    const successor = createId();
    const original = {
      ...window,
      evidenceId: id,
      bodyDigest: 'b'.repeat(64),
      reservedBytes: 600,
    };
    try {
      const admitted = await store.reserveCaptureEvidence(original);
      await f.sql`update media_worker_leases set worker_id=${successor},epoch=epoch+1,expires_at=clock_timestamp()+interval '15 seconds' where session_id=${window.sessionId}`;
      await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${id}`;
      await f.sql`update media_sessions set ended_at=clock_timestamp() where id=${window.sessionId}`;
      // The actual immutable120s cutoff was established before admission; never rewrite it.
      const waitUntil = performance.now() + 4000;
      let cutoffPassed = false;
      while (performance.now() < waitUntil) {
        const [clock] =
          await f.sql`select clock_timestamp()>transcript_admission_cutoff as passed from rounds where id=${roundId}`;
        if (clock!.passed) {
          cutoffPassed = true;
          break;
        }
        await Bun.sleep(10);
      }
      if (!cutoffPassed)
        throw new Error('Immutable database cutoff did not pass');
      const [before] =
        await f.sql`select version,outcome from rounds where id=${roundId}`;
      const captureRefusal = await store.reserveCaptureEvidence(original).then(
        (reply) => reply.kind,
        (error: { code: string }) => error.code,
      );
      const claimed = await store.claimCaptureEvidenceReconciliation({
        roundId,
        evidenceId: id,
        workerId: successor,
      });
      const [row] =
        await f.sql`select worker_id,capture_epoch,execution_worker_id,execution_epoch,binding_digest from necessary_evidence where id=${id}`;
      const [after] =
        await f.sql`select version,outcome from rounds where id=${roundId}`;
      const [competitive] = await f.sql`select
        (select count(*)::integer from round_transcript_freezes where round_id=${roundId}) as freezes,
        (select count(*)::integer from round_judging_jobs where round_id=${roundId}) as jobs,
        (select count(*)::integer from utterances where round_id=${roundId}) as lines`;
      assert({
        given:
          'an expired intent execution lease, successor capture epoch, closed original session and already-past stored cutoff',
        should:
          'claim only acquisition reconciliation under immutable original scope, with no fresh capture authorization, PCM receipt, transcript/freeze/result mutation',
        actual: {
          captureRefusal,
          kind: claimed.kind,
          purpose: claimed.kind === 'claimed' ? claimed.purpose : null,
          row,
          unchanged: JSON.stringify(before) === JSON.stringify(after),
          competitive,
        },
        expected: {
          captureRefusal: 'CONFLICT',
          kind: 'claimed',
          purpose: 'reconcile-acquisition',
          row: {
            worker_id: window.workerId,
            capture_epoch: window.epoch,
            execution_worker_id: successor,
            execution_epoch: 2,
            binding_digest: admitted.bindingDigest,
          },
          unchanged: true,
          competitive: { freezes: 0, jobs: 0, lines: 0 },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});

test('reconciliation fences original erased or unproven subjects instead of a successor cast', async () => {
  const outcomes: unknown[] = [];
  for (const fault of ['original-erased', 'subjects-unknown'] as const) {
    await withBoundedRound(async (f, transaction, roundId) => {
      const { store, window } = await configuredCapture(
        f,
        transaction,
        roundId,
      );
      const id = createId();
      try {
        await store.reserveCaptureEvidence({
          ...window,
          evidenceId: id,
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        });
        await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${id}`;
        if (fault === 'original-erased') {
          const [original] =
            await f.sql`select actor_id from round_participants where id=${window.roundParticipantId}`;
          const successor = await f.actor(await f.user());
          await f.sql`update round_participants set actor_id=${successor} where id=${window.roundParticipantId}`;
          await f.sql`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1 where id in (select user_id from actors where id=${original!.actor_id})`;
        } else {
          await f.sql`update necessary_evidence set original_subject_actor_ids=null where id=${id}`;
        }
        const outcome = await store
          .claimCaptureEvidenceReconciliation({
            roundId,
            evidenceId: id,
            workerId: createId(),
          })
          .then(
            (reply) => reply.kind,
            (error: { code: string }) => error.code,
          );
        const [row] =
          await f.sql`select execution_epoch,execution_worker_id from necessary_evidence where id=${id}`;
        outcomes.push({
          outcome,
          unchanged:
            row!.execution_epoch === 1 &&
            row!.execution_worker_id === window.workerId,
        });
      } finally {
        await f.sql`delete from necessary_evidence where id=${id}`;
      }
    });
  }
  assert({
    given:
      'original account erasure behind a successor cast, or absent original subject metadata',
    should:
      'refuse under original authority without renewing execution from replacement facts',
    actual: outcomes,
    expected: [
      { outcome: 'AUTHORIZATION', unchanged: true },
      { outcome: 'CONFLICT', unchanged: true },
    ],
  });
});

test('concurrent acquisition claimants advance one execution and preserve original capture ownership', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const id = createId();
    const workers = [createId(), createId()];
    try {
      await store.reserveCaptureEvidence({
        ...window,
        evidenceId: id,
        bodyDigest: 'b'.repeat(64),
        reservedBytes: 600,
      });
      await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${id}`;
      const replies = await Promise.all(
        workers.map((workerId) =>
          store.claimCaptureEvidenceReconciliation({
            roundId,
            evidenceId: id,
            workerId,
          }),
        ),
      );
      const [row] =
        await f.sql`select execution_epoch,execution_worker_id,worker_id,capture_epoch from necessary_evidence where id=${id}`;
      assert({
        given:
          'two workers concurrently reconciling one expired original acquisition',
        should:
          'claim once and leave the other pending without rewriting original capture worker/epoch',
        actual: {
          replies: replies.map((reply) => reply.kind).sort(),
          epoch: row!.execution_epoch,
          selected: workers.includes(row!.execution_worker_id),
          original: [row!.worker_id, row!.capture_epoch],
        },
        expected: {
          replies: ['claimed', 'pending'],
          epoch: 2,
          selected: true,
          original: [window.workerId, window.epoch],
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});
