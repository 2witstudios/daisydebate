import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  identity,
  payload,
  privacyScope,
} from './necessary-evidence-custody-fixture.test-support';
import {
  finishCustodyProcess,
  runCustodyProcess,
  spawnCustodyProcess,
} from './necessary-evidence-custody.test-support';
setupRitewayBun();
const intent = {
  intentId: 'g'.repeat(24),
  scope: { kind: 'round' as const, roundId: privacyScope.roundId },
  authorizationDigest: '1'.repeat(64),
};
async function marker(path: string) {
  const until = performance.now() + 3000;
  while (!existsSync(path)) {
    if (performance.now() > until)
      throw new Error('Privacy proof marker absent');
    await Bun.sleep(5);
  }
}

test('a committed privacy preparation survives killed acknowledgement and retains its original intent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-privacy-lost-ack-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const evidence = await runCustodyProcess({
    operation: 'seal',
    dir,
    now: 1000,
    identity,
    payload: [...payload],
  });
  await copyFile(join(dir, 'keys.sqlite'), join(dir, 'old-keys.sqlite'));
  const ready = join(dir, 'prepared');
  const producer = spawnCustodyProcess({
    operation: 'prepare-privacy',
    dir,
    now: 2000,
    intent,
    barriers: [
      { at: 'after-privacy-commit', ready, release: join(dir, 'never') },
    ],
  });
  try {
    await marker(ready);
    producer.kill('SIGKILL');
    await producer.exited;
    const retry = await runCustodyProcess({
      operation: 'prepare-privacy',
      dir,
      now: 3000,
      intent: { ...intent, intentId: 'j'.repeat(24) },
    });
    const pending = await runCustodyProcess({
      operation: 'open',
      dir,
      now: 4000,
      evidence,
    });
    const wrongCommit = await runCustodyProcess({
      operation: 'commit-privacy',
      dir,
      now: 4000,
      intent: { ...intent, intentId: 'j'.repeat(24) },
    });
    const committed = await runCustodyProcess({
      operation: 'commit-privacy',
      dir,
      now: 4000,
      intent: retry.intent,
    });
    const swept = await runCustodyProcess({
      operation: 'sweep',
      dir,
      now: 4000,
      limit: 10,
    });
    await copyFile(join(dir, 'old-keys.sqlite'), join(dir, 'keys.sqlite'));
    const restored = await runCustodyProcess({
      operation: 'open',
      dir,
      now: 5000,
      evidence,
    });
    const reacquire = await runCustodyProcess({
      operation: 'seal',
      dir,
      now: 5000,
      identity: { ...identity, evidenceId: 'k'.repeat(24) },
      payload: [...payload],
    });
    const again = await runCustodyProcess({
      operation: 'prepare-privacy',
      dir,
      now: 6000,
      intent,
    });
    assert({
      given:
        'actual SIGKILL after privacy intent commit but before acknowledgement, fresh-process retry, then old material restoration with the independent latest authority',
      should:
        'retain the original sequence/intent, refuse pending use and wrong acknowledgement, then deny restored material and new IDs after sticky commit',
      actual: {
        retry,
        pending,
        wrongCommit,
        committed,
        swept,
        restored,
        reacquire,
        again,
      },
      expected: {
        retry: { kind: 'pending', intent, sequence: 1 },
        pending: { kind: 'refused', reason: 'uncertain' },
        wrongCommit: { kind: 'refused', reason: 'conflict' },
        committed: { kind: 'committed', intent, sequence: 1 },
        swept: { removed: 1, blocked: 0 },
        restored: { kind: 'refused', reason: 'revoked' },
        reacquire: { kind: 'refused', reason: 'revoked' },
        again: { kind: 'committed', intent, sequence: 1 },
      },
    });
  } finally {
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});

test('another process accepting privacy work fences reserved material creation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-privacy-reserve-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const ready = join(dir, 'reserved'),
    release = join(dir, 'continue');
  const producer = spawnCustodyProcess({
    operation: 'seal',
    dir,
    now: 1000,
    identity,
    payload: [...payload],
    barriers: [{ at: 'after-reserve', ready, release }],
  });
  try {
    await marker(ready);
    const prepared = await runCustodyProcess({
      operation: 'prepare-privacy',
      dir,
      now: 2000,
      intent,
    });
    await writeFile(release, 'continue');
    const sealed = await finishCustodyProcess(producer);
    using material = new Database(join(dir, 'keys.sqlite'), { readonly: true });
    const count = material
      .query<{ count: number }, []>('SELECT count(*) as count FROM material')
      .get()!.count;
    assert({
      given:
        'a real producer paused after reservation and a second process accepting privacy work before binding',
      should:
        'deny material creation without treating uncertain authority as deletion permission',
      actual: [prepared.kind, sealed, count],
      expected: ['pending', { kind: 'refused', reason: 'uncertain' }, 0],
    });
  } finally {
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});

test('privacy denial reaches a stale caller holding plaintext without claiming cryptographic recall', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-privacy-held-'));
  await runCustodyProcess({ operation: 'initialize', dir });
  const evidence = await runCustodyProcess({
    operation: 'seal',
    dir,
    now: 1000,
    identity,
    payload: [...payload],
  });
  const ready = join(dir, 'plaintext-held'),
    release = join(dir, 'continue');
  const producer = spawnCustodyProcess({
    operation: 'hold-open',
    dir,
    now: 1000,
    evidence,
    barriers: [{ at: 'after-plaintext', ready, release }],
  });
  try {
    await marker(ready);
    await runCustodyProcess({
      operation: 'prepare-privacy',
      dir,
      now: 2000,
      intent,
    });
    await writeFile(release, 'continue');
    const caller = await finishCustodyProcess(producer);
    assert({
      given:
        'a stale process already holding decrypted bytes before another process accepts privacy work',
      should:
        'retain the honest residual plaintext while denying a fresh future-use check; this does not prove STT/PG settlement cancellation',
      actual: caller,
      expected: {
        heldDigest:
          '966dbdcbd0e0348faa1ccbce5a62b8e73b0d08955d666db82243b303d9bd9502',
        permission: { kind: 'refused', reason: 'uncertain' },
      },
    });
  } finally {
    producer.kill('SIGKILL');
    await producer.exited;
    await rm(dir, { recursive: true, force: true });
  }
});
