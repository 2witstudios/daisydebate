import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  fixture,
  identity,
  payload,
  privacyScope,
} from './necessary-evidence-custody-fixture.test-support';

setupRitewayBun();
requireTestServices(process.env);
test('custody refuses foreign original routing before acquisition or retirement', async () => {
  await fixture(async ({ connect, authority }) => {
    const custody = connect();
    const foreign = { ...identity, authorityId: 'f'.repeat(24) };
    const seal = await custody.seal(foreign, payload, privacyScope);
    const afterSeal = authority.read(identity);
    const revoke = await custody.revoke(foreign);
    const afterRevoke = authority.read(identity);
    assert({
      given:
        'a different configured custody resource than the original durable route',
      should:
        'refuse both operations without reserving or tombstoning the unrelated authority',
      actual: { seal, afterSeal, revoke, afterRevoke },
      expected: {
        seal: { kind: 'refused', reason: 'conflict' },
        afterSeal: { kind: 'refused', reason: 'uncertain' },
        revoke: { kind: 'refused', reason: 'conflict' },
        afterRevoke: { kind: 'refused', reason: 'uncertain' },
      },
    });
  });
});

test('material cache cannot be restored into a replacement authority realm', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { initializeLocalEvidenceAuthority, openLocalEvidenceAuthority } =
    await import('../src/features/media-capture/local-evidence-authority');
  const { openLocalEvidenceCustody } =
    await import('../src/features/media-capture/local-evidence-custody');
  const dir = await mkdtemp(join(tmpdir(), 'daisy-evidence-realm-'));
  const authorities = ['c', 'f'].map((letter) => {
    const authorityId = letter.repeat(24),
      path = join(dir, `${letter}.sqlite`);
    initializeLocalEvidenceAuthority({ path, authorityId });
    return openLocalEvidenceAuthority({ path, authorityId, nowMs: () => 1000 });
  });
  const materialPath = join(dir, 'material.sqlite');
  let acceptedForeignCache = false;
  try {
    const first = openLocalEvidenceCustody({
      path: materialPath,
      authority: authorities[0]!,
    });
    const acquired = await first.seal(
      { ...identity, authorityId: 'c'.repeat(24) },
      payload,
      privacyScope,
    );
    first.close();
    try {
      const replacement = openLocalEvidenceCustody({
        path: materialPath,
        authority: authorities[1]!,
      });
      acceptedForeignCache = true;
      replacement.close();
    } catch {
      /* Explicit foreign-realm startup refusal. */
    }
    assert({
      given:
        'retained material from A and a separately provisioned current authority B',
      should:
        'refuse cache adoption before operations, without claiming same-ID rollback detection',
      actual: { acquired: acquired.kind, acceptedForeignCache },
      expected: { acquired: 'sealed', acceptedForeignCache: false },
    });
  } finally {
    for (const authority of authorities) authority.close();
    await rm(dir, { recursive: true, force: true });
  }
});
