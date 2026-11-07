import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Database as SQLite } from 'bun:sqlite';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { openLocalEvidenceAuthority } from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';
import { NecessaryEvidenceRetirement } from '../src/features/media-capture/necessary-evidence-retirement/necessary-evidence-retirement';
if (import.meta.main) {
  const request = await Bun.stdin.json();
  const barrier = (at: string) => {
    const gate = request.barriers?.find((g: { at: string }) => g.at === at);
    if (!gate) return;
    writeFileSync(gate.ready, at);
    const until = performance.now() + 10000;
    while (!existsSync(gate.release)) {
      if (performance.now() > until)
        throw new Error('Retirement proof barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  };
  if (request.operation === 'hold-authority') {
    const db = new SQLite(join(request.dir, 'authority.sqlite'), {
      create: false,
      readwrite: true,
    });
    try {
      db.run('BEGIN IMMEDIATE');
      barrier('authority-locked');
      db.run('ROLLBACK');
    } finally {
      db.close();
    }
    process.stdout.write(JSON.stringify({ kind: 'released' }));
  } else {
    const services = requireTestServices(process.env);
    const database = createDatabase({
      url: services.databaseUrl,
      nextActorId: createId,
    });
    const authority = openLocalEvidenceAuthority({
      path: join(request.dir, 'authority.sqlite'),
      authorityId: 'c'.repeat(24),
      nowMs: Date.now,
    });
    const custody = openLocalEvidenceCustody({
      path: join(request.dir, 'keys.sqlite'),
      authority,
    });
    const store = database.createNecessaryEvidenceRetirement({
      leaseMs: 1000,
      retryMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
    });
    let revokes = 0;
    const service = NecessaryEvidenceRetirement.create({
      workerId: createId(),
      store: {
        ...store,
        claim: async (input) => {
          const claim = await store.claim(input);
          if (claim.kind === 'claimed') barrier('after-claim');
          return claim;
        },
        complete: async (input) => {
          const complete = await store.complete(input);
          if (complete.kind === 'retired') barrier('after-complete');
          return complete;
        },
      },
      custody: {
        ...custody,
        revoke: async (identity) => {
          revokes++;
          const result = await custody.revoke(identity);
          if (result.kind === 'revoked') barrier('after-revoke');
          return result;
        },
      },
    });
    const stop = new AbortController();
    const deadline = setTimeout(() => stop.abort(), 10000);
    try {
      const report =
        request.operation === 'loop'
          ? await service.run({
              signal: stop.signal,
              pollMs: 1000,
              pause: async (ms) => {
                if (existsSync(request.stopFile)) stop.abort();
                else await Bun.sleep(ms);
              },
            })
          : await service.runOnce();
      process.stdout.write(JSON.stringify({ report, revokes }));
    } finally {
      clearTimeout(deadline);
      custody.close();
      authority.close();
      await database.close();
    }
  }
}
export function spawnRetirementProcess(request: object) {
  const child = Bun.spawn([process.execPath, 'run', import.meta.filename], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify(request));
  child.stdin.end();
  return child;
}
