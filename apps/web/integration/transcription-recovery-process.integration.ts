import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { readyRecognition } from './transcription-recovery.test-support';
import { spawnRecognitionProcess } from './transcription-recovery-process.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('fresh recognition process reconciles actual SIGKILL after admission commit before acknowledgement', async () => {
  await withEvidenceIngress(async (f) => {
    const work = await readyRecognition(f),
      claim = await work.claim({ workerId: createId() });
    if (claim.kind !== 'claimed') throw new Error('Expected recognition work');
    const ready = join(f.dir, 'recognition-admitted'),
      release = join(f.dir, 'never-release');
    const child = spawnRecognitionProcess({ claim, ready, release });
    try {
      const until = performance.now() + 5000;
      while (!existsSync(ready)) {
        if (child.exitCode !== null || performance.now() > until)
          throw new Error('Missing actual admission barrier');
        await Bun.sleep(5);
      }
      child.kill('SIGKILL');
      await child.exited;
      const fresh = spawnRecognitionProcess({ claim });
      const [out, , code] = await Promise.all([
        new Response(fresh.stdout).text(),
        new Response(fresh.stderr).text(),
        fresh.exited,
      ]);
      if (code !== 0) throw new Error('Fresh recognition process failed');
      const [row] = await f.f
        .sql`select attempts,status from transcription_recovery_contexts where id=${claim.contextId}`;
      const [ledger] = await f.f
        .sql`select count(*)::integer as count,min(ordinal)::integer as ordinal from transcription_recovery_attempts where context_id=${claim.contextId}`;
      assert({
        given:
          'real original receipt and a separate process killed after durable call admission but before its reply',
        should:
          'reconcile the same epoch from a fresh process without another allowance or dispatch permission',
        actual: { fresh: JSON.parse(out), row, ledger },
        expected: {
          fresh: { kind: 'already-admitted', ordinal: 1 },
          row: { attempts: 1, status: 'leased' },
          ledger: { count: 1, ordinal: 1 },
        },
      });
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await child.exited;
      }
    }
  });
});
