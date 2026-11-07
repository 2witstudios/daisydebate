import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { createTranscriptionAttempt } from '../src/features/transcription-recovery/attempt';
import { startTranscriptionRecoveryService } from '../src/features/transcription-recovery/service';
import {
  manualTimers,
  failureLog,
} from '../src/lib/worker-timers.test-support';
setupRitewayBun();
requireTestServices(process.env);
for (const expired of [false, true])
  test(`actual PG renewal with expired=${expired} fences the held controlled recognition reply`, async () => {
    await withEvidenceIngress(async (f) => {
      const work = await readyRecognition(f),
        { timers, tasks } = manualTimers(),
        log = failureLog();
      const entered = Promise.withResolvers<void>(),
        response = Promise.withResolvers<void>(),
        finished = Promise.withResolvers<void>();
      let calls = 0,
        released = 0,
        providerSignal: AbortSignal | undefined;
      const execute = createTranscriptionAttempt({
        store: work,
        restore: createNecessaryEvidenceIngress({
          store: f.capture,
          custody: f.custody,
        }).restore,
        monotonicNow: performance.now,
        voice: {
          transcribe: async ({ signal }) => {
            calls++;
            providerSignal = signal;
            entered.resolve();
            // Deliberately model an external request which cannot be recalled by abort.
            await response.promise;
            return { text: 'Controlled late response, never heard words' };
          },
        },
      });
      const service = startTranscriptionRecoveryService({
        store: work,
        workerId: createId(),
        timers,
        failed: log.failed,
        limits: {
          parallel: 1,
          claimBatch: 2,
          scanMs: 1000,
          enrollMs: 2000,
          renewMs: 3000,
        },
        enroll: async (target) => {
          const restored = await createNecessaryEvidenceIngress({
            store: f.capture,
            custody: f.custody,
          }).restore(target);
          if (restored.kind === 'restored')
            await work.enroll({ body: restored.body });
        },
        reserveCapacity: () => () => {
          released++;
        },
        execute: (claim, signal) =>
          execute(claim, signal).finally(() => finished.resolve()),
      });
      let entryTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await service.started;
        await Promise.race([
          entered.promise,
          new Promise<never>(
            (_, reject) =>
              (entryTimer = setTimeout(
                () => reject(new Error('Controlled provider never entered')),
                5000,
              )),
          ),
        ]);
        if (expired)
          await f.f
            .sql`update transcription_recovery_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${f.roundId}`;
        await tasks.get(3000)!();
        const heldSlot = released === 0,
          abortedByRenewal = providerSignal?.aborted;
        response.resolve();
        await finished.promise;
        await service.stop();
        const [row] = await f.f
          .sql`select c.status,c.attempts,a.outcome,(a.candidate_digest is not null) as candidate from transcription_recovery_contexts c join transcription_recovery_attempts a on a.context_id=c.id where c.round_id=${f.roundId}`;
        assert({
          given: `actual original receipt/PG admission, controlled provider held, and expired=${expired} execution lease`,
          should:
            'renew independently, hold capacity until execution settles and accept only a current provisional candidate, never authoritative settlement',
          actual: {
            calls,
            aborted: providerSignal?.aborted,
            abortedByRenewal,
            heldSlot,
            released,
            failures: log.failures.length,
            row,
          },
          expected: {
            calls: 1,
            aborted: true,
            abortedByRenewal: expired,
            heldSlot: true,
            released: 1,
            failures: expired ? 1 : 0,
            row: {
              status: 'leased',
              attempts: 1,
              outcome: expired ? 'admitted' : 'candidate',
              candidate: !expired,
            },
          },
        });
      } finally {
        clearTimeout(entryTimer);
        response.resolve();
        await service.stop();
      }
    });
  });
