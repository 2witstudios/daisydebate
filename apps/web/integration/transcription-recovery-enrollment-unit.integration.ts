import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { spawnRecognitionProcess } from './transcription-recovery-process.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);
test('a revoked first unit cannot hide a later authentic missing unit in the same original Round', async () => {
  await withEvidenceIngress(async (f) => {
    const ingress = createNecessaryEvidenceIngress({
      store: f.capture,
      custody: f.custody,
    });
    const initial = await ingress.receive(f.body);
    if (initial.kind !== 'received')
      throw new Error('Expected oldest authentic unit');
    const extra = { ...f.body, evidenceId: createId(), trackId: createId() };
    const received = await ingress.receive(extra);
    if (received.kind !== 'received')
      throw new Error('Expected authentic later original unit');
    const work = await readyRecognition(f);
    await f.f
      .sql`delete from transcription_recovery_contexts where round_id=${f.roundId}`;
    await f.f
      .sql`update transcription_recovery_enrollment_progress set after_at=null,after_round_id=null,until_at=null,until_round_id=null,next_scan_at=clock_timestamp()-interval '1 millisecond' where singleton`;
    const first = await work.missing();
    const [original] = await f.f
      .sql`select binding_digest,authority_id,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${f.body.evidenceId}`;
    const revoked = await f.custody.revoke({
      evidenceId: f.body.evidenceId,
      bindingDigest: original!.binding_digest,
      authorityId: original!.authority_id,
    });
    const refused = await ingress.restore({
      roundId: f.roundId,
      evidenceId: f.body.evidenceId,
    });
    const intact = await ingress.restore({
      roundId: f.roundId,
      evidenceId: extra.evidenceId,
    });
    await Bun.sleep(1100);
    const fresh = spawnRecognitionProcess({ operation: 'scan' });
    const [out, , code] = await Promise.all([
      new Response(fresh.stdout).text(),
      new Response(fresh.stderr).text(),
      fresh.exited,
    ]);
    if (code !== 0) throw new Error('Fresh unit scanner failed');
    const second = JSON.parse(out) as { roundId: string; evidenceId: string }[];
    await f.f
      .sql`update transcription_recovery_enrollment_progress set next_scan_at=clock_timestamp()-interval '1 millisecond' where singleton`;
    const third = await work.missing();
    await f.f
      .sql`update transcription_recovery_enrollment_progress set next_scan_at=clock_timestamp()-interval '1 millisecond' where singleton`;
    const fourth = await work.missing();
    const [after] = await f.f
      .sql`select binding_digest,authority_id,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${f.body.evidenceId}`;
    assert({
      given:
        'two actual original payload receipts in one Round, the first selected unit then revoked by its real independent persistent authority and the second still authentically restorable',
      should:
        'advance within the Round to later usable work without changing original receipt/expiry or treating refusal as deletion permission',
      actual: {
        first,
        revoked,
        refused,
        intact: intact.kind,
        second,
        third,
        fourth,
        after,
      },
      expected: {
        first: [{ roundId: f.roundId, evidenceId: f.body.evidenceId }],
        revoked: { kind: 'revoked' },
        refused: { kind: 'refused', reason: 'revoked' },
        intact: 'restored',
        second: [{ roundId: f.roundId, evidenceId: extra.evidenceId }],
        third: [{ roundId: f.roundId, evidenceId: f.body.evidenceId }],
        fourth: [{ roundId: f.roundId, evidenceId: extra.evidenceId }],
        after: original,
      },
    });
  });
});
