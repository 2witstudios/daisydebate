import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { cleanupWork } from '@daisy/protocol/billing';
import { withBillingRefunds } from './billing-refunds.test-support';
import { seedInvoicePassPredecessor } from './billing-invoice-pass-predecessor.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';

requireTestServices(process.env);
setupRitewayBun();
const migration = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

// Five bounded discovery heads plus predecessor selection require actual one-second progress intervals.
test('unrouted predecessor invoice identities survive conversion, rotation and failure while refusing false completion', async () => {
  await withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = Error('Owned invoice identity debt rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx.unsafe(
          await Bun.file(
            new URL(
              '../migrations/20261106023226_stripe_cleanup_failure_classification/migration.sql',
              import.meta.url,
            ),
          ).text(),
        );
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [job] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const old = await seedInvoicePassPredecessor(
          tx,
          job!.id,
          'unrouted-invoices',
        );
        const frame = old.billing_cleanup.scans.invoices;
        const ids = [frame.id, ...frame.rest];
        // Positive predecessor discovery is retained even when its sole customer routing has since been erased.
        await tx`delete from billing_customers where user_id=${userId}`;
        await tx`reset role`;
        await tx.unsafe(await Bun.file(migration).text());
        await tx`set local role daisy_web`;
        const matrix = cleanupCandidate(tx, job!.id);
        let state = await matrix.state();
        assert({
          given:
            'a real111 selected invoice and remainder with no remaining positively owned route',
          should:
            'preserve both exact identities as owed debt and selected frames while retiring old authority',
          actual: state.kind === 'scanning' && [
            state.invoiceDebt,
            state.scans.invoices,
            state.claim,
          ],
          expected: [
            { kind: 'owed', ids, next: 'identity' },
            { ...frame, detail: { kind: 'invoice-payments', pass: null } },
            null,
          ],
        });
        await matrix.rotate();
        state = await matrix.state();
        assert({
          given: 'a new late-fact job identity after conversion',
          should:
            'retain unresolved invoice identities while resetting only execution heads and claim',
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
          nextAt = new Date(Date.parse(checkedAt) + 86_400_000).toISOString();
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
          retryAt: new Date(
            Date.parse(await matrix.now()) + 2000,
          ).toISOString(),
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
