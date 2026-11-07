import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import {
  readyRecognition as ready,
  recognitionTestOptions as options,
} from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);
test('recognition claims preserve original receipts across capture replacement and charge one bounded dispatch per lease', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await ready(f),
      workerId = createId();
    await f.f
      .sql`update media_worker_leases set epoch=epoch+1,worker_id=${createId()},expires_at=clock_timestamp()-interval '1 second' where session_id=${f.body.sessionId}`;
    const claimed = await work.claim({ workerId });
    if (claimed.kind !== 'claimed')
      throw new Error('Expected recognition claim');
    const begun = await work.begin(claimed),
      again = await work.begin(claimed);
    const other = await work.claim({ workerId: createId() });
    const [row] = await f.f
      .sql`select attempts,model,policy_digest from transcription_recovery_contexts where id=${f.body.evidenceId}`;
    const attempts = await f.f
      .sql`select ordinal,outcome from transcription_recovery_attempts where context_id=${f.body.evidenceId}`;
    assert({
      given:
        'durably received original PCM, replaced/expired capture authority and a new recognition execution lease',
      should:
        'claim original work without reauthorizing PCM, reserve only one charged dispatch, and exclude a live sibling claim',
      actual: {
        sources: claimed.evidenceIds,
        begun: begun.kind,
        again: again.kind,
        other: other.kind,
        row,
        attempts: Array.from(attempts),
      },
      expected: {
        sources: [f.body.evidenceId],
        begun: 'admitted',
        again: 'already-admitted',
        other: 'idle',
        row: {
          attempts: 1,
          model: 'test-model',
          policy_digest: claimed.policyDigest,
        },
        attempts: [{ ordinal: 1, outcome: 'admitted' }],
      },
    });
  });
});
test('recognition retry and takeover preserve lifetime spending and fence stale candidate callbacks', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await ready(f),
      first = await work.claim({ workerId: createId() });
    if (first.kind !== 'claimed') throw new Error('Expected first claim');
    await work.begin(first);
    await work.retry({ ...first, reason: 'provider' });
    const waiting = await work.claim({ workerId: createId() });
    await f.f
      .sql`update transcription_recovery_contexts set next_attempt_at=clock_timestamp()-interval '1 second' where id=${f.body.evidenceId}`;
    const second = await work.claim({ workerId: createId() });
    if (second.kind !== 'claimed') throw new Error('Expected retry claim');
    const stale = await work.begin(first).then(
      () => false,
      () => true,
    );
    await work.begin(second);
    const blocked = await work.retry({ ...second, reason: 'provider' });
    const later = await work.claim({ workerId: createId() });
    const [row] = await f.f
      .sql`select status,attempts,blocked_reason from transcription_recovery_contexts where id=${f.body.evidenceId}`;
    assert({
      given:
        'provider failure, durable future backoff, a later lease and exhausted injected two-call lifetime funding',
      should:
        'defer fairly without renewing spending or accepting the old claim, and leave visible blocked recovery rather than a result',
      actual: {
        waiting: waiting.kind,
        stale,
        blocked: blocked.kind,
        later: later.kind,
        row,
      },
      expected: {
        waiting: 'idle',
        stale: true,
        blocked: 'blocked',
        later: 'idle',
        row: { status: 'blocked', attempts: 2, blocked_reason: 'budget' },
      },
    });
  });
});

test('recognition skips a whole live Round before paging a panel larger than its batch', async () => {
  await withEvidenceIngress(async (first) => {
    const ingress = createNecessaryEvidenceIngress({
      store: first.capture,
      custody: first.custody,
    });
    for (let index = 0; index < 10; index++) {
      const reply = await ingress.receive({
        ...first.body,
        evidenceId: createId(),
        trackId: createId(),
      });
      if (reply.kind !== 'received')
        throw new Error('Expected synthetic panel receipt');
    }
    const work = await ready(first);
    await withEvidenceIngress(async (second) => {
      await ready(second);
      const initial = await work.claim({ workerId: createId() });
      if (initial.kind !== 'claimed') throw new Error('Expected panel claim');
      const other = await work.claim({ workerId: createId() });
      assert({
        given:
          'eleven due independent-track contexts in an older Round, a live claim by another worker, and a later due Round',
        should:
          'exclude every sibling of the live Round before distinct-Round LIMIT, admitting the other Round',
        actual: {
          initial: initial.roundId,
          other: other.kind === 'claimed' ? other.roundId : other.kind,
        },
        expected: { initial: first.roundId, other: second.roundId },
      });
    });
  });
});

