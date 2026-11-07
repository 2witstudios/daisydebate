import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withBoundedRound,
  loseTransactionCommitReply,
} from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('lost intent commit acknowledgements and retries retain one original reservation', async () => {
  await withBoundedRound(async (f, transaction, roundId, client) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const evidenceId = createId();
    const body = {
      ...window,
      evidenceId,
      bodyDigest: 'b'.repeat(64),
      reservedBytes: 600,
    };
    const restore = loseTransactionCommitReply(client, 2);
    try {
      const unknown = await store.reserveCaptureEvidence(body).then(
        () => false,
        () => true,
      );
      restore();
      const retried = await store.reserveCaptureEvidence(body);
      const conflict = await store
        .reserveCaptureEvidence({ ...body, bodyDigest: 'c'.repeat(64) })
        .then(
          () => 'accepted',
          (error: { code: string }) => error.code,
        );
      const [row] =
        await f.sql`select count(*)::int as count,min(execution_epoch) as epoch,sum(reserved_bytes)::int as bytes from necessary_evidence where id=${evidenceId}`;
      assert({
        given:
          'actual lost PG COMMIT reply, original retry, then foreign body under the same ID',
        should:
          'discover the committed original intent, retain one reservation and refuse changed identity',
        actual: { unknown, retry: retried.kind, conflict, row },
        expected: {
          unknown: true,
          retry: 'pending',
          conflict: 'CONFLICT',
          row: { count: 1, epoch: 1, bytes: 600 },
        },
      });
      await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${evidenceId}`;
      const takeover = await store.reserveCaptureEvidence(body);
      const [after] =
        await f.sql`select execution_epoch,capture_epoch,reserved_bytes from necessary_evidence where id=${evidenceId}`;
      assert({
        given:
          'expired execution ownership while original capture authority remains valid',
        should:
          'advance execution epoch without replacing original identity or reservation',
        actual: { kind: takeover.kind, after },
        expected: {
          kind: 'claimed',
          after: { execution_epoch: 2, capture_epoch: 1, reserved_bytes: 600 },
        },
      });
    } finally {
      restore();
      await f.sql`delete from necessary_evidence where id=${evidenceId}`;
    }
  });
});
test('an opaque body digest cannot hide altered original capture window metadata', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const evidenceId = createId();
    const original = {
      ...window,
      evidenceId,
      bodyDigest: 'b'.repeat(64),
      reservedBytes: 600,
    };
    try {
      await store.reserveCaptureEvidence(original);
      const shifted = {
        startOffsetMs: window.startOffsetMs + 10,
        before: new Date(Date.parse(window.before) + 10).toISOString(),
        after: new Date(Date.parse(window.after) + 10).toISOString(),
      };
      const variants = [
        { trackId: createId() },
        shifted,
        {
          durationMs: 200,
          after: new Date(Date.parse(window.after) + 100).toISOString(),
        },
      ];
      const refused = [];
      for (const change of variants)
        refused.push(
          await store.reserveCaptureEvidence({ ...original, ...change }).then(
            () => 'accepted',
            (error: { code: string }) => error.code,
          ),
        );
      assert({
        given:
          'the same evidence ID and opaque digest but another track or independently eligible window/span',
        should:
          'refuse every changed original body envelope without creating new ownership',
        actual: refused,
        expected: ['CONFLICT', 'CONFLICT', 'CONFLICT'],
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${evidenceId}`;
    }
  });
});
