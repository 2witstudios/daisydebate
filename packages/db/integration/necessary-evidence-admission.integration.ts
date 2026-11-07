import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('capture commits discoverable bounded intent before any custody acquisition', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const evidenceId = createId();
    const overflowId = createId();
    try {
      const intent = await store.reserveCaptureEvidence({
        ...window,
        evidenceId,
        bodyDigest: 'b'.repeat(64),
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
          bodyDigest: 'c'.repeat(64),
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
              bodyDigest: 'b'.repeat(64),
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

test('erasure cannot free custody admission while retirement remains unconfirmed', async () => {
  await withBoundedRound(async (f, transaction, firstRound) => {
    const rounds = [firstRound, await f.round(), await f.round()];
    const ids = [createId(), createId(), createId()];
    try {
      for (let index = 0; index < 2; index++) {
        const capture = await configuredCapture(
          f,
          transaction,
          rounds[index]!,
          2048,
          2,
        );
        await capture.store.reserveCaptureEvidence({
          ...capture.window,
          evidenceId: ids[index],
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        });
        await f.sql`delete from rounds where id=${rounds[index]}`;
        // Custody retirement has not confirmed: an unavailable authority leaves this debt intact.
      }
      const third = await configuredCapture(
        f,
        transaction,
        rounds[2]!,
        2048,
        2,
      );
      const admission = await third.store
        .reserveCaptureEvidence({
          ...third.window,
          evidenceId: ids[2],
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        })
        .then(
          () => 'accepted',
          (error: { code: string }) => error.code,
        );
      const [debt] =
        await f.sql`select count(*)::int as count,sum(reserved_bytes)::int as live_bytes from necessary_evidence where state='retiring' and id in (${ids[0]},${ids[1]})`;
      assert({
        given:
          'two create/erase cycles with live payload reservation released but cleanup unconfirmed at a debt cap of two',
        should:
          'hold new custody admission rather than grow retiring routing/material obligations without bound',
        actual: { admission, debt },
        expected: {
          admission: 'RATE_LIMIT',
          debt: { count: 2, live_bytes: 0 },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id in (${ids[0]},${ids[1]},${ids[2]})`;
      for (const roundId of rounds)
        await f.sql`delete from rounds where id=${roundId}`;
    }
  });
});
