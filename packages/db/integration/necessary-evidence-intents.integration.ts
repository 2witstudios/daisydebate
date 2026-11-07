import { requireTestServices } from '@daisy/config';
import { captureRule } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withBoundedRound,
  loseTransactionCommitReply,
} from './bounded-transaction.test-support';
import { historicalCapture } from './media-capture.test-support';
import { mediaCaptureOperations } from '../src/media-capture';
setupRitewayBun();
requireTestServices(process.env);
type TestContext = Parameters<Parameters<typeof withBoundedRound>[0]>;
async function configuredCapture(
  f: TestContext[0],
  transaction: TestContext[1],
  roundId: string,
  maxGlobalBytes = 2048,
) {
  const original = await historicalCapture(f, transaction, roundId);
  await original.store.claimMediaWorkerLease({
    ...original.lease,
    leaseMs: 15000,
  });
  const store = mediaCaptureOperations({
    transaction,
    captureRule,
    sttLagMs: 60000,
    nextId: createId,
    buildProjection: () => {
      throw new Error('Historical fixture cannot invent play');
    },
    evidence: {
      leaseMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
      maxRoundBytes: 1024,
      maxGlobalBytes,
    },
  });
  const { trackId, startOffsetMs, durationMs, before, after } = original.clip;
  const window = {
    ...original.stream,
    trackId,
    startOffsetMs,
    durationMs,
    before,
    after,
  };
  return { store, window, original };
}
test('capture commits discoverable bounded intent before any custody acquisition', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const evidenceId = createId();
    const overflowId = createId();
    try {
      const intent = await store.reserveCaptureEvidence({
        ...window,
        evidenceId,
        bindingDigest: 'b'.repeat(64),
        reservedBytes: 600,
      });
      const [row] =
        await f.sql`select id,state,reserved_bytes,ciphertext is null as no_payload,execution_epoch from necessary_evidence where id=${evidenceId}`;
      assert({
        given:
          'authorized original capture, before the first custody side effect',
        should:
          'durably reserve one discoverable intent without claiming payload durability',
        actual: { kind: intent.kind, row },
        expected: {
          kind: 'claimed',
          row: {
            id: evidenceId,
            state: 'acquiring',
            reserved_bytes: 600,
            no_payload: true,
            execution_epoch: 1,
          },
        },
      });
      const refused = await store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: overflowId,
          bindingDigest: 'c'.repeat(64),
          reservedBytes: 600,
        })
        .then(
          () => 'accepted',
          (error: { code: string }) => error.code,
        );
      assert({
        given:
          'another unit that would exceed the serialized per-Round reservation',
        should: 'refuse before any custody call or unbounded pending work',
        actual: refused,
        expected: 'RATE_LIMIT',
      });
      await f.sql`delete from rounds where id=${roundId}`;
      const [routing] =
        await f.sql`select round_id,state,retirement_reason,reserved_bytes from necessary_evidence where id=${evidenceId}`;
      assert({
        given: 'aggregate erasure before acquisition finishes',
        should:
          'retain durable revocation routing while releasing reservation and fencing work',
        actual: routing,
        expected: {
          round_id: null,
          state: 'retiring',
          retirement_reason: 'erased',
          reserved_bytes: 0,
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id in (${evidenceId},${overflowId})`;
    }
  });
});

test('lost intent commit acknowledgements and retries retain one original reservation', async () => {
  await withBoundedRound(async (f, transaction, roundId, client) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const evidenceId = createId();
    const body = {
      ...window,
      evidenceId,
      bindingDigest: 'b'.repeat(64),
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
        .reserveCaptureEvidence({ ...body, bindingDigest: 'c'.repeat(64) })
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
test('concurrent Rounds cannot overbook the evidence-owned global reservation', async () => {
  await withBoundedRound(async (f, transaction, firstRound) => {
    const secondRound = await f.round();
    const first = await configuredCapture(f, transaction, firstRound, 1024);
    const second = await configuredCapture(f, transaction, secondRound, 1024);
    const ids = [createId(), createId()];
    try {
      const admissions = await Promise.all(
        [first, second].map((capture, index) =>
          capture.store
            .reserveCaptureEvidence({
              ...capture.window,
              evidenceId: ids[index],
              bindingDigest: 'b'.repeat(64),
              reservedBytes: 600,
            })
            .then(
              (result) => result.kind,
              (error: { code: string }) => error.code,
            ),
        ),
      );
      const [row] =
        await f.sql`select count(*)::int as count,sum(reserved_bytes)::int as bytes from necessary_evidence where id in (${ids[0]},${ids[1]})`;
      assert({
        given:
          'two independent Rounds concurrently reserving 600 bytes under a global 1024 byte limit',
        should: 'commit exactly one intent and refuse the other before custody',
        actual: { admissions: admissions.sort(), row },
        expected: {
          admissions: ['RATE_LIMIT', 'claimed'],
          row: { count: 1, bytes: 600 },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id in (${ids[0]},${ids[1]})`;
      await f.sql`delete from rounds where id=${secondRound}`;
    }
  });
});
