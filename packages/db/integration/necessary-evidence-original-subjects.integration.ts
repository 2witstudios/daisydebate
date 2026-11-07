import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('original content subjects survive successor cast and aggregate erasure before custody', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const [scope] =
      await f.sql`select r.created_by_actor_id as creator,p.actor_id as speaker
      from rounds r join round_participants p on p.round_id=r.id where r.id=${roundId} and p.id=${window.roundParticipantId}`;
    const subjects = [
      ...new Set([scope!.creator, scope!.speaker].filter(Boolean)),
    ].sort();
    const id = createId();
    try {
      await store.reserveCaptureEvidence({
        ...window,
        evidenceId: id,
        bodyDigest: 'b'.repeat(64),
        reservedBytes: 600,
      });
      const [original] =
        await f.sql`select to_jsonb(e)->'original_subject_actor_ids' as subjects from necessary_evidence e where id=${id}`;
      const successor = await f.actor(await f.user());
      await f.sql`update round_participants set actor_id=${successor} where id=${window.roundParticipantId}`;
      await f.sql`delete from rounds where id=${roundId}`;
      const [detached] =
        await f.sql`select round_id,state,to_jsonb(e)->'original_subject_actor_ids' as subjects from necessary_evidence e where id=${id}`;
      assert({
        given:
          'a durable pre-custody intent, a changed current cast and then aggregate erasure',
        should:
          'retain the exact original content subjects for immediate privacy fencing and bounded cleanup without reauthorizing against the successor',
        actual: { original: original!.subjects, detached },
        expected: {
          original: subjects,
          detached: { round_id: null, state: 'retiring', subjects },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});

test('unknown original subjects cannot be inferred from the current cast on retry', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const id = createId();
    const input = {
      ...window,
      evidenceId: id,
      bodyDigest: 'b'.repeat(64),
      reservedBytes: 600,
    };
    try {
      await store.reserveCaptureEvidence(input);
      await f.sql`update necessary_evidence set original_subject_actor_ids=null,
        lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${id}`;
      const outcome = await store.reserveCaptureEvidence(input).then(
        (reply) => reply.kind,
        (error: { code: string }) => error.code,
      );
      const [row] =
        await f.sql`select execution_epoch,to_jsonb(e)->'original_subject_actor_ids' as subjects from necessary_evidence e where id=${id}`;
      assert({
        given:
          'uncertain original subject metadata with an expired execution lease and a currently readable cast',
        should:
          'refuse execution renewal without inventing original account authority or deleting cleanup routing',
        actual: { outcome, row },
        expected: {
          outcome: 'CONFLICT',
          row: { execution_epoch: 1, subjects: null },
        },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});
