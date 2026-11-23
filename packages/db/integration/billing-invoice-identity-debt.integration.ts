import { addMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork } from '@daisy/protocol/billing';
import { withBillingRefunds } from './billing-refunds.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';

requireTestServices(process.env);
setupRitewayBun();

// Five bounded discovery heads plus invoice selection require actual one-second progress intervals.
test('unrouted selected invoice identities survive rotation and failure while refusing false completion', async () => {
  await withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = Error('Owned invoice identity debt rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [job] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const matrix = cleanupCandidate(tx, job!.id);
        for (let step = 0; step < 2; step++) {
          const state = await matrix.claim();
          await matrix.apply({
            kind: 'page',
            claimId: matrix.token(state),
            work: cleanupWork(state)!,
            ids: [],
            more: false,
          });
        }
        const ids = [`in_${createId()}`, `in_${createId()}`];
        let state = await matrix.claim();
        for (const id of ids) await matrix.retainInvoice(id);
        await matrix.apply({
          kind: 'page',
          claimId: matrix.token(state),
          work: cleanupWork(state)!,
          ids,
          more: false,
        });
        // Positive discovery is retained even when its sole customer routing has since been erased.
        await tx`reset role`;
        await tx`delete from billing_customers where user_id=${userId}`;
        await tx`set local role daisy_web`;
        await matrix.rotate();
        state = await matrix.state();
        assert({
          given:
            'a selected invoice and remainder with no remaining positively owned route, then a new late-fact job identity',
          should:
            'retain both exact identities as owed debt while resetting only execution heads and claim',
          actual: state.kind === 'scanning' && [
            state.invoiceDebt,
            state.turn,
            state.claim,
            state.scans.invoices,
          ],
          expected: [
            { kind: 'owed', ids, next: 'identity' },
            'purchases',
            null,
            { kind: 'page', afterId: null },
          ],
        });
        for (let n = 0; n < 4; n++) {
          state = await matrix.claim();
          await matrix.apply({
            kind: 'page',
            claimId: matrix.token(state),
            work: cleanupWork(state)!,
            ids: [],
            more: false,
          });
        }
        state = await matrix.claim();
        const before = await matrix.read();
        const checkedAt = await matrix.now(),
          nextAt = addMs(checkedAt, 86_400_000);
        const acknowledgement = {
          kind: 'acknowledged',
          outcome: 'no-vendor-effects',
          jobId: matrix.jobId,
          checkedAt,
          nextAt,
        };
        const refused = await matrix.probe(
          () =>
            tx`update privacy_jobs set billing_cleanup=${JSON.stringify(acknowledgement)}::text::jsonb,status='succeeded',succeeded_at=${checkedAt}::timestamptz where id=${matrix.jobId}`,
        );
        const failed = await matrix.apply({
          kind: 'failure',
          claimId: matrix.token(state),
          work: cleanupWork(state)!,
          retryAt: addMs(await matrix.now(), 2000),
        });
        assert({
          given:
            'a current exact identity claim after all vendor discovery heads return empty, with no customer/payment/refund routes',
          should:
            'refuse missing-effects acknowledgement yet permit an honest fair failure retaining all identity debt',
          actual: [
            cleanupWork(state),
            refused,
            failed.kind === 'scanning' && [failed.invoiceDebt, failed.turn],
            (await matrix.read()).attempts - before.attempts,
          ],
          expected: [
            { kind: 'invoice-identity', invoiceId: ids[0] },
            '23514',
            [
              {
                kind: 'owed',
                ids: [...ids.slice(1), ids[0]],
                next: 'observations',
              },
              'observations',
            ],
            1,
          ],
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
}, 25_000);
