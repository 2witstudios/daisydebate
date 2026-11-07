import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a sticky Round withdrawal fences new intent before cleanup', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const ids = [createId(), createId()];
    try {
      await store.reserveCaptureEvidence({
        ...window,
        evidenceId: ids[0],
        bodyDigest: 'b'.repeat(64),
        reservedBytes: 400,
      });
      const first = await store.withdrawCaptureEvidence({ roundId });
      const again = await store.withdrawCaptureEvidence({ roundId });
      const admission = await store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: ids[1],
          bodyDigest: 'c'.repeat(64),
          reservedBytes: 400,
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const [rows] =
        await f.sql`select count(*)::integer as count,max(execution_epoch) as epoch from necessary_evidence where id in (${ids[0]},${ids[1]})`;
      assert({
        given:
          'a committed evidence-owned Round withdrawal while original account and capture lease remain valid',
        should:
          'retain the first withdrawal instant and refuse new admission immediately while bounded cleanup remains pending',
        actual: {
          same: first.withdrawnAt === again.withdrawnAt,
          admission,
          rows,
        },
        expected: {
          same: true,
          admission: 'CONFLICT',
          rows: { count: 1, epoch: 1 },
        },
      });
      const recovery = await store
        .claimCaptureEvidenceReconciliation({
          roundId,
          evidenceId: ids[0],
          workerId: createId(),
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      assert({
        given:
          'the same committed withdrawal and an otherwise current original acquisition intent',
        should:
          'refuse reconciliation without granting execution through the withdrawn scope',
        actual: recovery,
        expected: 'CONFLICT',
      });
    } finally {
      await f.sql`delete from necessary_evidence where id in (${ids[0]},${ids[1]})`;
    }
  });
});

test('missing withdrawal lineage is not recreated from current accounts or an existing intent', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const ids = [createId(), createId()];
    try {
      await store.reserveCaptureEvidence({
        ...window,
        evidenceId: ids[0],
        bodyDigest: 'b'.repeat(64),
        reservedBytes: 400,
      });
      await f.sql`delete from necessary_evidence_round_fences where round_id=${roundId}`;
      const admission = await store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: ids[1],
          bodyDigest: 'c'.repeat(64),
          reservedBytes: 400,
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const recovery = await store
        .claimCaptureEvidenceReconciliation({
          roundId,
          evidenceId: ids[0],
          workerId: createId(),
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const [marker] =
        await f.sql`select count(*)::integer as count from necessary_evidence_round_fences where round_id=${roundId}`;
      assert({
        given:
          'an existing original intent with absent withdrawal authority after a selective metadata fault',
        should:
          'refuse admission and reconciliation without asserting or recreating a known-open fence',
        actual: { admission, recovery, markers: marker!.count },
        expected: { admission: 'CONFLICT', recovery: 'CONFLICT', markers: 0 },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id in (${ids[0]},${ids[1]})`;
    }
  });
});
