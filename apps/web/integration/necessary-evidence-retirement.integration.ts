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

test('unconfirmed actual-key retirement keeps global admission debt until material cleanup confirms', async () => {
  await withEvidenceIngress(async (first) => {
    const original = await createNecessaryEvidenceIngress({
      store: first.capture,
      custody: first.custody,
    }).receive(first.body);
    if (original.kind !== 'received')
      throw new Error('Expected original payload');
    await first.capture.withdrawCaptureEvidence({
      roundId: first.body.roundId,
    });
    const store = first.f.store.createNecessaryEvidenceRetirement({
      leaseMs: 15000,
      retryMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
    });
    // Explicit injected refusal here; real authority-lock outage is qualified separately.
    const pending = await NecessaryEvidenceRetirement.create({
      store,
      workerId: createId(),
      custody: {
        ...first.custody,
        revoke: async () => ({ kind: 'refused', reason: 'unavailable' }),
      },
    }).runOnce();
    await withEvidenceIngress(
      async (second) => {
        let seals = 0;
        const ingress = createNecessaryEvidenceIngress({
          store: second.capture,
          custody: {
            ...second.custody,
            seal: (...args) => {
              seals++;
              return second.custody.seal(...args);
            },
          },
        });
        const attempts = [
          await ingress.receive(second.body),
          await ingress.receive(second.body),
        ];
        const [debt] = await second.f
          .sql`select count(*)::int as outstanding from necessary_evidence where state in ('acquiring','retained','retiring')`;
        const beforeSeals = seals;
        const until = performance.now() + 3000;
        while (performance.now() < until) {
          const [due] = await first.f
            .sql`select next_attempt_at<=clock_timestamp() as due from necessary_evidence where id=${first.body.evidenceId}`;
          if (due!.due) break;
          await Bun.sleep(5);
        }
        const retired = await NecessaryEvidenceRetirement.create({
          store,
          custody: first.custody,
          workerId: createId(),
        }).runOnce();
        const admitted = await ingress.receive(second.body);
        assert({
          given:
            'a real acquired payload/key whose retirement is explicitly refused, repeated second-Round admissions at global cap1, then actual cleanup confirmation',
          should:
            'retain one outstanding debt and admit no replacement key until confirmed retirement frees capacity',
          actual: {
            pending,
            attempts: attempts.map((x) => x.kind),
            debt,
            beforeSeals,
            retired,
            admitted: admitted.kind,
            seals,
          },
          expected: {
            pending: { attached: 'pending', detached: 'idle' },
            attempts: ['pending', 'pending'],
            debt: { outstanding: 1 },
            beforeSeals: 0,
            retired: { attached: 'retired', detached: 'idle' },
            admitted: 'received',
            seals: 1,
          },
        });
      },
      { maxOutstandingIntents: 1 },
    );
  });
});
