import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createDatabase } from '@daisy/db';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { captureRule } from '@daisy/debate-engine';
import {
  CAPTURE_STT_LAG_MS,
  canonicalCaptureEvidenceBody,
} from '@daisy/protocol';
import { openLocalEvidenceAuthority } from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';

if (import.meta.main) {
  const request = await Bun.stdin.json();
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
  const capture = database.createMediaCaptureOperations({
    sttLagMs: CAPTURE_STT_LAG_MS,
    captureRule,
    nextId: createId,
    buildProjection: () => {
      throw new Error('Historical process fixture cannot invent live play');
    },
    evidence: {
      leaseMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
      maxRoundBytes: 1024 * 1024,
      maxGlobalBytes: 4 * 1024 * 1024,
      maxOutstandingIntents: 128,
    },
  });
  const barrier = (at: string) => {
    const gate = request.barriers?.find(
      (candidate: { at: string }) => candidate.at === at,
    );
    if (!gate) return;
    writeFileSync(gate.ready, at);
    const until = performance.now() + 5000;
    while (!existsSync(gate.release)) {
      if (performance.now() > until)
        throw new Error('Evidence process proof barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  };
  let reserves = 0,
    adopts = 0;
  let openedOwned: Uint8Array | undefined, retainedCopy: Uint8Array | undefined;
  try {
    const ingress = createNecessaryEvidenceIngress({
      store: {
        ...capture,
        reserveCaptureEvidence: (...args) => {
          reserves++;
          return capture.reserveCaptureEvidence(...args);
        },
        adoptCaptureEvidence: async (...args) => {
          adopts++;
          const result = await capture.adoptCaptureEvidence(...args);
          barrier('after-payload-commit');
          return result;
        },
      },
      custody: {
        ...custody,
        seal: async (...args) => {
          const result = await custody.seal(...args);
          if (result.kind === 'sealed') barrier('after-custody-seal');
          return result;
        },
        open: async (...args) => {
          const result = await custody.open(...args);
          if (
            result.kind === 'opened' &&
            request.barriers?.some(
              (gate: { at: string }) => gate.at === 'after-plaintext',
            )
          ) {
            openedOwned = result.plaintext;
            retainedCopy = Uint8Array.from(result.plaintext);
            barrier('after-plaintext');
          }
          return result;
        },
      },
    });
    const result =
      request.operation === 'restore'
        ? await ingress.restore({
            roundId: request.roundId,
            evidenceId: request.evidenceId,
          })
        : await ingress.receive(request.body);
    const restored =
      result.kind === 'restored'
        ? canonicalCaptureEvidenceBody(result.body)
        : null;
    const reply = result.kind === 'restored' ? result.receipt : result;
    process.stdout.write(
      JSON.stringify({
        reply,
        restoredDigest:
          restored?.kind === 'encoded'
            ? createHash('sha3-256').update(restored.json).digest('hex')
            : null,
        calls: { reserves, adopts },
        ownedPlaintextCleared: openedOwned
          ? openedOwned.every((byte) => byte === 0)
          : null,
        retainedDigest: retainedCopy
          ? createHash('sha3-256').update(retainedCopy).digest('hex')
          : null,
      }),
    );
  } finally {
    custody.close();
    authority.close();
    await database.close();
  }
}
export function spawnEvidenceIngress(request: object) {
  const child = Bun.spawn([process.execPath, 'run', import.meta.filename], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify(request));
  child.stdin.end();
  return child;
}
export async function finishEvidenceIngress(
  child: ReturnType<typeof spawnEvidenceIngress>,
) {
  const [output, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`Evidence process qualification child exited ${code}`);
  return JSON.parse(output);
}
export const runEvidenceIngress = (request: object) =>
  finishEvidenceIngress(spawnEvidenceIngress(request));
