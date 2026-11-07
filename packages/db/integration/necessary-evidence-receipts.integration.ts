import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('private original-body receipt recovery needs no remembered execution token or replacement capture rights', async () => {
  await withEvidencePayload(async ({ f, store, body, sealed, claim }) => {
    const first = await store.adoptCaptureEvidence({ body, sealed, claim });
    await f.sql`update media_worker_leases set worker_id=${createId()},epoch=epoch+1 where session_id=${body.sessionId}`;
    await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${body.evidenceId}`;
    const recovered = await store.readCaptureEvidencePayload({ body });
    const changed = await store
      .readCaptureEvidencePayload({
        body: {
          ...body,
          frames: [
            {
              ...body.frames[0],
              pcmS16le: Buffer.alloc(320, 2).toString('base64'),
            },
          ],
        },
      })
      .then(
        (reply) => reply.kind,
        (error: { code: string }) => error.code,
      );
    assert({
      given:
        'a committed payload and the complete original body after execution credential loss and capture epoch replacement',
      should:
        'return the original private sealed bytes/receipt under current original subject authority, never reauthorize new PCM or accept changed content',
      actual: {
        kind: recovered.kind,
        same:
          recovered.kind === 'received' &&
          recovered.payloadAcceptedAt === first.payloadAcceptedAt &&
          Buffer.from(recovered.sealed.ciphertext).equals(sealed.ciphertext) &&
          JSON.stringify(recovered.sealed.receipt) ===
            JSON.stringify(sealed.receipt),
        changed,
      },
      expected: { kind: 'received', same: true, changed: 'CONFLICT' },
    });
  });
});

test('pending and missing private evidence reads never invent a payload receipt', async () => {
  await withEvidencePayload(async ({ store, body }) => {
    const pending = await store.readCaptureEvidencePayload({ body });
    const missing = await store.readCaptureEvidencePayload({
      body: { ...body, evidenceId: createId() },
    });
    assert({
      given: 'a committed intent without payload and another ID with no intent',
      should:
        'report only their actual states without granting decryption/PCM acknowledgement',
      actual: [pending.kind, missing.kind],
      expected: ['pending', 'missing'],
    });
  });
});
