import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);
test('restored original payload enrolls missing recognition work without capture reauthorization or a replacement receipt', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f);
    const [before] = await f.f
      .sql`select authority_id,binding_digest,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${f.body.evidenceId}`;
    await f.f
      .sql`delete from transcription_recovery_contexts where round_id=${f.roundId}`;
    await f.f
      .sql`update media_worker_leases set worker_id=${createId()},epoch=epoch+1,expires_at=clock_timestamp()-interval '1 second' where session_id=${f.body.sessionId}`;
    await f.f
      .sql`update media_sessions set ended_at=clock_timestamp() where id=${f.body.sessionId}`;
    const missing = await work.missing();
    const restored = await createNecessaryEvidenceIngress({
      store: f.capture,
      custody: f.custody,
    }).restore({ roundId: f.roundId, evidenceId: f.body.evidenceId });
    if (restored.kind !== 'restored')
      throw new Error('Expected authenticated original PCM');
    const altered = await work
      .enroll({ body: { ...restored.body, trackId: createId() } })
      .then(
        () => false,
        () => true,
      );
    const first = await work.enroll({ body: restored.body });
    const second = await work.enroll({ body: restored.body });
    const later = await work.missing();
    const [after] = await f.f
      .sql`select authority_id,binding_digest,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${f.body.evidenceId}`;
    const [source] = await f.f
      .sql`select count(*)::integer as count,bool_and(enrolled_at is not null) as timed from transcription_recovery_sources where evidence_id=${f.body.evidenceId}`;
    assert({
      given:
        'authentic old original receipt with recognition metadata absent, replaced expired capture epoch, ended session',
      should:
        'discover and enroll original work once without changing receipt/expiry or accepting altered authority',
      actual: { missing, altered, first, second, later, after, source },
      expected: {
        missing: [{ roundId: f.roundId, evidenceId: f.body.evidenceId }],
        altered: true,
        first: { kind: 'enrolled', evidenceId: f.body.evidenceId },
        second: { kind: 'enrolled', evidenceId: f.body.evidenceId },
        later: [],
        after: before,
        source: { count: 1, timed: true },
      },
    });
  });
});
test('current withdrawal refuses enrollment even when original plaintext was already restored', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f);
    const restored = await createNecessaryEvidenceIngress({
      store: f.capture,
      custody: f.custody,
    }).restore({ roundId: f.roundId, evidenceId: f.body.evidenceId });
    if (restored.kind !== 'restored') throw new Error('Expected original body');
    await f.f
      .sql`delete from transcription_recovery_contexts where round_id=${f.roundId}`;
    await f.capture.withdrawCaptureEvidence({ roundId: f.roundId });
    const refused = await work.enroll({ body: restored.body }).then(
      () => false,
      () => true,
    );
    const missing = await work.missing();
    const [row] = await f.f
      .sql`select count(*)::integer as count from transcription_recovery_sources where evidence_id=${f.body.evidenceId}`;
    assert({
      given:
        'already-held genuine restored original PCM and current committed Round withdrawal before missing metadata adoption',
      should:
        'refuse late enrollment and discovery without deleting the original receipt obligation',
      actual: { refused, missing, count: row!.count },
      expected: { refused: true, missing: [], count: 0 },
    });
  });
});

test('missing-source discovery gives an enrolled Round a fair turn without hiding its remaining original unit', async () => {
  await withEvidenceIngress(async (first) => {
    const ingress = createNecessaryEvidenceIngress({
      store: first.capture,
      custody: first.custody,
    });
    const extra = {
      ...first.body,
      evidenceId: createId(),
      trackId: createId(),
    };
    const receipt = await ingress.receive(extra);
    if (receipt.kind !== 'received')
      throw new Error('Expected second original unit');
    const work = await readyRecognition(first);
    await first.f
      .sql`delete from transcription_recovery_contexts where round_id=${first.roundId}`;
    await withEvidenceIngress(async (second) => {
      await readyRecognition(second);
      await second.f
        .sql`delete from transcription_recovery_contexts where round_id=${second.roundId}`;
      const before = await work.missing();
      const body = await ingress.restore({
        roundId: first.roundId,
        evidenceId: first.body.evidenceId,
      });
      if (body.kind !== 'restored')
        throw new Error('Expected original private body');
      await work.enroll({ body: body.body });
      const next = await work.missing();
      const [actual] = await first.f
        .sql`select enrolled_at>created_at as later from transcription_recovery_sources s join transcription_recovery_contexts c on c.id=s.context_id where evidence_id=${first.body.evidenceId}`;
      assert({
        given:
          'two missing original units in the older Round, one in a later Round, and one actual metadata enrollment',
        should:
          'page distinct Rounds, preserve the unprocessed original unit and let the other Round precede the just-served Round',
        actual: { before: before.map((x) => x.roundId), next, actual },
        expected: {
          before: [first.roundId, second.roundId],
          next: [
            { roundId: second.roundId, evidenceId: second.body.evidenceId },
            { roundId: first.roundId, evidenceId: extra.evidenceId },
          ],
          actual: { later: true },
        },
      });
    });
  });
});
