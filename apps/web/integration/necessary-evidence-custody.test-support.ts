import { privacyScope } from './necessary-evidence-custody-fixture.test-support';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { EvidenceCustodyIdentity, SealedEvidence } from '@daisy/protocol';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';

/** Fresh process edge for synthetic qualification only; no keys leave this process. */
if (import.meta.main) {
  const request = await Bun.stdin.json();
  if (request.operation === 'initialize') {
    initializeLocalEvidenceAuthority({
      path: join(request.dir, 'authority.sqlite'),
      authorityId: 'c'.repeat(24),
    });
    process.stdout.write(JSON.stringify({ kind: 'initialized' }));
    process.exit(0);
  }
  const backingAuthority = openLocalEvidenceAuthority({
    path: join(request.dir, 'authority.sqlite'),
    authorityId: 'c'.repeat(24),
    nowMs: () =>
      request.clockFile
        ? Number(readFileSync(request.clockFile, 'utf8'))
        : request.now,
  });
  const barrier = (at: string) => {
    const gate = request.barriers?.find(
      (candidate: { at: string }) => candidate.at === at,
    );
    if (!gate) return;
    writeFileSync(gate.ready, at);
    if (!gate.release) return;
    const until = performance.now() + 5000;
    while (!existsSync(gate.release)) {
      if (performance.now() > until)
        throw new Error('Custody proof barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  };
  if (
    request.operation === 'prepare-privacy' ||
    request.operation === 'commit-privacy'
  ) {
    try {
      const result =
        request.operation === 'prepare-privacy'
          ? backingAuthority.preparePrivacy(request.intent)
          : backingAuthority.commitPrivacy(request.intent);
      barrier('after-privacy-commit');
      process.stdout.write(JSON.stringify(result));
    } finally {
      backingAuthority.close();
    }
    process.exit(0);
  }
  const authority = {
    ...backingAuthority,
    reserve: (...args: Parameters<typeof backingAuthority.reserve>) => {
      const result = backingAuthority.reserve(...args);
      if (result.kind === 'current') barrier('after-reserve');
      return result;
    },
    bindMaterial: (
      identity: Parameters<typeof backingAuthority.bindMaterial>[0],
      work: Parameters<typeof backingAuthority.bindMaterial>[1],
    ) =>
      backingAuthority.bindMaterial(identity, (current, revalidate) => {
        barrier('before-material');
        const result = work(current, revalidate);
        barrier('after-material');
        return result;
      }),
  };
  const custody = openLocalEvidenceCustody({
    path: join(request.dir, 'keys.sqlite'),
    authority,
  });
  try {
    barrier('constructed');
    if (request.operation === 'seal') {
      const result = await custody.seal(
        request.identity as EvidenceCustodyIdentity,
        new Uint8Array(request.payload),
        request.privacyScope,
      );
      process.stdout.write(
        JSON.stringify(
          result.kind === 'sealed'
            ? {
                ...result,
                ciphertext: [...result.ciphertext],
                nonce: [...result.nonce],
                tag: [...result.tag],
              }
            : result,
        ),
      );
    } else if (
      request.operation === 'open' ||
      request.operation === 'hold-open'
    ) {
      const result = await custody.open({
        ...request.evidence,
        ciphertext: new Uint8Array(request.evidence.ciphertext),
        nonce: new Uint8Array(request.evidence.nonce),
        tag: new Uint8Array(request.evidence.tag),
      } as SealedEvidence);
      if (request.operation === 'hold-open') {
        barrier('after-plaintext');
        const permission = await custody.inspect(
          request.evidence.receipt,
          request.privacyScope,
        );
        process.stdout.write(
          JSON.stringify({
            heldDigest:
              result.kind === 'opened'
                ? createHash('sha3-256').update(result.plaintext).digest('hex')
                : null,
            permission,
          }),
        );
      } else
        process.stdout.write(
          JSON.stringify(
            result.kind === 'opened'
              ? {
                  kind: result.kind,
                  digest: createHash('sha3-256')
                    .update(result.plaintext)
                    .digest('hex'),
                }
              : result,
          ),
        );
    } else if (request.operation === 'inspect') {
      process.stdout.write(
        JSON.stringify(
          await custody.inspect(request.identity, request.privacyScope),
        ),
      );
    } else if (request.operation === 'sweep') {
      process.stdout.write(JSON.stringify(custody.sweep(request.limit)));
    } else if (request.operation === 'revoke') {
      process.stdout.write(
        JSON.stringify(await custody.revoke(request.identity)),
      );
    } else throw new TypeError('Invalid custody proof operation');
  } finally {
    custody.close();
    authority.close();
  }
}

export function spawnCustodyProcess(request: object) {
  const child = Bun.spawn([process.execPath, 'run', import.meta.filename], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify({ privacyScope, ...request }));
  child.stdin.end();
  return child;
}
export async function finishCustodyProcess(
  child: ReturnType<typeof spawnCustodyProcess>,
) {
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error('Custody qualification child failed', { cause: error });
  return JSON.parse(output);
}
export const runCustodyProcess = (request: object) =>
  finishCustodyProcess(spawnCustodyProcess(request));
