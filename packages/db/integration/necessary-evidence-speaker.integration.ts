import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('original speaker attribution is frozen before custody and never follows a successor cast', async () => {
  await withEvidencePayload(async ({ f, store, body, sealed, claim }) => {
    const [original] =
      await f.sql`select p.id,p.actor_id,a.kind,p.role,p.slot from round_participants p join actors a on a.id=p.actor_id where p.id=${body.roundParticipantId}`;
    await store.adoptCaptureEvidence({ body, sealed, claim });
    const successor = await f.actor(await f.user());
    await f.sql`update round_participants set actor_id=${successor} where id=${body.roundParticipantId}`;
    const restored = await store.readCaptureEvidencePayload({ body });
    const [row] =
      await f.sql`select to_jsonb(e)->'original_speaker' as speaker from necessary_evidence e where id=${body.evidenceId}`;
    const expected = {
      roundParticipantId: original!.id,
      actorId: original!.actor_id,
      kind: original!.kind,
      role: original!.role,
      slot: original!.slot,
    };
    assert({
      given:
        'an original admitted speaker and later changed current actor for that same seat',
      should:
        'retain and return only the frozen original identity for attribution/export, never infer the successor',
      actual: {
        speaker: row!.speaker ?? null,
        privateRead:
          restored.kind === 'received'
            ? (restored.originalSpeaker ?? null)
            : restored.kind,
      },
      expected: { speaker: expected, privateRead: expected },
    });
  });
});
