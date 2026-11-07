import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import {
  finishEvidenceIngress,
  runEvidenceIngress,
  spawnEvidenceIngress,
} from './necessary-evidence-ingress-process.test-support';
setupRitewayBun();
requireTestServices(process.env);
async function marker(path: string) {
  const until = performance.now() + 4000;
  while (!existsSync(path)) {
    if (performance.now() > until)
      throw new Error('Evidence process stage was not reached');
    await Bun.sleep(5);
  }
}
for (const stage of ['after-custody-seal', 'after-payload-commit'] as const)
  test(`fresh process recovers after actual SIGKILL ${stage}`, async () => {
    await withEvidenceIngress(
      async ({ f, dir, body, capture, authority, encoded }) => {
        const ready = join(dir, stage),
          release = join(dir, 'never');
        const producer = spawnEvidenceIngress({
          dir,
          body,
          barriers: [{ at: stage, ready, release }],
        });
        try {
          await marker(ready);
          const [before] =
            await f.sql`select state,binding_digest,payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
          const keyBefore = authority.read({
            evidenceId: body.evidenceId,
            bindingDigest: before!.binding_digest,
          });
          producer.kill('SIGKILL');
          await producer.exited;
          const preReceipt =
            stage === 'after-custody-seal'
              ? await runEvidenceIngress({
                  dir,
                  operation: 'restore',
                  roundId: body.roundId,
                  evidenceId: body.evidenceId,
                })
              : null;
          if (stage === 'after-custody-seal') {
            const until = performance.now() + 2500;
            let expired = false;
            while (performance.now() < until) {
              const [row] =
                await f.sql`select lease_expires_at<=clock_timestamp() as expired from necessary_evidence where id=${body.evidenceId}`;
              if (row!.expired) {
                expired = true;
                break;
              }
              await Bun.sleep(5);
            }
            if (!expired)
              throw new Error(
                'Original execution lease did not actually expire',
              );
          }
          const cold = await runEvidenceIngress(
            stage === 'after-payload-commit'
              ? {
                  dir,
                  operation: 'restore',
                  roundId: body.roundId,
                  evidenceId: body.evidenceId,
                }
              : { dir, body },
          );
          const [after] =
            await f.sql`select state,binding_digest,payload_accepted_at,received_at,expires_at from necessary_evidence where id=${body.evidenceId}`;
          const keyAfter = authority.read({
            evidenceId: body.evidenceId,
            bindingDigest: after!.binding_digest,
          });
          const stored = await capture.readCaptureEvidencePayload({ body });
          assert({
            given: `actual separate-process SIGKILL ${stage}; post-receipt recovery receives ONLY IDs, while pre-receipt retry explicitly retains the original sender body`,
            should:
              'reuse original key/nonce/expiry; recover committed payload without remembered execution token, and never call pre-receipt metadata a PCM receipt',
            actual: {
              preReceipt: preReceipt?.reply.kind ?? null,
              restoredDigest: cold.restoredDigest,
              before: before!.state,
              beforeReceived: before!.payload_accepted_at !== null,
              kind: cold.reply.kind,
              calls: cold.calls,
              sameKey:
                keyBefore.kind === 'current' &&
                keyAfter.kind === 'current' &&
                keyBefore.keyDigest === keyAfter.keyDigest &&
                JSON.stringify(keyBefore.receipt) ===
                  JSON.stringify(keyAfter.receipt),
              sameAcceptance:
                stage === 'after-custody-seal' ||
                before!.payload_accepted_at.getTime() ===
                  after!.payload_accepted_at.getTime(),
              state: after!.state,
              stored: stored.kind,
            },
            expected: {
              preReceipt: stage === 'after-custody-seal' ? 'pending' : null,
              restoredDigest:
                stage === 'after-payload-commit'
                  ? createHash('sha3-256').update(encoded.json).digest('hex')
                  : null,
              before: stage === 'after-custody-seal' ? 'acquiring' : 'retained',
              beforeReceived: stage === 'after-payload-commit',
              kind: 'received',
              calls: {
                reserves: stage === 'after-custody-seal' ? 1 : 0,
                adopts: stage === 'after-custody-seal' ? 1 : 0,
              },
              sameKey: true,
              sameAcceptance: true,
              state: 'retained',
              stored: 'received',
            },
          });
        } finally {
          producer.kill('SIGKILL');
          await producer.exited;
        }
      },
    );
  });

for (const path of ['receive', 'restore'] as const)
  test(`PG withdrawal fences held plaintext in ${path} while independent propagation is delayed`, async () => {
    await withEvidenceIngress(
      async ({ dir, body, capture, custody, encoded, roundId }) => {
        await createNecessaryEvidenceIngress({
          store: capture,
          custody,
        }).receive(body);
        const stored = await capture.readCaptureEvidencePayload({ body });
        if (stored.kind !== 'received')
          throw new Error('Expected committed synthetic fixture');
        const ready = join(dir, 'plaintext'),
          release = join(dir, 'continue');
        const request =
          path === 'restore'
            ? {
                dir,
                operation: 'restore',
                roundId,
                evidenceId: body.evidenceId,
              }
            : { dir, body };
        const producer = spawnEvidenceIngress({
          ...request,
          barriers: [{ at: 'after-plaintext', ready, release }],
        });
        try {
          await marker(ready);
          await capture.withdrawCaptureEvidence({ roundId });
          const stillCurrent = await custody.inspect(
            stored.sealed.receipt,
            stored.privacyScope,
          );
          // Latest key authority still has no propagated scope revocation; the PG fence must be sufficient.
          await writeFile(release, 'continue');
          const stopped = await finishEvidenceIngress(producer);
          assert({
            given:
              'plaintext released before a committed PG withdrawal, with independent privacy propagation/retirement deliberately delayed and a separately retained plaintext copy',
            should:
              'deny the receipt at the later PG fence, clear only its owned transient bytes, and honestly retain the residual external copy',
            actual: {
              currentKey: stillCurrent.kind === 'available',
              reply: stopped.reply,
              owned: stopped.ownedPlaintextCleared,
              residual:
                stopped.retainedDigest ===
                createHash('sha3-256').update(encoded.json).digest('hex'),
              noFreshWork: stopped.calls,
            },
            expected: {
              currentKey: true,
              reply: { kind: 'refused', reason: 'conflict' },
              owned: true,
              residual: true,
              noFreshWork: { reserves: 0, adopts: 0 },
            },
          });
        } finally {
          producer.kill('SIGKILL');
          await producer.exited;
        }
      },
    );
  });

test('current independently pending privacy scope denies an old open PG payload in a fresh process', async () => {
  await withEvidenceIngress(
    async ({ f, dir, body, capture, custody, authority, roundId }) => {
      await createNecessaryEvidenceIngress({ store: capture, custody }).receive(
        body,
      );
      const prepared = authority.preparePrivacy({
        intentId: createId(),
        scope: { kind: 'round', roundId },
        authorizationDigest: 'a'.repeat(64),
      });
      const cold = await runEvidenceIngress({ dir, body });
      const [row] =
        await f.sql`select state,ciphertext is not null as retained from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given:
          'an old still-open PG payload with actual latest independent pending privacy authority and retained material',
        should:
          'deny a fresh-process receipt without mistaking a live key or an open PG snapshot for current privacy permission',
        actual: {
          prepared: prepared.kind,
          reply: cold.reply,
          calls: cold.calls,
          row,
        },
        expected: {
          prepared: 'pending',
          reply: { kind: 'refused', reason: 'uncertain' },
          calls: { reserves: 0, adopts: 0 },
          row: { state: 'retained', retained: true },
        },
      });
    },
  );
});

