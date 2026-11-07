import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { EvidenceIdentity, SealedEvidence } from '@daisy/protocol';
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
  const authority = openLocalEvidenceAuthority({
    path: join(request.dir, 'authority.sqlite'),
    authorityId: 'c'.repeat(24),
    nowMs: () => request.now,
  });
  const custody = openLocalEvidenceCustody({
    path: join(request.dir, 'keys.sqlite'),
    authority,
  });
  try {
    if (request.operation === 'seal') {
      const result = await custody.seal(
        request.identity as EvidenceIdentity,
        new Uint8Array(request.payload),
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
    } else if (request.operation === 'open') {
      const result = await custody.open({
        ...request.evidence,
        ciphertext: new Uint8Array(request.evidence.ciphertext),
        nonce: new Uint8Array(request.evidence.nonce),
        tag: new Uint8Array(request.evidence.tag),
      } as SealedEvidence);
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
