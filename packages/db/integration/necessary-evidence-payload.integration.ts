import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('atomic payload storage returns stable metadata without claiming audio recovery', async () => {
  await withEvidencePayload(
    async ({
      f,
      store,
      body,
      sealed,
      claim,
      encoded,
      roundId,
      receivedAtMs,
    }) => {
      const [before] =
        await f.sql`select state,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
      const first = await store.adoptCaptureEvidence({ body, sealed, claim });
      const repeated = await store.adoptCaptureEvidence({
        body,
        sealed,
        claim,
      });
      const [stored] =
        await f.sql`select state,octet_length(ciphertext)::integer as bytes,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${body.evidenceId}`;
      const [competitive] =
        await f.sql`select (select count(*)::integer from utterances where round_id=${roundId}) as lines,(select count(*)::integer from round_transcript_freezes where round_id=${roundId}) as freezes`;
      assert({
        given:
          'a committed bounded intent followed by the complete original native body and an opaque encrypted payload',
        should:
          'commit payload+original receipt+actual acceptance together, confirm identically without renewal, and create no transcript/freeze',
        actual: {
          before,
          kind: first.kind,
          same: JSON.stringify(first) === JSON.stringify(repeated),
          state: stored!.state,
          bytes: stored!.bytes,
          receipt: stored!.received_at.getTime(),
          expiry: stored!.expires_at.getTime(),
          accepted: stored!.payload_accepted_at instanceof Date,
          competitive,
        },
        expected: {
          before: { state: 'acquiring', empty: true },
          kind: 'received',
          same: true,
          state: 'retained',
          bytes: encoded.byteLength,
          receipt: receivedAtMs,
          expiry: sealed.receipt.expiresAtMs,
          accepted: true,
          competitive: { lines: 0, freezes: 0 },
        },
      });
    },
  );
});

test('retained payload confirmation cannot bypass the execution credential', async () => {
  await withEvidencePayload(async ({ store, body, sealed, claim }) => {
    await store.adoptCaptureEvidence({ body, sealed, claim });
    const altered = [
      { ...claim, workerId: 'x'.repeat(24) },
      { ...claim, executionEpoch: claim.executionEpoch + 1 },
      { ...claim, token: 'y'.repeat(43) },
    ];
    const replies = [];
    for (const candidate of altered)
      replies.push(
        await store
          .adoptCaptureEvidence({ body, sealed, claim: candidate })
          .then(
            (reply) => reply.kind,
            (error: { code: string }) => error.code,
          ),
      );
    assert({
      given:
        'a retained payload and a changed worker/epoch/token trying to reuse the adoption API',
      should:
        'refuse every foreign credential; separate authorized receipt discovery must not be smuggled into adoption',
      actual: replies,
      expected: ['CONFLICT', 'CONFLICT', 'CONFLICT'],
    });
  });
});
