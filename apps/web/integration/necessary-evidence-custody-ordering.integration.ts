import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { necessaryEvidencePolicy } from '@daisy/protocol';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  finishCustodyProcess,
  runCustodyProcess,
  spawnCustodyProcess,
} from './necessary-evidence-custody.test-support';
setupRitewayBun();
const identity = {
  authorityId: 'c'.repeat(24),
  evidenceId: 'a'.repeat(24),
  bindingDigest: 'b'.repeat(64),
};
const payload = [1, 2, 3, 4];
async function marker(path: string) {
  const until = performance.now() + 3000;
  while (!existsSync(path)) {
    if (performance.now() > until)
      throw new Error('Custody proof marker absent');
    await Bun.sleep(5);
  }
}
test('a real process cannot create material after another process revoked its reserved identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-custody-order-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const ready = join(dir, 'reserved'),
    release = join(dir, 'continue');
  const producer = spawnCustodyProcess({
    operation: 'seal',
    dir,
    now: 1000,
    identity,
    payload,
    barriers: [{ at: 'after-reserve', ready, release }],
  });
  try {
    await marker(ready);
    const revoked = await runCustodyProcess({
      operation: 'revoke',
      dir,
      now: 2000,
      identity,
    });
    await writeFile(release, 'continue');
    const refused = await finishCustodyProcess(producer);
    using material = new Database(join(dir, 'keys.sqlite'), { readonly: true });
    const row = material
      .query<{ count: number }, []>('select count(*) as count from material')
      .get();
    assert({
      given:
        'process A paused after durable reservation, process B completing revocation, then A attempting material creation',
      should:
        'refuse revoked work without leaving newly created material after cleanup confirmation',
      actual: { revoked, refused, count: row?.count },
      expected: {
        revoked: { kind: 'revoked' },
        refused: { kind: 'refused', reason: 'revoked' },
        count: 0,
      },
    });
  } finally {
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});

function materialSummary(dir: string) {
  using db = new Database(join(dir, 'keys.sqlite'), { readonly: true });
  const rows = db
    .query<{ key: Uint8Array; nonce: Uint8Array }, []>(
      'select key,nonce from material',
    )
    .all();
  return {
    count: rows.length,
    digest:
      rows.length === 1
        ? createHash('sha3-256')
            .update(rows[0]!.key)
            .update(rows[0]!.nonce)
            .digest('hex')
        : null,
  };
}
test('process death after material commit preserves original identity, key, nonce and expiry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-custody-bind-crash-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const ready = join(dir, 'material-committed');
  const producer = spawnCustodyProcess({
    operation: 'seal',
    dir,
    now: 1000,
    identity,
    payload,
    barriers: [
      { at: 'after-material', ready, release: join(dir, 'never-released') },
    ],
  });
  try {
    await marker(ready);
    const before = materialSummary(dir);
    producer.kill('SIGKILL');
    await producer.exited;
    const resumed = await runCustodyProcess({
      operation: 'seal',
      dir,
      now: 3000,
      identity,
      payload,
    });
    const after = materialSummary(dir);
    const opened = await runCustodyProcess({
      operation: 'open',
      dir,
      now: 4000,
      evidence: resumed,
    });
    assert({
      given:
        'actual SIGKILL after material committed and before authority key-binding commit, then fresh process recovery',
      should:
        'reconcile the same material/nonce and earliest receipt rather than mint replacements',
      actual: {
        beforeCount: before.count,
        sameMaterial: before.digest === after.digest,
        afterCount: after.count,
        kind: resumed.kind,
        received: resumed.receipt?.receivedAtMs,
        expires: resumed.receipt?.expiresAtMs,
        opened: opened.kind,
      },
      expected: {
        beforeCount: 1,
        sameMaterial: true,
        afterCount: 1,
        kind: 'sealed',
        received: 1000,
        expires: 1000 + necessaryEvidencePolicy.maxAgeMs,
        opened: 'opened',
      },
    });
  } finally {
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});
test('expiry is revalidated after a real material-lock wait before creation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-custody-expiry-wait-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const clockFile = join(dir, 'clock');
  await writeFile(clockFile, '1000');
  const constructed = join(dir, 'constructed'),
    begin = join(dir, 'begin'),
    waiting = join(dir, 'authority-held');
  const producer = spawnCustodyProcess({
    operation: 'seal',
    dir,
    identity,
    payload,
    clockFile,
    barriers: [
      { at: 'constructed', ready: constructed, release: begin },
      { at: 'before-material', ready: waiting },
    ],
  });
  let lock: Database | undefined;
  try {
    await marker(constructed);
    lock = new Database(join(dir, 'keys.sqlite'), {
      readwrite: true,
      create: false,
    });
    lock.run('BEGIN IMMEDIATE');
    await writeFile(begin, 'continue');
    await marker(waiting);
    await writeFile(clockFile, String(1000 + necessaryEvidencePolicy.maxAgeMs));
    lock.run('COMMIT');
    lock.close();
    lock = undefined;
    const refused = await finishCustodyProcess(producer);
    assert({
      given:
        'another process holding the material lock while original expiry crosses',
      should:
        'recheck original expiry after the wait and create no newly usable or orphan material',
      actual: { refused, material: materialSummary(dir).count },
      expected: {
        refused: { kind: 'refused', reason: 'expired' },
        material: 0,
      },
    });
  } finally {
    if (lock) {
      lock.run('ROLLBACK');
      lock.close();
    }
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});