test('latest independent privacy denial reaches restored plaintext after custody already returned it', async () => {
  await withEvidenceIngress(
    async ({ dir, body, capture, custody, authority, roundId, encoded }) => {
      await createNecessaryEvidenceIngress({ store: capture, custody }).receive(
        body,
      );
      const ready = join(dir, 'held'),
        release = join(dir, 'continue');
      const producer = spawnEvidenceIngress({
        dir,
        operation: 'restore',
        roundId,
        evidenceId: body.evidenceId,
        barriers: [{ at: 'after-plaintext', ready, release }],
      });
      try {
        await marker(ready);
        const prepared = authority.preparePrivacy({
          intentId: createId(),
          scope: { kind: 'round', roundId },
          authorizationDigest: 'a'.repeat(64),
        });
        await writeFile(release, 'continue');
        const stopped = await finishEvidenceIngress(producer);
        assert({
          given:
            'a fresh process that already holds decrypted stored PCM when latest independent privacy preparation commits, while PG remains open',
          should:
            'deny later use, clear only owned bytes and expose the honest separately copied plaintext residual',
          actual: {
            prepared: prepared.kind,
            reply: stopped.reply,
            owned: stopped.ownedPlaintextCleared,
            residual:
              stopped.retainedDigest ===
              createHash('sha3-256').update(encoded.json).digest('hex'),
            calls: stopped.calls,
          },
          expected: {
            prepared: 'pending',
            reply: { kind: 'refused', reason: 'uncertain' },
            owned: true,
            residual: true,
            calls: { reserves: 0, adopts: 0 },
          },
        });
      } finally {
        producer.kill('SIGKILL');
        await producer.exited;
      }
    },
  );
});
