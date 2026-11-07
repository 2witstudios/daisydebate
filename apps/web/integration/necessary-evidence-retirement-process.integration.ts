import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { NecessaryEvidenceRetirement } from '../src/features/media-capture/necessary-evidence-retirement/necessary-evidence-retirement';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { spawnRetirementProcess } from './necessary-evidence-retirement-process.test-support';
setupRitewayBun();
requireTestServices(process.env);
async function marker(path: string) {
  const until = performance.now() + 5000;
  while (!existsSync(path)) {
    if (performance.now() > until) throw new Error('Retirement marker missing');
    await Bun.sleep(5);
  }
}
async function finish(child: ReturnType<typeof spawnRetirementProcess>) {
  const [out, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Retirement child exited ${code}`);
  return JSON.parse(out);
}
for (const stage of ['after-claim', 'after-revoke', 'after-complete'] as const)
  test(`fresh retirement process reconciles actual SIGKILL ${stage} without minting new identity or releasing unconfirmed debt`, async () => {
    await withEvidenceIngress(
      async ({ f, dir, capture, custody, body, authority }) => {
        await createNecessaryEvidenceIngress({
          store: capture,
          custody,
        }).receive(body);
        const [original] =
          await f.sql`select authority_id,binding_digest,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${body.evidenceId}`;
        await capture.withdrawCaptureEvidence({ roundId: body.roundId });
        const ready = join(dir, stage),
          release = join(dir, 'never');
        const child = spawnRetirementProcess({
          dir,
          barriers: [{ at: stage, ready, release }],
        });
        try {
          await marker(ready);
          const [interrupted] =
            await f.sql`select state,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
          child.kill('SIGKILL');
          await child.exited;
          const until = performance.now() + 3000;
          while (performance.now() < until) {
            const [due] =
              await f.sql`select lease_expires_at is null or lease_expires_at<=clock_timestamp() as due from necessary_evidence where id=${body.evidenceId}`;
            if (due!.due) break;
            await Bun.sleep(5);
          }
          const next = await finish(spawnRetirementProcess({ dir }));
          const [after] =
            await f.sql`select state,authority_id,binding_digest,received_at,expires_at,payload_accepted_at from necessary_evidence where id=${body.evidenceId}`;
          const key = authority.read({
            evidenceId: body.evidenceId,
            bindingDigest: original!.binding_digest,
          });
          assert({
            given: `actual SIGKILL ${stage} with original durable PG routing/payload receipt and independently persistent custody`,
            should:
              'keep unconfirmed debt until fresh-process cleanup, retain original receipt/expiry and never reacquire a replacement key',
            actual: {
              interrupted,
              next,
              state: after!.state,
              original: { ...after, state: undefined },
              key,
            },
            expected: {
              interrupted: {
                state: stage === 'after-complete' ? 'retired' : 'retiring',
                empty: true,
              },
              next: {
                report: {
                  attached: stage === 'after-complete' ? 'idle' : 'retired',
                  detached: 'idle',
                },
                revokes: stage === 'after-complete' ? 0 : 1,
              },
              state: 'retired',
              original: { ...original, state: undefined },
              key: { kind: 'refused', reason: 'revoked' },
            },
          });
        } finally {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
            await child.exited;
          }
        }
      },
    );
  });

test('actual custody lock outage keeps retiring debt and a fresh scheduled worker makes progress after recovery', async () => {
  await withEvidenceIngress(
    async ({ f, dir, capture, custody, body, authority }) => {
      await createNecessaryEvidenceIngress({ store: capture, custody }).receive(
        body,
      );
      const [original] =
        await f.sql`select binding_digest from necessary_evidence where id=${body.evidenceId}`;
      await capture.withdrawCaptureEvidence({ roundId: body.roundId });
      const ready = join(dir, 'authority-locked'),
        release = join(dir, 'release');
      const holder = spawnRetirementProcess({
        dir,
        operation: 'hold-authority',
        barriers: [{ at: 'authority-locked', ready, release }],
      });
      try {
        await marker(ready);
        const store = f.store.createNecessaryEvidenceRetirement({
          leaseMs: 15000,
          retryMs: 1000,
          nextToken: () => randomBytes(32).toString('base64url'),
        });
        const blocked = await NecessaryEvidenceRetirement.create({
          store,
          custody,
          workerId: createId(),
        }).runOnce();
        const [debt] =
          await f.sql`select state,lease_digest is null as released,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
        await writeFile(release, 'release');
        await finish(holder);
        const keyBefore = authority.read({
          evidenceId: body.evidenceId,
          bindingDigest: original!.binding_digest,
        });
        const stopFile = join(dir, 'stop');
        const worker = spawnRetirementProcess({
          dir,
          operation: 'loop',
          stopFile,
        });
        try {
          const until = performance.now() + 6000;
          let retired = false;
          while (performance.now() < until) {
            const [row] =
              await f.sql`select state from necessary_evidence where id=${body.evidenceId}`;
            if (row!.state === 'retired') {
              retired = true;
              break;
            }
            await Bun.sleep(20);
          }
          await writeFile(stopFile, 'stop');
          const finished = await finish(worker);
          assert({
            given:
              'a separate process holding the actual authority write lock across the adapter timeout, followed by release and a new worker polling bounded due work',
            should:
              'refuse completion during outage, keep key/unconfirmed count debt, then retire after real backoff without a manual per-ID retry',
            actual: {
              blocked,
              debt,
              keyBefore: keyBefore.kind,
              retired,
              finished,
            },
            expected: {
              blocked: { attached: 'pending', detached: 'idle' },
              debt: { state: 'retiring', released: true, empty: true },
              keyBefore: 'current',
              retired: true,
              finished: { report: { kind: 'stopped' }, revokes: 1 },
            },
          });
        } finally {
          if (worker.exitCode === null) {
            worker.kill('SIGKILL');
            await worker.exited;
          }
        }
      } finally {
        if (holder.exitCode === null) {
          await writeFile(release, 'release');
          await finish(holder);
        }
      }
    },
  );
});
