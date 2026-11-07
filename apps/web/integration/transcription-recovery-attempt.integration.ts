import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { createTranscriptionAttempt } from '../src/features/transcription-recovery/attempt';
setupRitewayBun();
requireTestServices(process.env);
test('actual original custody and PG admission produce one controlled STT candidate without transcript settlement', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed')
      throw new Error('Expected original recognition claim');
    let calls = 0;
    const execute = createTranscriptionAttempt({
      store: work,
      restore: createNecessaryEvidenceIngress({
        store: f.capture,
        custody: f.custody,
      }).restore,
      monotonicNow: performance.now,
      voice: {
        transcribe: async (request) => {
          calls += 1;
          const wav = Buffer.from(request.audioBase64, 'base64');
          if (wav.length !== 364 || wav.readInt16LE(44) !== 257)
            throw new Error('Wrong original synthetic PCM');
          return { text: 'Controlled STT fixture, not heard speech' };
        },
      },
    });
    const first = await execute(claim, new AbortController().signal),
      again = await execute(claim, new AbortController().signal);
    const [row] = await f.f
      .sql`select c.attempts,c.status,a.outcome,a.candidate_digest is not null as candidate,
   (select count(*)::int from round_transcript_freezes where round_id=${f.roundId}) as freezes,
   (select coalesce(sum(chunk_count),0)::int from transcript_segments where round_id=${f.roundId}) as chunks,
   (select state from necessary_evidence where id=${f.body.evidenceId}) as raw_state
   from transcription_recovery_contexts c join transcription_recovery_attempts a on a.context_id=c.id where c.id=${claim.contextId}`;
    assert({
      given:
        'actual PG receipt/claim and persistent SQLite authentication with a controlled, explicitly synthetic provider response',
      should:
        'invoke once, reconcile replay, retain raw audio and persist provisional metadata without selected transcript or freeze',
      actual: { first: first.kind, again, calls, row },
      expected: {
        first: 'provisional',
        again: { kind: 'reconciled', ordinal: 1 },
        calls: 1,
        row: {
          attempts: 1,
          status: 'leased',
          outcome: 'candidate',
          candidate: true,
          freezes: 0,
          chunks: 0,
          raw_state: 'retained',
        },
      },
    });
  });
});
test('unknown committed admission consumes one ordinal without invocation and later recovery needs a new grant', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed') throw new Error('Expected original claim');
    let calls = 0;
    const shared = {
      restore: createNecessaryEvidenceIngress({
        store: f.capture,
        custody: f.custody,
      }).restore,
      monotonicNow: performance.now,
      voice: {
        transcribe: async () => {
          calls += 1;
          return { text: 'Controlled recovery output' };
        },
      },
    };
    const lost = createTranscriptionAttempt({
      ...shared,
      store: {
        ...work,
        begin: async (raw) => {
          await work.begin(raw);
          throw new Error('Synthetic lost committed reply');
        },
      },
    });
    let failed = false;
    try {
      await lost(claim, new AbortController().signal);
    } catch {
      failed = true;
    }
    const [before] = await f.f
      .sql`select attempts,status from transcription_recovery_contexts where id=${claim.contextId}`;
    const callsBefore = calls;
    await f.f
      .sql`update transcription_recovery_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where id=${claim.contextId}`;
    const next = await work.claim({ workerId: createId() });
    if (next.kind !== 'claimed') throw new Error('Expected new recovery claim');
    const recovered = await createTranscriptionAttempt({
      ...shared,
      store: work,
    })(next, new AbortController().signal);
    const ledger = await f.f
      .sql`select ordinal,outcome from transcription_recovery_attempts where context_id=${claim.contextId} order by ordinal`;
    assert({
      given:
        'a real committed admission whose response is deliberately lost before invocation, then authoritative execution-lease expiry and a new execution claim',
      should:
        'retain the conservative spent ordinal and authorize exactly one later invocation under ordinal2',
      actual: {
        failed,
        before,
        callsBefore,
        calls,
        recovered: recovered.kind,
        ledger: Array.from(ledger),
      },
      expected: {
        failed: true,
        before: { attempts: 1, status: 'leased' },
        callsBefore: 0,
        calls: 1,
        recovered: 'provisional',
        ledger: [
          { ordinal: 1, outcome: 'admitted' },
          { ordinal: 2, outcome: 'candidate' },
        ],
      },
    });
  });
});
for (const revoke of ['round', 'custody'] as const)
  test(`actual ${revoke} revocation during controlled STT fences already held audio and late candidate commit`, async () => {
    await withEvidenceIngress(async (f) => {
      const work = await readyRecognition(f),
        claim = await work.claim({ workerId: createId() });
      if (claim.kind !== 'claimed') throw new Error('Expected original claim');
      let calls = 0;
      const execute = createTranscriptionAttempt({
        store: work,
        restore: createNecessaryEvidenceIngress({
          store: f.capture,
          custody: f.custody,
        }).restore,
        monotonicNow: performance.now,
        voice: {
          transcribe: async () => {
            calls += 1;
            if (revoke === 'round')
              await f.capture.withdrawCaptureEvidence({ roundId: f.roundId });
            else {
              const [row] = await f.f
                .sql`select authority_id,binding_digest from necessary_evidence where id=${f.body.evidenceId}`;
              const revoked = await f.custody.revoke({
                authorityId: row!.authority_id,
                bindingDigest: row!.binding_digest,
                evidenceId: f.body.evidenceId,
              });
              if (revoked.kind !== 'revoked')
                throw new Error('Expected actual custody revocation');
            }
            return { text: 'Controlled late response' };
          },
        },
      });
      let refused = false;
      try {
        await execute(claim, new AbortController().signal);
      } catch {
        refused = true;
      }
      const [row] = await f.f
        .sql`select count(*)::int as selected from transcription_recovery_contexts where round_id=${f.roundId} and status='selected'`;
      const [candidate] = await f.f
        .sql`select candidate_digest from transcription_recovery_attempts where context_id=${claim.contextId}`;
      assert({
        given: `actual ${revoke} revocation while a controlled one-shot call already holds authentic original audio`,
        should:
          'deny late provisional commit and selection without pretending to recall in-flight processing',
        actual: { refused, calls, row, candidate },
        expected: {
          refused: true,
          calls: 1,
          row: { selected: 0 },
          candidate: { candidate_digest: null },
        },
      });
    });
  });
test('canonical withdrawal after admission but before invocation refuses future provider dispatch', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed') throw new Error('Expected original claim');
    let calls = 0;
    const execute = createTranscriptionAttempt({
      store: {
        ...work,
        begin: async (raw) => {
          const admitted = await work.begin(raw);
          await f.capture.withdrawCaptureEvidence({ roundId: f.roundId });
          return admitted;
        },
      },
      restore: createNecessaryEvidenceIngress({
        store: f.capture,
        custody: f.custody,
      }).restore,
      monotonicNow: performance.now,
      voice: {
        transcribe: async () => {
          calls += 1;
          return { text: 'Controlled response' };
        },
      },
    });
    let refused = false;
    try {
      await execute(claim, new AbortController().signal);
    } catch {
      refused = true;
    }
    assert({
      given:
        'a fresh actual PG admission followed by committed canonical withdrawal before its caller receives the grant',
      should: 'recheck dispatch fences and send no future provider request',
      actual: { refused, calls },
      expected: { refused: true, calls: 0 },
    });
  });
});