test('recognition preserves its actual fair turn against newly arriving unserved Rounds', async () => {
  await withEvidenceIngress(async (original) => {
    const work = await ready(original),
      claimed = await work.claim({ workerId: createId() });
    if (claimed.kind !== 'claimed') throw new Error('Expected original claim');
    await work.retry({ ...claimed, reason: 'uncertain' });
    await original.f
      .sql`update transcription_recovery_contexts set next_attempt_at=clock_timestamp()-interval '1 second' where id=${claimed.contextId}`;
    const outcomes: string[] = [];
    // Each new Round is really created after the actual original service instant, not NULL-prioritized.
    await withEvidenceIngress(async (newer) => {
      await ready(newer);
      const next = await work.claim({ workerId: createId() });
      outcomes.push(next.kind === 'claimed' ? next.roundId : next.kind);
      if (next.kind !== 'claimed') throw new Error('Expected due original');
      await work.retry({ ...next, reason: 'uncertain' });
      await original.f
        .sql`update transcription_recovery_contexts set next_attempt_at=clock_timestamp()-interval '1 second' where id=${claimed.contextId}`;
      // Retain the newer unserved sibling while admitting one further genuine arrival.
      await withEvidenceIngress(async (newest) => {
        await ready(newest);
        const other = await work.claim({ workerId: createId() });
        outcomes.push(other.kind === 'claimed' ? other.roundId : other.kind);
        // The prior newer Round now owns the oldest comparable turn, rather than permanent NULL priority.
        assert({
          given:
            'an already-served due Round and successive genuinely new unclaimed Rounds',
          should:
            'serve the old due work first, then the oldest unserved Round rather than continuously prioritizing new arrivals',
          actual: outcomes,
          expected: [original.roundId, newer.roundId],
        });
      });
    });
  });
});

test('recognition candidate metadata stays provisional and current privacy fences reject held callbacks', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await ready(f),
      claimed = await work.claim({ workerId: createId() });
    if (claimed.kind !== 'claimed') throw new Error('Expected claim');
    await work.begin(claimed);
    const candidate = await work.recordCandidate({
      ...claimed,
      text: 'Synthetic candidate; this is not heard audio.',
    });
    const repeat = await work.recordCandidate({
      ...claimed,
      text: 'Synthetic candidate; this is not heard audio.',
    });
    const changed = await work
      .recordCandidate({ ...claimed, text: 'Different synthetic candidate' })
      .then(
        () => false,
        () => true,
      );
    const otherPolicy = f.f.store.createTranscriptionRecovery({
      ...options,
      maxAttempts: 3,
    });
    const policyRejected = await otherPolicy.begin(claimed).then(
      () => false,
      () => true,
    );
    await f.capture.withdrawCaptureEvidence({ roundId: f.roundId });
    const late = await work
      .recordCandidate({
        ...claimed,
        text: 'Synthetic candidate; this is not heard audio.',
      })
      .then(
        () => false,
        () => true,
      );
    const [row] = await f.f
      .sql`select status,selected_at is null as unselected from transcription_recovery_contexts where id=${claimed.contextId}`;
    const [ledger] = await f.f
      .sql`select outcome,candidate_bytes,completed_at is not null as completed from transcription_recovery_attempts where context_id=${claimed.contextId}`;
    assert({
      given:
        'a synthetic candidate, repeated/later changed callbacks, a changed spending configuration and committed evidence withdrawal while text is already held',
      should:
        'retain only candidate metadata without settlement, preserve pinned policy and refuse late competitive work',
      actual: {
        kind: candidate.kind,
        same: repeat.digest === candidate.digest,
        changed,
        policyRejected,
        late,
        row,
        ledger,
      },
      expected: {
        kind: 'provisional',
        same: true,
        changed: true,
        policyRejected: true,
        late: true,
        row: { status: 'leased', unselected: true },
        ledger: {
          outcome: 'candidate',
          candidate_bytes: Buffer.byteLength(
            'Synthetic candidate; this is not heard audio.',
          ),
          completed: true,
        },
      },
    });
  });
});
