import { NecessaryEvidenceRetirement } from '../src/necessary-evidence-retirement/necessary-evidence-retirement';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { withEvidencePayload } from './necessary-evidence-payload.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('retirement commits its no-use fence before claiming external cleanup and releases debt only for its current claim', async () => {
  await withEvidencePayload(
    async ({ f, store, body, sealed, claim, transaction }) => {
      await store.adoptCaptureEvidence({ body, sealed, claim });
      await store.withdrawCaptureEvidence({ roundId: body.roundId });
      const retirement = NecessaryEvidenceRetirement.create({
        run: transaction,
        leaseMs: 1000,
        retryMs: 1000,
        nextToken: () => randomBytes(32).toString('base64url'),
      });
      const owned = await retirement.claim({
        workerId: createId(),
        lane: 'attached',
      });
      const [fenced] =
        await f.sql`select state,retirement_reason,reserved_bytes,ciphertext is null as empty from necessary_evidence where id=${body.evidenceId}`;
      if (owned.kind !== 'claimed')
        throw new Error('Expected retirement claim');
      const foreign = await retirement.complete({
        ...owned,
        claim: { ...owned.claim, token: randomBytes(32).toString('base64url') },
      });
      const [unconfirmed] =
        await f.sql`select state from necessary_evidence where id=${body.evidenceId}`;
      const completed = await retirement.complete(owned);
      const [settled] =
        await f.sql`select state from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given:
          'a retained payload withdrawn before external retirement and a foreign acknowledgement',
        should:
          'commit no-use/cleared bytes with outstanding debt, refuse foreign completion, then release only the matching current claim',
        actual: { fenced, foreign, unconfirmed, completed, settled },
        expected: {
          fenced: {
            state: 'retiring',
            retirement_reason: 'erased',
            reserved_bytes: 0,
            empty: true,
          },
          foreign: { kind: 'refused' },
          unconfirmed: { state: 'retiring' },
          completed: { kind: 'retired' },
          settled: { state: 'retired' },
        },
      });
    },
  );
});
