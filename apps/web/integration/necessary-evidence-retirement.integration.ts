import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { NecessaryEvidenceRetirement } from '../src/features/media-capture/necessary-evidence-retirement/necessary-evidence-retirement';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual custody retirement runs only after the committed PG no-use fence and confirms material cleanup before releasing debt', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    await createNecessaryEvidenceIngress({ store: capture, custody }).receive(
      body,
    );
    await capture.withdrawCaptureEvidence({ roundId: body.roundId });
    const store = f.store.createNecessaryEvidenceRetirement({
      leaseMs: 15000,
      retryMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
    });
    let beforeRevoke: unknown = null;
    const service = NecessaryEvidenceRetirement.create({
      store,
      workerId: createId(),
      custody: {
        ...custody,
        revoke: async (identity) => {
          const [row] =
            await f.sql`select state,reserved_bytes,ciphertext is null as empty from necessary_evidence where id=${identity.evidenceId}`;
          beforeRevoke = row;
          return custody.revoke(identity);
        },
      },
    });
    const report = await service.runOnce();
    const [after] =
      await f.sql`select state from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given:
        'actual stored audio/key and a committed withdrawal, with external revocation observing PG independently',
      should:
        'fence use and clear PG bytes first, then confirm actual custody cleanup and release the outstanding count',
      actual: { beforeRevoke, report, after },
      expected: {
        beforeRevoke: { state: 'retiring', reserved_bytes: 0, empty: true },
        report: { attached: 'retired', detached: 'idle' },
        after: { state: 'retired' },
      },
    });
  });
});

test('aggregate erasure and unknown speaker provenance cannot strand authorized original cleanup', async () => {
  await withEvidenceIngress(
    async ({ f, capture, custody, body, authority }) => {
      const receipt = await createNecessaryEvidenceIngress({
        store: capture,
        custody,
      }).receive(body);
      if (receipt.kind !== 'received')
        throw new Error('Expected payload receipt');
      await f.sql`update necessary_evidence set original_speaker=null where id=${body.evidenceId}`;
      await f.sql`delete from rounds where id=${body.roundId}`;
      const before = authority.read(receipt.receipt);
      const store = f.store.createNecessaryEvidenceRetirement({
        leaseMs: 15000,
        retryMs: 1000,
        nextToken: () => randomBytes(32).toString('base64url'),
      });
      const report = await NecessaryEvidenceRetirement.create({
        store,
        custody,
        workerId: createId(),
      }).runOnce();
      const [row] =
        await f.sql`select round_id,original_round_id,state,authority_id from necessary_evidence where id=${body.evidenceId}`;
      assert({
        given:
          'an actual retained key/payload whose Round is then erased and original speaker mapping is unproven',
        should:
          'use original opaque routing to retire material without raw-read/account/cast authorization or a replacement realm',
        actual: {
          before: before.kind,
          report,
          row,
          key: authority.read(receipt.receipt),
        },
        expected: {
          before: 'current',
          report: { attached: 'idle', detached: 'retired' },
          row: {
            round_id: null,
            original_round_id: body.roundId,
            state: 'retired',
            authority_id: receipt.receipt.authorityId,
          },
          key: { kind: 'refused', reason: 'revoked' },
        },
      });
    },
  );
});
