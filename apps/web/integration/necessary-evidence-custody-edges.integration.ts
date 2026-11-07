import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fixture,
  identity,
  payload,
  privacyScope,
} from './necessary-evidence-custody-fixture.test-support';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';
import { necessaryEvidencePolicy } from '@daisy/protocol';
setupRitewayBun();
requireTestServices(process.env);

test('authenticated envelope corruption is distinct from unavailable custody', () =>
  fixture(async ({ connect }) => {
    const custody = connect(),
      sealed = await custody.seal(identity, payload, privacyScope);
    if (sealed.kind !== 'sealed') throw new Error('Synthetic seal failed');
    const tag = Uint8Array.from(sealed.tag);
    tag[0] = tag[0]! ^ 1;
    const rejected = await custody.open({ ...sealed, tag });
    const original = await custody.open(sealed);
    assert({
      given:
        'a well-shaped but flipped GCM tag with current actual local authority/material',
      should:
        'refuse integrity conflict without poisoning or mislabeling the original payload as unavailable',
      actual: { rejected, original: original.kind },
      expected: {
        rejected: { kind: 'refused', reason: 'conflict' },
        original: 'opened',
      },
    });
    if (original.kind === 'opened') original.plaintext.fill(0);
  }));
test('unsafe original lifetime arithmetic cannot poison the durable authority clock', () =>
  fixture(async ({ connect, advance }) => {
    const custody = connect();
    advance(Number.MAX_SAFE_INTEGER);
    const refused = await custody.seal(identity, payload, privacyScope);
    advance(1001);
    const retried = await custody.seal(identity, payload, privacyScope);
    assert({
      given:
        'an injected clock sample that cannot safely contain the original seven-day lifetime, followed by a valid sample',
      should:
        'refuse before advancing durable time or creating material, then retain the genuine original receipt of the valid attempt',
      actual: {
        refused,
        retry: retried.kind,
        received:
          retried.kind === 'sealed' ? retried.receipt.receivedAtMs : null,
        expires: retried.kind === 'sealed' ? retried.receipt.expiresAtMs : null,
      },
      expected: {
        refused: { kind: 'refused', reason: 'unavailable' },
        retry: 'sealed',
        received: 1001,
        expires: 1001 + necessaryEvidencePolicy.maxAgeMs,
      },
    });
  }));
test('a dangling custody symlink cannot create material outside its checked directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'daisy-evidence-link-home-')),
    outside = await mkdtemp(join(tmpdir(), 'daisy-evidence-link-outside-'));
  const authorityPath = join(home, 'authority.sqlite'),
    target = join(outside, 'unexpected.sqlite'),
    path = join(home, 'material.sqlite');
  initializeLocalEvidenceAuthority({
    path: authorityPath,
    authorityId: identity.authorityId,
  });
  const authority = openLocalEvidenceAuthority({
    path: authorityPath,
    authorityId: identity.authorityId,
    nowMs: () => 1000,
  });
  let custody: ReturnType<typeof openLocalEvidenceCustody> | undefined;
  try {
    await symlink(target, path);
    let refused = false;
    try {
      custody = openLocalEvidenceCustody({ path, authority });
    } catch {
      refused = true;
    }
    assert({
      given:
        'a dangling material path symlink in an otherwise owner-only directory',
      should: 'refuse before SQLite creates its target outside that directory',
      actual: { refused, targetCreated: existsSync(target) },
      expected: { refused: true, targetCreated: false },
    });
  } finally {
    custody?.close();
    authority.close();
    await Promise.all([
      rm(home, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

test('custody authenticates its bounded validated envelope snapshot', () =>
  fixture(async ({ connect }) => {
    const custody = connect(),
      sealed = await custody.seal(identity, payload, privacyScope);
    if (sealed.kind !== 'sealed') throw new Error('Synthetic seal failed');
    let reads = 0;
    const changing = { ...sealed };
    Object.defineProperty(changing, 'ciphertext', {
      get: () => {
        reads++;
        return reads === 1
          ? sealed.ciphertext
          : new Uint8Array(necessaryEvidencePolicy.maxPayloadBytes + 1);
      },
    });
    const opened = await custody.open(changing);
    assert({
      given:
        'an edge object whose ciphertext changes after its first validation read (fault wrapper, not a serialized transport claim)',
      should:
        'use one owned bounded snapshot rather than consuming a second unchecked body',
      actual: { kind: opened.kind, reads },
      expected: { kind: 'opened', reads: 1 },
    });
    if (opened.kind === 'opened') opened.plaintext.fill(0);
  }));
