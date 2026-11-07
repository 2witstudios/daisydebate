import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { createTranscriptionAttempt } from '../src/features/transcription-recovery/attempt';
setupRitewayBun();
requireTestServices(process.env);
for (const replay of ['cancelled', 'restore-failed'] as const)
  test(`a ${replay} replay cannot release the original in-flight admission`, async () => {
    await withEvidenceIngress(async (f) => {
      const work = await readyRecognition(f),
        claim = await work.claim({ workerId: createId() });
      if (claim.kind !== 'claimed') throw new Error('Expected original claim');
      const ingress = createNecessaryEvidenceIngress({
        store: f.capture,
        custody: f.custody,
      });
      let entered!: () => void,
        resume!: () => void,
        failRestore = false,
        calls = 0;
      const started = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          resume = resolve;
        });
      const execute = createTranscriptionAttempt({
        store: work,
        restore: async (raw) => {
          if (failRestore) throw new Error('Controlled replay restore outage');
          return ingress.restore(raw);
        },
        monotonicNow: performance.now,
        voice: {
          transcribe: async () => {
            calls += 1;
            entered();
            await gate;
            return { text: 'Controlled original in-flight response' };
          },
        },
      });
      const original = execute(claim, new AbortController().signal).then(
        (reply) => reply.kind,
        () => 'failed',
      );
      try {
        await Promise.race([started, original]);
        if (calls !== 1)
          throw new Error('Original never reached controlled provider');
        const abort = new AbortController();
        if (replay === 'cancelled') abort.abort();
        else failRestore = true;
        let rejected = false;
        try {
          await execute(claim, abort.signal);
        } catch {
          rejected = true;
        }
        failRestore = false;
        resume();
        const outcome = await original;
        const [row] = await f.f
          .sql`select c.status,c.attempts,a.outcome from transcription_recovery_contexts c join transcription_recovery_attempts a on a.context_id=c.id where c.id=${claim.contextId}`;
        assert({
          given: `the original admitted invocation is held in-flight and another same-claim ${replay} invocation fails before obtaining admission`,
          should:
            'reject only the replay and preserve the original lease/candidate without another provider call',
          actual: { rejected, outcome, calls, row },
          expected: {
            rejected: true,
            outcome: 'provisional',
            calls: 1,
            row: { status: 'leased', attempts: 1, outcome: 'candidate' },
          },
        });
      } finally {
        failRestore = false;
        resume();
        await original;
      }
    });
  });
