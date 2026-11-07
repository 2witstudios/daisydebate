import { createId } from '@paralleldrive/cuid2';
import { createFrameClock } from '@daisy/media/observation';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withEvidenceIngress,
  withEvidenceIngressCohort,
  type EvidenceIngressFixture,
} from './necessary-evidence-ingress.test-support';
import {
  readyRecognition,
  recognitionTestOptions,
} from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);
test('known missing original receipt metadata prevents paid recognition of a recovered prefix', async () => {
  await withEvidenceIngress(async (f) => {
    const ingress = createNecessaryEvidenceIngress({
      store: f.capture,
      custody: f.custody,
    });
    const first = await ingress.receive(f.body);
    const clock = createFrameClock(f.body.frames[0]!.clock.anchor.calibration);
    clock.observe(f.body.frames[0]!.clock.observation);
    clock.observe({ sequence: 1, beforeMs: 20, afterMs: 20 });
    const evidence = clock.evidence()!;
    const next = {
      ...f.body,
      evidenceId: createId(),
      startOffsetMs: f.body.startOffsetMs + 10,
      before: new Date(Math.floor(evidence.window.beforeMs)).toISOString(),
      after: new Date(Math.ceil(evidence.window.afterMs)).toISOString(),
      frames: [{ ...f.body.frames[0]!, clock: evidence }],
    };
    const second = await ingress.receive(next);
    if (first.kind !== 'received' || second.kind !== 'received')
      throw new Error('Expected original contiguous payload receipts');
    const work = await readyRecognition(f);
    const [receipts] = await f.f
      .sql`select jsonb_agg(jsonb_build_array(id,received_at,expires_at,payload_accepted_at) order by id) as original from necessary_evidence where original_round_id=${f.roundId}`;
    await f.f
      .sql`delete from transcription_recovery_contexts where round_id=${f.roundId}`;
    const original = await ingress.restore({
      roundId: f.roundId,
      evidenceId: f.body.evidenceId,
    });
    if (original.kind !== 'restored') throw new Error('Expected original body');
    await work.enroll({ body: original.body });
    // An elapsed quiet interval alone cannot make a known missing suffix ready.
    await f.f
      .sql`update transcription_recovery_contexts set last_source_at=clock_timestamp()-interval '1 second' where round_id=${f.roundId}`;
    const prefix = await work.claim({ workerId: createId() });
    assert({
      given:
        'a quiet restored10ms prefix while another actual contiguous payload receipt lacks source metadata',
      should:
        'leave paid work unclaimed rather than spend on an arbitrary recovered prefix',
      actual: prefix.kind,
      expected: 'idle',
    });
    const suffix = await ingress.restore({
      roundId: f.roundId,
      evidenceId: next.evidenceId,
    });
    if (suffix.kind !== 'restored') throw new Error('Expected original suffix');
    await work.enroll({ body: suffix.body });
    const [progress] = await f.f
      .sql`select c.units,c.duration_ms,c.last_source_at=s.enrolled_at as actual_enrollment from transcription_recovery_contexts c join transcription_recovery_sources s on s.context_id=c.id where s.evidence_id=${next.evidenceId}`;
    await f.f
      .sql`update transcription_recovery_contexts set last_source_at=clock_timestamp()-interval '1 second' where round_id=${f.roundId}`;
    const complete = await work.claim({ workerId: createId() });
    const [after] = await f.f
      .sql`select jsonb_agg(jsonb_build_array(id,received_at,expires_at,payload_accepted_at) order by id) as original from necessary_evidence where original_round_id=${f.roundId}`;
    assert({
      given:
        'both authenticated contiguous originals enrolled and a later eligible quiet interval',
      should:
        'claim one complete20ms context with actual assembly progress and unchanged original receipt/expiry',
      actual: {
        kind: complete.kind,
        ids: complete.kind === 'claimed' ? complete.evidenceIds : [],
        progress,
        after,
      },
      expected: {
        kind: 'claimed',
        ids: [f.body.evidenceId, next.evidenceId],
        progress: { units: 2, duration_ms: 20, actual_enrollment: true },
        after: receipts,
      },
    });
  });
});
test('new paid work waits for backlog while already admitted response bookkeeping retains its pinned manifest', async () => {
  await withEvidenceIngress(async (f) => {
    const ingress = createNecessaryEvidenceIngress({
      store: f.capture,
      custody: f.custody,
    });
    await ingress.receive(f.body);
    const extra = { ...f.body, evidenceId: createId(), trackId: createId() };
    const received = await ingress.receive(extra);
    if (received.kind !== 'received')
      throw new Error('Expected independent original receipt');
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed' || claim.evidenceIds[0] !== f.body.evidenceId)
      throw new Error('Expected oldest pinned original context');
    await f.f
      .sql`delete from transcription_recovery_contexts where id=${extra.evidenceId}`;
    const refused = await work.begin(claim).then(
      () => false,
      () => true,
    );
    const [before] = await f.f
      .sql`select attempts from transcription_recovery_contexts where id=${claim.contextId}`;
    assert({
      given:
        'known unrelated original backlog appears after claim but before fresh paid admission',
      should:
        'refuse new spending under the locked admission fence with counter unchanged',
      actual: { refused, before },
      expected: { refused: true, before: { attempts: 0 } },
    });
    const restored = await ingress.restore({
      roundId: f.roundId,
      evidenceId: extra.evidenceId,
    });
    if (restored.kind !== 'restored')
      throw new Error('Expected original backlog body');
    await work.enroll({ body: restored.body });
    await work.begin(claim);
    await f.f
      .sql`delete from transcription_recovery_contexts where id=${extra.evidenceId}`;
    const candidate = await work.recordCandidate({
      ...claim,
      text: 'Synthetic bookkeeping fixture',
    });
    const released = await work.retry({ ...claim, reason: 'uncertain' });
    const [after] = await f.f
      .sql`select c.status,c.attempts,a.candidate_digest is not null as retained,a.outcome from transcription_recovery_contexts c join transcription_recovery_attempts a on a.context_id=c.id where c.id=${claim.contextId}`;
    assert({
      given:
        'a fresh admitted call, later unrelated missing metadata, and that original attempt response',
      should:
        'retain fenced provisional bookkeeping and release into persisted backoff without selecting text or changing the dispatched manifest',
      actual: { candidate: candidate.kind, released: released.kind, after },
      expected: {
        candidate: 'provisional',
        released: 'retry',
        after: {
          status: 'retry',
          attempts: 1,
          retained: true,
          outcome: 'uncertain',
        },
      },
    });
  });
});
test('fresh call admission exposes the original bounded start window while replay grants none', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed')
      throw new Error('Expected original recognition claim');
    const begun = await work.begin(claim),
      replayed = await work.begin(claim);
    const [attempt] = await f.f
      .sql`select admitted_at from transcription_recovery_attempts where context_id=${claim.contextId}`;
    assert({
      given:
        'one fresh durable admission followed by a replay of the same epoch',
      should:
        'return the actual admission instant and no-later-than-original-lease start bound only on the fresh grant',
      actual: {
        kind: begun.kind,
        admittedAt: Reflect.get(begun, 'admittedAt'),
        startBefore: Reflect.get(begun, 'startBefore'),
        replayed,
      },
      expected: {
        kind: 'admitted',
        admittedAt: attempt!.admitted_at.toISOString(),
        startBefore: claim.expiresAt,
        replayed: { kind: 'already-admitted', ordinal: 1 },
      },
    });
  });
});
test('a full page of Rounds with known enrollment backlog cannot hide another ready Round', async () => {
  await withEvidenceIngressCohort(async (create) => {
    const cohort: EvidenceIngressFixture[] = [];
    for (let index = 0; index < 9; index += 1) {
      const raw = await create(),
        f = { ...raw, custody: cohort[0]?.custody ?? raw.custody };
      cohort.push(f);
      if (index < 8) {
        // Keep an eligible-looking context beside a distinct, genuinely received missing unit.
        const extra = {
          ...f.body,
          evidenceId: createId(),
          trackId: createId(),
        };
        const received = await createNecessaryEvidenceIngress({
          store: f.capture,
          custody: f.custody,
        }).receive(extra);
        if (received.kind !== 'received')
          throw new Error('Expected original backlog receipt');
        await readyRecognition(f);
        await f.f
          .sql`delete from transcription_recovery_contexts where id=${extra.evidenceId}`;
      } else await readyRecognition(f);
    }
    const work = cohort[0]!.f.store.createTranscriptionRecovery(
      recognitionTestOptions,
    );
    const claimed = await work.claim({ workerId: createId() });
    assert({
      given:
        'eight older due contexts with known original enrollment backlog and a ninth ready Round',
      should:
        'filter unready Rounds before the eight-Round page and admit the independent ready work',
      actual: claimed.kind === 'claimed' ? claimed.roundId : claimed.kind,
      expected: cohort[8]!.roundId,
    });
  });
}, 20000);
