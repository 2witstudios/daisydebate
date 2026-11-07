import { requireTestServices } from '@daisy/config';
import { necessaryEvidencePolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('changed body, receipt, envelope and execution cannot adopt under the same original reservation', async () => {
  await withEvidencePayload(async ({ f, store, body, sealed, claim }) => {
    const at = Date.now();
    const changed = [
      {
        body: {
          ...body,
          frames: [
            {
              ...body.frames[0],
              pcmS16le: Buffer.alloc(320, 1).toString('base64'),
            },
          ],
        },
        sealed,
        claim,
      },
      {
        body: { ...body, historyVersion: body.historyVersion + 1 },
        sealed,
        claim,
      },
      {
        body,
        sealed: {
          ...sealed,
          receipt: { ...sealed.receipt, bindingDigest: 'f'.repeat(64) },
        },
        claim,
      },
      {
        body,
        sealed: {
          ...sealed,
          receipt: {
            ...sealed.receipt,
            receivedAtMs: at + 60000,
            expiresAtMs: at + 60000 + necessaryEvidencePolicy.maxAgeMs,
          },
        },
        claim,
      },
      {
        body,
        sealed: {
          ...sealed,
          receipt: {
            ...sealed.receipt,
            receivedAtMs: at - necessaryEvidencePolicy.maxAgeMs,
            expiresAtMs: at,
          },
        },
        claim,
      },
      { body, sealed: { ...sealed, tag: Buffer.alloc(15) }, claim },
      { body, sealed: { ...sealed, ciphertext: Buffer.alloc(65537) }, claim },
      {
        body,
        sealed,
        claim: { ...claim, executionEpoch: claim.executionEpoch + 1 },
      },
    ];
    const replies = [];
    for (const candidate of changed)
      replies.push(
        await store.adoptCaptureEvidence(candidate).then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        ),
      );
    const [row] =
      await f.sql`select state,ciphertext is null as empty,payload_accepted_at is null as unreceived from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given:
        'same evidence ID with changed native PCM/history, mismatched/future/expired receipt, malformed/oversized encrypted envelope or foreign execution',
      should:
        'refuse without creating a payload receipt or replacing original binding',
      actual: { replies, row },
      expected: {
        replies: [
          'CONFLICT',
          'CONFLICT',
          'CONFLICT',
          'CONFLICT',
          'CONFLICT',
          'VALIDATION',
          'VALIDATION',
          'CONFLICT',
        ],
        row: { state: 'acquiring', empty: true, unreceived: true },
      },
    });
  });
});

test('lost payload commit reply reconciles the same original bytes and timestamps', async () => {
  await withEvidencePayload(
    async ({ f, client, store, body, sealed, claim }) => {
      const restore = loseTransactionCommitReply(client, 2);
      try {
        const unknown = await store
          .adoptCaptureEvidence({ body, sealed, claim })
          .then(
            () => false,
            () => true,
          );
        restore();
        const [before] =
          await f.sql`select payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
        const confirmed = await store.adoptCaptureEvidence({
          body,
          sealed,
          claim,
        });
        const [after] =
          await f.sql`select payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
        assert({
          given:
            'actual PG payload COMMIT followed by an injected lost reply, with the producer retaining its original execution credential',
          should:
            'confirm the committed receipt without minting a new timestamp/expiry or re-adopting bytes',
          actual: {
            unknown,
            kind: confirmed.kind,
            same: JSON.stringify(before) === JSON.stringify(after),
            receipt: confirmed.receipt,
          },
          expected: {
            unknown: true,
            kind: 'received',
            same: true,
            receipt: sealed.receipt,
          },
        });
      } finally {
        restore();
      }
    },
  );
});

test('canonical subject erasure and Round withdrawal refuse later payload adoption while cleanup is delayed', async () => {
  for (const fence of ['subject', 'round'] as const)
    await withEvidencePayload(
      async ({ f, store, body, sealed, claim, roundId }) => {
        if (fence === 'subject') {
          const [subject] =
            await f.sql`select u.id from users u join actors a on a.user_id=u.id join round_participants p on p.actor_id=a.id where p.round_id=${roundId}`;
          await f.sql`update users set deleted_at=clock_timestamp() where id=${subject!.id}`;
        } else await store.withdrawCaptureEvidence({ roundId });
        const result = await store
          .adoptCaptureEvidence({ body, sealed, claim })
          .then(
            (reply) => reply.kind,
            (error: { code: string }) => error.code,
          );
        const [row] =
          await f.sql`select state,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
        assert({
          given: `a committed canonical ${fence} fence with retirement/material cleanup deliberately not yet run`,
          should:
            'deny new payload use immediately without requiring cleanup to reach the row',
          actual: { result, row },
          expected: {
            result: fence === 'subject' ? 'AUTHORIZATION' : 'CONFLICT',
            row: { state: 'acquiring', empty: true },
          },
        });
      },
    );
});

test('an immutable freeze refuses later payload admission without changing the frontier', async () => {
  await withEvidencePayload(
    async ({ f, store, body, sealed, claim, roundId }) => {
      await f.insert('round_transcript_freezes', {
        round_id: roundId,
        revision: 1,
        frontier: 0,
        completeness: 'incomplete',
      });
      const result = await store
        .adoptCaptureEvidence({ body, sealed, claim })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const [row] =
        await f.sql`select frontier,revision from round_transcript_freezes where round_id=${roundId}`;
      const [payload] =
        await f.sql`select state,payload_accepted_at is null as unreceived from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given:
          'an explicitly persisted immutable frontier before a late payload callback',
        should:
          'reject admission and preserve both the existing frontier and unreceived state',
        actual: { result, row, payload },
        expected: {
          result: 'CONFLICT',
          row: { frontier: 0, revision: 1 },
          payload: { state: 'acquiring', unreceived: true },
        },
      });
    },
  );
});
