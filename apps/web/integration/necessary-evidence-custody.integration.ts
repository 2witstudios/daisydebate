import { requireTestServices } from '@daisy/config';
import { privacyScope } from './necessary-evidence-custody-fixture.test-support';
import { runCustodyProcess as child } from './necessary-evidence-custody.test-support';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';

setupRitewayBun();
requireTestServices(process.env);
const identity = {
  authorityId: 'c'.repeat(24),
  evidenceId: 'a'.repeat(24),
  bindingDigest: 'b'.repeat(64),
};
const payload = new Uint8Array([1, 2, 3, 4]);
test('local custody preserves original identity across restart and irrevocable revocation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-evidence-'));
  initializeLocalEvidenceAuthority({
    path: join(dir, 'authority.sqlite'),
    authorityId: 'c'.repeat(24),
  });
  const authority = openLocalEvidenceAuthority({
    path: join(dir, 'authority.sqlite'),
    authorityId: 'c'.repeat(24),
    nowMs: () => 1000,
  });
  const connect = () =>
    openLocalEvidenceCustody({ path: join(dir, 'keys.sqlite'), authority });
  let custody = connect();
  try {
    const first = await custody.seal(identity, payload, privacyScope);
    assert({
      given: 'a first durable local acquisition',
      should: 'produce ciphertext with the original trusted receipt',
      actual: first.kind === 'sealed' ? first.receipt.receivedAtMs : first.kind,
      expected: 1000,
    });
    custody.close();
    custody = connect();
    const retried = await custody.seal(identity, payload, privacyScope);
    assert({
      given:
        'a lost seal acknowledgement and a restarted adapter with stable authority',
      should:
        'retain exactly the original receipt, expiry and encrypted material',
      actual: first,
      expected: retried,
    });
    const staleClient = connect();
    try {
      await custody.revoke(identity);
      const refusal =
        first.kind === 'sealed' ? await staleClient.open(first) : first;
      assert({
        given: 'an existing client and ciphertext obtained before revocation',
        should:
          'consult current authority and refuse decryption and reacquisition',
        actual: [
          refusal,
          await staleClient.seal(identity, payload, privacyScope),
        ],
        expected: [
          { kind: 'refused', reason: 'revoked' },
          { kind: 'refused', reason: 'revoked' },
        ],
      });
    } finally {
      staleClient.close();
    }
  } finally {
    custody.close();
    authority.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('fresh processes use stable authority after restoring old material and payload snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-evidence-process-'));
  try {
    await child({ operation: 'initialize', dir });
    const sealed = await child({
      operation: 'seal',
      dir,
      now: 1000,
      identity,
      payload: [...payload],
    });
    await copyFile(join(dir, 'keys.sqlite'), join(dir, 'keys.old.sqlite'));
    const opened = await child({
      operation: 'open',
      dir,
      now: 2000,
      evidence: sealed,
    });
    assert({
      given: 'a new process with the same persistent independent authority',
      should: 'decrypt original ciphertext',
      actual: opened,
      expected: {
        kind: 'opened',
        digest: createHash('sha3-256').update(payload).digest('hex'),
      },
    });
    const retry = await child({
      operation: 'seal',
      dir,
      now: 3000,
      identity,
      payload: [...payload],
    });
    assert({
      given: 'an acknowledgement lost before process replacement',
      should:
        'return identical ciphertext and the original receipt without extending expiry',
      actual: retry,
      expected: sealed,
    });
    await child({ operation: 'revoke', dir, now: 4000, identity });
    await copyFile(join(dir, 'keys.old.sqlite'), join(dir, 'keys.sqlite'));
    const restored = await child({
      operation: 'open',
      dir,
      now: 5000,
      evidence: sealed,
    });
    const reacquire = await child({
      operation: 'seal',
      dir,
      now: 5000,
      identity,
      payload: [...payload],
    });
    assert({
      given:
        'old material and old payload restored after revocation with latest independent authority available',
      should:
        'refuse both decryption and reacquisition in another fresh process',
      actual: [restored, reacquire],
      expected: [
        { kind: 'refused', reason: 'revoked' },
        { kind: 'refused', reason: 'revoked' },
      ],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('concurrent fresh-process retries bind one key and missing authority refuses restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-evidence-concurrent-'));
  try {
    await child({ operation: 'initialize', dir });
    const request = {
      operation: 'seal',
      dir,
      now: 1000,
      identity,
      payload: [...payload],
    };
    const [one, two] = await Promise.all([child(request), child(request)]);
    assert({
      given: 'two simultaneous processes acquiring the same evidence identity',
      should: 'commit one original receipt and key with identical ciphertext',
      actual: [one.kind, one],
      expected: ['sealed', two],
    });
    await rm(join(dir, 'authority.sqlite'));
    let refusedRestart = false;
    try {
      await child({ operation: 'open', dir, now: 2000, evidence: one });
    } catch {
      refusedRestart = true;
    }
    assert({
      given: 'lost current authority with old material still present',
      should:
        'refuse ordinary restart without silently provisioning replacement authority',
      actual: {
        refusedRestart,
        recreated: await Bun.file(join(dir, 'authority.sqlite')).exists(),
      },
      expected: { refusedRestart: true, recreated: false },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
