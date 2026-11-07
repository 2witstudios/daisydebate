import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { necessaryEvidencePolicy } from '@daisy/protocol';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
  type EvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';

setupRitewayBun();
const identity = { evidenceId: 'a'.repeat(24), bindingDigest: 'b'.repeat(64) };
const payload = new Uint8Array([1, 2, 3, 4]);
async function fixture(
  work: (f: {
    readonly authority: ReturnType<typeof openLocalEvidenceAuthority>;
    readonly connect: (
      authority?: EvidenceAuthority,
    ) => ReturnType<typeof openLocalEvidenceCustody>;
    readonly advance: (time: number) => void;
    readonly removeMaterial: () => Promise<void>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-custody-fences-'));
  let now = 1000;
  const path = join(dir, 'authority.sqlite');
  initializeLocalEvidenceAuthority({ path, authorityId: 'c'.repeat(24) });
  const authority = openLocalEvidenceAuthority({
    path,
    authorityId: 'c'.repeat(24),
    nowMs: () => now,
  });
  const clients: ReturnType<typeof openLocalEvidenceCustody>[] = [];
  try {
    await work({
      authority,
      advance: (time) => {
        now = time;
      },
      removeMaterial: () => rm(join(dir, 'keys.sqlite')),
      connect: (current = authority) => {
        const client = openLocalEvidenceCustody({
          path: join(dir, 'keys.sqlite'),
          authority: current,
        });
        clients.push(client);
        return client;
      },
    });
  } finally {
    for (const client of clients) client.close();
    authority.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test('original expiry and payload binding survive retries and clock regression', () =>
  fixture(async ({ connect, advance }) => {
    const custody = connect();
    const sealed = await custody.seal(identity, payload);
    if (sealed.kind !== 'sealed') throw new Error('Synthetic fixture failed');
    const conflict = await custody.seal(identity, new Uint8Array([5]));
    advance(1000 + necessaryEvidencePolicy.maxAgeMs);
    const expired = await custody.open(sealed);
    advance(1001);
    const earlierClock = await custody.seal(identity, payload);
    assert({
      given: 'expired local key material',
      should:
        'remove it with bounded retryable cleanup while retaining the authority fence',
      actual: custody.sweep(1),
      expected: { removed: 1, blocked: 0 },
    });
    assert({
      given: 'changed payload, the exact original cap, then a regressed clock',
      should: 'refuse conflicting reuse and never renew expired identity',
      actual: [conflict, expired, earlierClock],
      expected: [
        { kind: 'refused', reason: 'conflict' },
        { kind: 'refused', reason: 'expired' },
        { kind: 'refused', reason: 'expired' },
      ],
    });
  }));
test('a committed key cannot be replaced after material loss', () =>
  fixture(async ({ connect, removeMaterial }) => {
    const first = connect();
    const sealed = await first.seal(identity, payload);
    first.close();
    await removeMaterial();
    const replaced = connect();
    assert({
      given:
        'a missing material database but current authority retains the committed key digest',
      should: 'refuse a replacement key or expiry for that evidence identity',
      actual: [sealed.kind, await replaced.seal(identity, payload)],
      expected: ['sealed', { kind: 'refused', reason: 'uncertain' }],
    });
  }));
test('lost custody acknowledgements retain original identity and revocation', () =>
  fixture(async ({ authority, connect, advance }) => {
    let loseReserve = true,
      loseBind = true,
      loseRevoke = true;
    const lossy: EvidenceAuthority = {
      ...authority,
      reserve: (...args) => {
        const result = authority.reserve(...args);
        if (loseReserve) {
          loseReserve = false;
          return { kind: 'refused', reason: 'unavailable' };
        }
        return result;
      },
      bindKey: (...args) => {
        const result = authority.bindKey(...args);
        if (loseBind) {
          loseBind = false;
          return { kind: 'refused', reason: 'unavailable' };
        }
        return result;
      },
      revoke: (...args) => {
        const result = authority.revoke(...args);
        if (loseRevoke) {
          loseRevoke = false;
          return { kind: 'refused', reason: 'unavailable' };
        }
        return result;
      },
    };
    const custody = connect(lossy);
    const reserve = await custody.seal(identity, payload);
    advance(2000);
    const bind = await custody.seal(identity, payload);
    advance(3000);
    const sealed = await custody.seal(identity, payload);
    assert({
      given: 'lost acknowledgements after real reserve and key-binding commits',
      should: 'retry the same identity and earliest receipt',
      actual: [
        reserve,
        bind,
        sealed.kind === 'sealed' ? sealed.receipt.receivedAtMs : sealed,
      ],
      expected: [
        { kind: 'refused', reason: 'unavailable' },
        { kind: 'refused', reason: 'unavailable' },
        1000,
      ],
    });
    const revoke = await custody.revoke(identity);
    const retry = await custody.revoke(identity);
    assert({
      given: 'a revocation committed before its acknowledgement was lost',
      should: 'finish cleanup idempotently and never reacquire',
      actual: [revoke, retry, await custody.seal(identity, payload)],
      expected: [
        { kind: 'refused', reason: 'unavailable' },
        { kind: 'revoked' },
        { kind: 'refused', reason: 'revoked' },
      ],
    });
  }));
test('revocation during decrypt and unavailable authority refuse plaintext release', () =>
  fixture(async ({ authority, connect }) => {
    const original = connect();
    const sealed = await original.seal(identity, payload);
    if (sealed.kind !== 'sealed') throw new Error('Synthetic fixture failed');
    let firstRead = true;
    const raced = connect({
      ...authority,
      read: (scope) => {
        const result = authority.read(scope);
        if (firstRead) {
          firstRead = false;
          authority.revoke(scope);
        }
        return result;
      },
    });
    const result = await raced.open(sealed);
    authority.close();
    const unavailable = await original.open(sealed);
    assert({
      given:
        'revocation after initial authorization or an unavailable current authority',
      should:
        'refuse plaintext release instead of trusting an earlier read or cached material',
      actual: [result, unavailable],
      expected: [
        { kind: 'refused', reason: 'revoked' },
        { kind: 'refused', reason: 'unavailable' },
      ],
    });
  }));
