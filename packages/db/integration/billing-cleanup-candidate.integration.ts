import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  advanceCleanup,
  cleanupWork,
  type CleanupState,
} from '@daisy/protocol/billing';
import { exerciseFailureDeferral } from './billing-cleanup-deferral.test-support';
import { exerciseInvoiceProgress } from './billing-cleanup-invoice.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { withBillingRefunds } from './billing-refunds.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106023226_stripe_cleanup_failure_classification/migration.sql',
  import.meta.url,
);

test(
  'candidate Stripe guard real-role transition and mutation matrix rolls back with all non-Stripe behavior preserved',
  async () =>
    withBillingRefunds(async ({ fixture, userId, actorId }) => {
      const rollback = new Error('Owned candidate matrix rollback');
      try {
        await fixture.sql.begin(async (tx) => {
          await tx.unsafe(await Bun.file(candidate).text());
          await tx`set local role daisy_web`;
          await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
          const [original] =
            await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
          await tx`savepoint owned_failure_case`;
          await exerciseFailureDeferral(cleanupCandidate(tx, original!.id));
          await tx`rollback to savepoint owned_failure_case`;
          await tx`release savepoint owned_failure_case`;
          const matrix = cleanupCandidate(tx, original!.id);
          const {
            read,
            now,
            state,
            persist,
            apply,
            claim,
            token,
            probe,
            rotate,
          } = matrix;
          let c = await claim();
          const first = await read();
          const codes = [
            await probe(
              () =>
                tx`update privacy_jobs set created_at=created_at-interval '1 second' where id=${matrix.jobId}`,
            ),
            await probe(
              () =>
                tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 second' as due) update privacy_jobs set billing_cleanup=jsonb_set(jsonb_set(jsonb_set(billing_cleanup,'{turn}','"subscriptions"'),'{claim}','null'),'{retryAt}',to_jsonb(to_char(sampled.due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),retry_at=sampled.due from sampled where id=${matrix.jobId}`,
            ),
            await probe(
              () =>
                tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 second' as due) update privacy_jobs set billing_cleanup=jsonb_set(jsonb_set(jsonb_set(jsonb_set(billing_cleanup,'{turn}','"subscriptions"'),'{claim}','null'),'{scans,purchases,afterId}',to_jsonb(${createId()}::text)),'{retryAt}',to_jsonb(to_char(sampled.due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),retry_at=sampled.due from sampled where id=${matrix.jobId}`,
            ),
          ];
          assert({
            given: 'candidate real runtime role with a current initial claim',
            should:
              'reject origin rewrite, cursorless turn and unselected page skip without mutation',
            actual: [codes, await read()],
            expected: [['23514', '23514', '23514'], first],
          });
          const p1 = createId(),
            p2 = createId();
          await apply({
            kind: 'page',
            claimId: token(c),
            work: cleanupWork(c)!,
            ids: [p1, p2],
            more: true,
          });
          for (let lane = 0; lane < 4; lane++) {
            c = await claim();
            await apply({
              kind: 'page',
              claimId: token(c),
              work: cleanupWork(c)!,
              ids: [],
              more: false,
            });
          }
          c = await claim();
          const badSkip = { ...c } as CleanupState;
          if (badSkip.kind !== 'scanning') throw Error('Wrong matrix lane');
          badSkip.claim = null;
          badSkip.retryAt = new Date(
            Date.parse(await now()) + 1000,
          ).toISOString();
          badSkip.scans = { ...badSkip.scans, purchases: { kind: 'complete' } };
          assert({
            given: 'a durable two-resource page',
            should:
              'reject completing it while one selected remainder is still pending',
            actual: await probe(() => persist(badSkip, 'progress')),
            expected: '23514',
          });
          await apply({
            kind: 'resolved',
            claimId: token(c),
            work: cleanupWork(c)!,
          });
          c = await claim();
          await apply({
            kind: 'resolved',
            claimId: token(c),
            work: cleanupWork(c)!,
          });
          const selectedDone = await state();
          assert({
            given: 'two real selected-resource completions',
            should: 'retain the exact last resource as the next-page cursor',
            actual:
              selectedDone.kind === 'scanning' && selectedDone.scans.purchases,
            expected: { kind: 'page', afterId: p2 },
          });
          c = await claim();
          await apply({
            kind: 'page',
            claimId: token(c),
            work: cleanupWork(c)!,
            ids: [],
            more: false,
          });
          c = await claim();
          await apply({
            kind: 'deleted',
            claimId: token(c),
            work: cleanupWork(c)!,
          });
          const done = await read();
          assert({
            given: 'all scans complete and a verified deletion result',
            should: 'atomically acknowledge without counting a vendor failure',
            actual: [done.status, done.attempts, done.billing_cleanup.outcome],
            expected: ['succeeded', 0, 'vendor-deleted'],
          });
          const oldJob = await rotate();
          assert({
            given: 'new work rotates an acknowledged job',
            should:
              'clear execution only and leave no old job identity to update',
            actual: [
              (await read()).billing_cleanup,
              (
                await tx`update privacy_jobs set attempts=attempts+1 where id=${oldJob} returning id`
              ).length,
            ],
            expected: [null, 0],
          });
          c = await claim(true);
          await tx`select pg_sleep(0.25)`;
          const expiredContext = {
            now: c.kind === 'acknowledged' ? '' : c.claim!.claimedAt,
            jobId: matrix.jobId,
            closed: true,
          };
          const forged = advanceCleanup(
            c,
            {
              kind: 'page',
              claimId: token(c),
              work: cleanupWork(c)!,
              ids: [],
              more: false,
            },
            expiredContext,
          );
          if (forged.kind === 'idle')
            throw Error('Expired control fixture invalid');
          assert({
            given:
              'a formerly valid page result after the real database claim deadline',
            should: 'reject consumption under actual server time',
            actual: await probe(() => persist(forged.state, forged.kind)),
            expected: '23514',
          });
          const replacement = await claim();
          assert({
            given: 'an old reply after the replacement claim',
            should: 'remain idle without any retry mutation',
            actual: advanceCleanup(
              replacement,
              {
                kind: 'page',
                claimId: token(c),
                work: cleanupWork(c)!,
                ids: [],
                more: false,
              },
              { now: await now(), jobId: matrix.jobId, closed: true },
            ),
            expected: { kind: 'idle' },
          });
          await apply({
            kind: 'failure',
            claimId: token(replacement),
            work: cleanupWork(replacement)!,
            retryAt: new Date(Date.parse(await now()) + 60_000).toISOString(),
          });
          const failed = await read();
          const noClaim = await state();
          const stale = advanceCleanup(
            noClaim,
            {
              kind: 'page',
              claimId: token(replacement),
              work: cleanupWork(replacement)!,
              ids: [],
              more: false,
            },
            { now: await now(), jobId: matrix.jobId, closed: true },
          );
          const retryMutation = await probe(
            () =>
              tx`update privacy_jobs set attempts=attempts+1,retry_at=retry_at+interval '1 hour' where id=${matrix.jobId}`,
          );
          assert({
            given: 'failure followed by stale/idle work',
            should:
              'retain bounded failure state and forbid queue-only retry refresh',
            actual: [
              failed.attempts,
              failed.billing_cleanup.turn,
              stale,
              retryMutation,
              await read(),
            ],
            expected: [1, 'subscriptions', { kind: 'idle' }, '23514', failed],
          });
          await rotate();
          await tx`savepoint owned_invoice_case`;
          await exerciseInvoiceProgress(matrix);
          await tx`rollback to savepoint owned_invoice_case`;
          await tx`release savepoint owned_invoice_case`;
          await rotate();
          await tx`set local role none`;
          await tx`delete from billing_customers where user_id=${userId}`;
          await tx`set local role daisy_web`;
          c = await claim();
          const current = await state();
          const zero = advanceCleanup(
            current,
            { kind: 'no-effects', claimId: token(c), work: cleanupWork(c)! },
            {
              now: await now(),
              jobId: matrix.jobId,
              closed: true,
              effects: {
                mappedCustomers: 0,
                possiblePurchases: 0,
                retainedFinancialRoutes: 0,
                owedObservations: false,
              },
            },
          );
          if (zero.kind === 'idle') throw Error('Zero-effects fixture refused');
          await persist(zero.state, zero.kind);
          const other = createId();
          await tx`insert into privacy_jobs(id,subject_ref,vendor,status,attempts,created_at,retry_at) values(${other},${userId},'posthog','pending',0,clock_timestamp(),clock_timestamp())`;
          await tx`update privacy_jobs set attempts=attempts+1,retry_at=retry_at+interval '1 minute' where id=${other}`;
          await tx`update privacy_jobs set status='succeeded',attempts=attempts+1,succeeded_at=clock_timestamp() where id=${other}`;
          const [nonStripe] =
            await tx`select status,attempts,billing_cleanup from privacy_jobs where id=${other}`;
          assert({
            given:
              'positively empty Stripe closure and an ordinary non-Stripe job',
            should:
              'distinguish no vendor effects and preserve generic retry/success behavior',
            actual: [(await read()).billing_cleanup.outcome, nonStripe],
            expected: [
              'no-vendor-effects',
              { status: 'succeeded', attempts: 2, billing_cleanup: null },
            ],
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }),
  40_000,
);
