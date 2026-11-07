import { requireTestServices } from '@daisy/config';
import { necessaryEvidencePolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finishedOrBlockedBehind } from '../src/testing';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const boundary of ['lease', 'receipt'] as const)
  test(`payload admission checks ${boundary} expiry after an actual Round lock wait`, async () => {
    await withEvidencePayload(
      async ({ f, client, store, body, sealed, claim, roundId }) => {
        const [clock] = await f.sql`select clock_timestamp() as now`;
        const expires = clock!.now.getTime() + 500;
        const candidate =
          boundary === 'receipt'
            ? {
                ...sealed,
                receipt: {
                  ...sealed.receipt,
                  receivedAtMs: expires - necessaryEvidencePolicy.maxAgeMs,
                  expiresAtMs: expires,
                },
              }
            : sealed;
        if (boundary === 'lease')
          await f.sql`update necessary_evidence set lease_expires_at=${new Date(expires)} where id=${body.evidenceId}`;
        const ready = Promise.withResolvers<number>(),
          release = Promise.withResolvers<void>();
        const holder = client.begin(async (tx) => {
          await tx`select id from rounds where id=${roundId} for no key update`;
          const [backend] = await tx`select pg_backend_pid() as pid`;
          ready.resolve(backend!.pid as number);
          await release.promise;
        });
        let work: Promise<string> | undefined;
        try {
          const pid = await ready.promise;
          const [initial] =
            await f.sql`select clock_timestamp()<${new Date(expires)} as valid`;
          work = store
            .adoptCaptureEvidence({ body, sealed: candidate, claim })
            .then(
              (reply) => reply.kind,
              (error: { code: string }) => error.code,
            );
          const observed = await finishedOrBlockedBehind(work, f.sql, pid, {
            now: performance.now,
          });
          const until = performance.now() + 1500;
          let crossed = false;
          while (performance.now() < until) {
            const [time] =
              await f.sql`select clock_timestamp()>=${new Date(expires)} as expired`;
            if (time!.expired) {
              crossed = true;
              break;
            }
            await Bun.sleep(5);
          }
          release.resolve();
          await holder;
          const result = await work;
          const [row] =
            await f.sql`select state,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
          assert({
            given: `a real blocked payload transaction while the synthetic original ${boundary} deadline crosses (receipt age is backdated, not a measured seven-day wait)`,
            should:
              'sample current DB time after the wait and refuse newly expired work without creating a usable receipt',
            actual: {
              initiallyValid: initial!.valid,
              observed,
              crossed,
              result,
              row,
            },
            expected: {
              initiallyValid: true,
              observed: 'blocked',
              crossed: true,
              result: 'CONFLICT',
              row: { state: 'acquiring', empty: true },
            },
          });
        } finally {
          release.resolve();
          await Promise.allSettled([holder, ...(work ? [work] : [])]);
        }
      },
    );
  });
