import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork } from '@daisy/protocol/billing';
import { withBillingRefunds } from './billing-refunds.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
requireTestServices(process.env);
setupRitewayBun();
type Matrix = ReturnType<typeof cleanupCandidate>;

async function withObservationLane(
  work: (matrix: Matrix, ids: string[]) => Promise<void>,
  selectedProducers = false,
) {
  return withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = Error('Owned observation lane rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [job] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const matrix = cleanupCandidate(tx, job!.id);
        await matrix.retainInvoice(`in_${createId()}`);
        await matrix.retainInvoice(`in_${createId()}`);
        const producers = [
          createId(),
          `sub_${createId()}`,
          `in_${createId()}`,
          createId(),
        ];
        for (const id of producers) {
          const c = await matrix.claim();
          const selected = cleanupWork(c)!;
          if (
            selectedProducers &&
            selected.kind === 'scan' &&
            selected.lane === 'invoices'
          )
            await matrix.retainInvoice(id);
          await matrix.apply({
            kind: 'page',
            claimId: matrix.token(c),
            work: selected,
            ids: selectedProducers ? [id] : [],
            more: false,
          });
        }
        const rows =
          await tx`select id from billing_payment_observations where user_id=${userId} order by id limit 21`;
        await work(
          matrix,
          rows.map((row: Record<string, unknown>) => String(row.id)),
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
}

test(
  'actual-role observation keysets retain exact owned rows before cursor movement and restart owed traversal without relief',
  async () =>
    withObservationLane(async (matrix, ids) => {
      let c = await matrix.claim();
      const page = {
        kind: 'page' as const,
        claimId: matrix.token(c),
        work: cleanupWork(c)!,
        ids,
        more: false,
      };
      const refusals = [];
      for (const wrong of [[createId()], ids.slice(1), ids.slice(0, 1)])
        refusals.push(
          await matrix.probe(() => matrix.apply({ ...page, ids: wrong })),
        );
      await matrix.apply(page);
      c = await matrix.claim();
      if (c.kind !== 'scanning' || c.scans.observations.kind !== 'selected')
        throw Error('Missing selected observation');
      const before = await matrix.read();
      const forged = {
        ...c,
        claim: null,
        retryAt: new Date(Date.parse(await matrix.now()) + 1000).toISOString(),
        scans: {
          ...c.scans,
          observations: { kind: 'complete' as const },
        },
      };
      const skippedRemainder = await matrix.probe(() =>
        matrix.persist(forged, 'progress'),
      );
      assert({
        given:
          'foreign/skipped local keysets or false exhaustion with an owed selected remainder',
        should:
          'reject all23514 and preserve the exact current claim and owed facts',
        actual: [refusals, skippedRemainder, await matrix.read()],
        expected: [['23514', '23514', '23514'], '23514', before],
      });
      for (const id of ids) {
        const observation = await matrix.retainObservation(id);
        await matrix.apply({
          kind: 'retained',
          claimId: matrix.token(c),
          work: cleanupWork(c)!,
          observation,
        });
        if (id !== ids.at(-1)) c = await matrix.claim();
      }
      const after = await matrix.read();
      assert({
        given:
          'both exact owed observations retained unchanged while consuming their selected remainder',
        should:
          'use genuine bounded progress and restart all heads, leaving every financial obligation owed',
        actual: [
          after.status,
          after.attempts,
          after.billing_cleanup.turn,
          Object.values(after.billing_cleanup.scans),
          after.billing_cleanup.claim,
        ],
        expected: [
          'pending',
          0,
          'purchases',
          Array(5).fill({ kind: 'page', afterId: null }),
          null,
        ],
      });
    }),
  20000,
);

test(
  'actual-role failure yields across all five selected lanes without losing any original work',
  async () =>
    withObservationLane(async (matrix, ids) => {
      const c = await matrix.claim();
      await matrix.apply({
        kind: 'page',
        claimId: matrix.token(c),
        work: cleanupWork(c)!,
        ids,
        more: false,
      });
      const initial = await matrix.state();
      const turns = [];
      for (let index = 0; index < 5; index++) {
        const current = await matrix.claim();
        await matrix.apply({
          kind: 'failure',
          claimId: matrix.token(current),
          work: cleanupWork(current)!,
          retryAt: new Date(Date.parse(await matrix.now()) + 100).toISOString(),
        });
        const next = await matrix.state();
        turns.push(next.kind === 'scanning' && next.turn);
      }
      const after = await matrix.read();
      assert({
        given:
          'uncertain selected purchase/subscription/invoice/refund/observation work',
        should:
          'count five failures, visit every lane and preserve every exact selected frame without ACK or fabricated relief',
        actual: [
          turns,
          after.status,
          after.attempts,
          after.billing_cleanup.scans,
          after.billing_cleanup.claim,
        ],
        expected: [
          ['subscriptions', 'invoices', 'refunds', 'observations', 'purchases'],
          'pending',
          5,
          initial.kind === 'scanning' && initial.scans,
          null,
        ],
      });
    }, true),
  20000,
);
