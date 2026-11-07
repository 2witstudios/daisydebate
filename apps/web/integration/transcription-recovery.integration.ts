import { createFrameClock } from '@daisy/media/observation';
import { createId } from '@paralleldrive/cuid2';
import {
  withRoomRuntime,
  launchRuntimeRound,
} from './round-runtime.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);

test('an actual payload receipt atomically registers one original recognition source', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    const ingress = createNecessaryEvidenceIngress({ store: capture, custody });
    const received = await ingress.receive(body);
    const retried = await ingress.receive(body);
    const [present] =
      await f.sql`select to_regclass('transcription_recovery_sources') is not null as present`;
    const rows = present!.present
      ? await f.sql`select s.evidence_id,s.context_id,c.status,c.units,c.duration_ms,c.first_sequence::text as first_sequence,c.last_sequence::text as last_sequence
      from transcription_recovery_sources s join transcription_recovery_contexts c on c.id=s.context_id where s.evidence_id=${body.evidenceId}`
      : [];
    assert({
      given:
        'a genuine local PG/custody payload transaction and same-ID retry of synthetic original frames',
      should:
        'commit exactly one receipt-linked recovery obligation with immutable original sequence/duration, without claiming recognition or silence',
      actual: {
        received: received.kind,
        retried: retried.kind,
        rows: Array.from(rows),
      },
      expected: {
        received: 'received',
        retried: 'received',
        rows: [
          {
            evidence_id: body.evidenceId,
            context_id: body.evidenceId,
            status: 'collecting',
            units: 1,
            duration_ms: 10,
            first_sequence: '0',
            last_sequence: '0',
          },
        ],
      },
    });
  });
});

test('the actual finalizer cannot discard a pending original intent at the old cutoff', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await launchRuntimeRound(f, await f.assemble());
    const evidenceId = createId();
    await f.sql`insert into necessary_evidence(id,round_id,original_round_id,session_id,segment_id,round_participant_id,worker_id,capture_epoch,binding_digest,state,reserved_bytes)
      values(${evidenceId},${roundId},${roundId},${createId()},${createId()},${createId()},${createId()},1,${'a'.repeat(64)},'acquiring',1)`;
    try {
      await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
      const result = await finalizeAsWeb(f, roundId);
      const freezes =
        await f.sql`select revision from round_transcript_freezes where round_id=${roundId}`;
      assert({
        given:
          'an explicitly seeded pending ORIGINAL intent (not an audio receipt) and the actual web finalizer beyond capture cutoff',
        should:
          'preserve pending recovery and a single still-open frontier instead of silently freezing away the obligation',
        actual: { status: result.status, freezes: freezes.length },
        expected: { status: 'pending', freezes: 0 },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${evidenceId}`;
    }
  });
});

test('actual original unit grouping and overlapping adoption remain atomic', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    const ingress = createNecessaryEvidenceIngress({ store: capture, custody });
    await ingress.receive(body);
    const clock = createFrameClock(body.frames[0]!.clock.anchor.calibration);
    clock.observe(body.frames[0]!.clock.observation);
    clock.observe({ sequence: 1, beforeMs: 20, afterMs: 20 });
    const nextClock = clock.evidence()!;
    const next = {
      ...body,
      evidenceId: createId(),
      startOffsetMs: body.startOffsetMs + 10,
      before: new Date(Math.floor(nextClock.window.beforeMs)).toISOString(),
      after: new Date(Math.ceil(nextClock.window.afterMs)).toISOString(),
      frames: [{ pcmS16le: body.frames[0]!.pcmS16le, clock: nextClock }],
    };
    const appended = await ingress.receive(next);
    const duplicate = { ...next, evidenceId: createId() };
    const refused = await ingress.receive(duplicate);
    const contexts =
      await f.sql`select id,status,units,duration_ms,first_sequence::text as first_sequence,last_sequence::text as last_sequence from transcription_recovery_contexts where round_id=${body.roundId}`;
    const sources =
      await f.sql`select evidence_id from transcription_recovery_sources where context_id=${body.evidenceId}`;
    const [unadopted] =
      await f.sql`select state,ciphertext is null as no_payload from necessary_evidence where id=${duplicate.evidenceId}`;
    assert({
      given:
        'two real adjacent original frame receipts plus an overlapping new-ID retry of the second sequence',
      should:
        'retain one bounded original context and reject duplicate competitive ingestion atomically, preserving compensation debt without a false payload receipt',
      actual: {
        appended: appended.kind,
        refused: refused.kind,
        contexts: Array.from(contexts),
        sources: sources.length,
        unadopted,
      },
      expected: {
        appended: 'received',
        refused: 'refused',
        contexts: [
          {
            id: body.evidenceId,
            status: 'collecting',
            units: 2,
            duration_ms: 20,
            first_sequence: '0',
            last_sequence: '1',
          },
        ],
        sources: 2,
        unadopted: { state: 'acquiring', no_payload: true },
      },
    });
  });
});

test('recovery grants preserve immutable original provenance and exclude worker discovery', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    await createNecessaryEvidenceIngress({ store: capture, custody }).receive(
      body,
    );
    const refused: boolean[] = [];
    for (const [role, statement] of [
      [
        'daisy_web',
        `update transcription_recovery_contexts set source_key=source_key where id=$1`,
      ],
      [
        'daisy_web',
        `update transcription_recovery_sources set start_offset_ms=start_offset_ms where evidence_id=$1`,
      ],
      [
        'daisy_media_worker',
        `select * from transcription_recovery_contexts where id=$1`,
      ],
      [
        'daisy_media_worker',
        `select * from transcription_recovery_sources where evidence_id=$1`,
      ],
    ]) {
      refused.push(
        await f.sql
          .begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(statement!, [body.evidenceId]);
          })
          .then(
            () => false,
            (error: { errno?: string; cause?: { errno?: string } }) =>
              (error.cause?.errno ?? error.errno) === '42501',
          ),
      );
    }
    const status = await f.sql.begin(async (tx) => {
      await tx`set local role daisy_web`;
      return tx`update transcription_recovery_contexts set status='queued' where id=${body.evidenceId} returning status`;
    });
    assert({
      given:
        'actual web/media-worker SQL roles against newly adopted original recovery metadata',
      should:
        'allow only owning mutable work state and deny original provenance mutation or worker discovery reads',
      actual: { refused, status: Array.from(status) },
      expected: {
        refused: [true, true, true, true],
        status: [{ status: 'queued' }],
      },
    });
  });
});
