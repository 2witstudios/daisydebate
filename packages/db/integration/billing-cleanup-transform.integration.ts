import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  advanceCleanup,
  billingCleanupSchema,
  cleanupWork,
  startCleanup,
} from '@daisy/protocol/billing';
import { withBillingRefunds } from './billing-refunds.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { retainCandidateInvoice } from './billing-cleanup-witness.test-support';
import {
  historicalCohorts,
  seedHistoricalCleanup,
} from './billing-cleanup-historical.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106015001_stripe_cleanup_five_lane/migration.sql',
  import.meta.url,
);
const predecessor = new URL(
  '../migrations/20261106004019_stripe_cleanup_observation_completion/migration.sql',
  import.meta.url,
);

for (const cohort of historicalCohorts)
  test(
    `populated109 ${cohort} transforms execution only and preserves original accounting/financial facts`,
    async () =>
      withBillingRefunds(
        async ({ fixture, userId, actorId, refunds, payment }) => {
          const populated = [
            'pending-null',
            'page',
            'selected-remainder',
            'claimed',
          ].includes(cohort);
          if (populated) {
            const admitted = await refunds.admit(userId, payment);
            if (admitted.kind !== 'admitted')
              throw Error('Missing original populated refund obligation');
          }
          const rollback = Error('Owned populated predecessor rollback');
          try {
            await fixture.sql.begin(async (tx) => {
              await tx.unsafe(await Bun.file(predecessor).text());
              await tx`set local role daisy_web`;
              await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
              const [job] =
                await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
              if (populated)
                await retainCandidateInvoice(tx, job!.id, `in_${createId()}`);
              const { before, oldClaim } = await seedHistoricalCleanup(
                tx,
                job!.id,
                cohort,
              );
              const [finance] = await tx`select
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_customers row where user_id=${userId}) as customers,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_purchases row where user_id=${userId}) as purchases,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_refund_actions row where user_id=${userId}) as refunds,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_payment_observations row where user_id=${userId}) as observations`;
              let expected = before.billing_cleanup;
              if (before.status === 'pending') {
                expected =
                  before.billing_cleanup?.kind === 'scanning'
                    ? {
                        ...before.billing_cleanup,
                        claim: null,
                        scans: {
                          ...before.billing_cleanup.scans,
                          observations: { kind: 'page', afterId: null },
                        },
                      }
                    : startCleanup(before.id, before.retry_at.toISOString());
              }
              const sql = await Bun.file(candidate).text();
              const cut = sql.indexOf('\nUPDATE public.privacy_jobs');
              if (cut < 0) throw Error('Missing exact transform boundary');
              await tx`reset role`;
              await tx.unsafe(sql.slice(0, cut));
              await tx`set local role daisy_web`;
              const matrix = cleanupCandidate(tx, job!.id);
              const wrong = await matrix.probe(
                () =>
                  tx`update privacy_jobs set billing_cleanup=${JSON.stringify(expected)}::text::jsonb,created_at=created_at-interval '1 second' where id=${matrix.jobId}`,
              );
              const wrongAccounting = await matrix.probe(
                () =>
                  tx`update privacy_jobs set billing_cleanup=${JSON.stringify(expected)}::text::jsonb,attempts=attempts+1 where id=${matrix.jobId}`,
              );
              await tx`reset role`;
              await tx.unsafe(sql.slice(cut));
              const [after] =
                await tx`select * from privacy_jobs where id=${job!.id}`;
              if (before.status === 'pending')
                billingCleanupSchema.parse(after!.billing_cleanup);
              const [financialAfter] = await tx`select
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_customers row where user_id=${userId}) as customers,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_purchases row where user_id=${userId}) as purchases,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_refund_actions row where user_id=${userId}) as refunds,
            (select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from billing_payment_observations row where user_id=${userId}) as observations`;
              assert({
                given: `an actual guarded109 ${cohort} predecessor row`,
                should:
                  'preserve every job/accounting/financial field and apply only the exact execution transform, without invented historical outcome',
                actual: [wrong, wrongAccounting, after, financialAfter],
                expected: [
                  '23514',
                  '23514',
                  { ...before, billing_cleanup: expected },
                  finance,
                ],
              });
              await tx`set local role daisy_web`;
              if (oldClaim) {
                const stale = await matrix.probe(
                  () =>
                    tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 second' as due)
                    update privacy_jobs set billing_cleanup=jsonb_set(billing_cleanup,'{retryAt}',to_jsonb(to_char(sampled.due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),retry_at=sampled.due from sampled where id=${matrix.jobId}`,
                );
                const state = billingCleanupSchema.parse(
                  after!.billing_cleanup,
                );
                const oldReply = advanceCleanup(
                  state,
                  {
                    kind: 'page',
                    claimId: oldClaim.id,
                    work: cleanupWork(state)!,
                    ids: [],
                    more: false,
                  },
                  {
                    jobId: matrix.jobId,
                    now: await matrix.now(),
                    closed: true,
                  },
                );
                assert({
                  given:
                    'a pretransition claim reply after its execution authority is retired',
                  should:
                    'refuse stale outcome/progress without declaring its possible vendor effect gone',
                  actual: [oldReply, stale],
                  expected: [{ kind: 'idle' }, '23514'],
                });
              }
              if (before.status === 'pending') {
                const next = await matrix.claim();
                assert({
                  given: 'the final strict guard after transformation',
                  should:
                    'admit a new bounded claim while retaining selected frames and all five lanes',
                  actual: [
                    next.kind,
                    next.kind === 'scanning' && Object.keys(next.scans),
                  ],
                  expected: [
                    'scanning',
                    [
                      'purchases',
                      'subscriptions',
                      'invoices',
                      'refunds',
                      'observations',
                    ],
                  ],
                });
              }
              // Other vendors retain their original queue contract under the final guard.
              const other = createId();
              await tx`insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at) values(${other},${userId},'resend',clock_timestamp(),clock_timestamp())`;
              await tx`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where id=${other}`;
              const [nonStripe] =
                await tx`select status,billing_cleanup from privacy_jobs where id=${other}`;
              assert({
                given:
                  'a non-Stripe vendor after the narrowly owned transformation',
                should:
                  'retain generic delivery behavior with no Billing payload',
                actual: nonStripe,
                expected: { status: 'succeeded', billing_cleanup: null },
              });
              throw rollback;
            });
          } catch (error) {
            if (error !== rollback) throw error;
          }
        },
      ),
    20000,
  );
