import { installInvoicePassGuards } from './billing-invoice-pass-current.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork } from '@daisy/protocol/billing';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { withBillingRefunds } from './billing-refunds.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106223739_stripe_invoice_coverage_repair/migration.sql',
  import.meta.url,
);

test(
  'candidate completion guard refuses invoice-only and payment-only owed facts while preserving genuine empty and vendor-deleted completion',
  async () =>
    withBillingRefunds(
      async ({ fixture, userId, actorId, vendorCustomerId }) => {
        const rollback = new Error('Observation completion candidate rollback');
        try {
          await fixture.sql.begin(async (tx) => {
            await installInvoicePassGuards(tx, candidate);
            await tx`set local role daisy_web`;
            await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
            const [job] =
              await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
            const matrix = cleanupCandidate(tx, job!.id);
            let claim = await matrix.claim();
            const acknowledge = async (
              outcome: 'no-vendor-effects' | 'vendor-deleted',
            ) => {
              const checkedAt = await matrix.now();
              await matrix.persist(
                {
                  kind: 'acknowledged',
                  outcome,
                  jobId: matrix.jobId,
                  checkedAt,
                  nextAt: new Date(
                    Date.parse(checkedAt) + 86_400_000,
                  ).toISOString(),
                },
                'complete',
              );
            };
            const owed = async (kind: 'invoice' | 'payment') => {
              const state =
                kind === 'invoice'
                  ? { kind: 'owed', reason: 'enumeration_unavailable' }
                  : {
                      kind: 'owed',
                      reason: 'payment_unresolved',
                      evidence: {
                        kind: 'partial',
                        facts: {
                          status: null,
                          paidAtSeconds: null,
                          amountPaidMinor: null,
                          charge: { kind: 'unresolved' },
                          period: null,
                        },
                      },
                    };
              await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
        insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
        select ${createId()},id,'test',${vendorCustomerId},${`in_${createId()}`},${kind},${kind === 'invoice' ? null : `inpay_${createId()}`},
          '{"kind":"unresolved","vendorSubscriptionId":null,"priceId":null}'::jsonb,${JSON.stringify(state)}::text::jsonb,date_trunc('milliseconds',deleted_at),sampled.at,sampled.at from users cross join sampled where id=${userId}`;
            };
            const probe = async (
              kind: 'invoice' | 'payment',
              outcome: 'no-vendor-effects' | 'vendor-deleted',
            ) => {
              await tx`savepoint owed_observation_case`;
              await owed(kind);
              await tx`delete from billing_customers where user_id=${userId}`;
              const before = await matrix.read();
              const code = await matrix.probe(() => acknowledge(outcome));
              const after = await matrix.read();
              await tx`rollback to savepoint owed_observation_case`;
              await tx`release savepoint owed_observation_case`;
              return {
                code,
                unchanged: JSON.stringify(before) === JSON.stringify(after),
              };
            };
            const zeroCodes = [];
            for (const kind of ['invoice', 'payment'] as const)
              zeroCodes.push(await probe(kind, 'no-vendor-effects'));
            assert({
              given:
                'actual runtime role, live claim and ONLY one owed invoice or payment after customer deletion',
              should:
                'refuse both raw no-effects acknowledgements without losing the current job or facts',
              actual: zeroCodes,
              expected: Array(2).fill({ code: '23514', unchanged: true }),
            });
            for (let lane = 0; lane < 5; lane++) {
              await matrix.apply({
                kind: 'page',
                claimId: matrix.token(claim),
                work: cleanupWork(claim)!,
                ids: [],
                more: false,
              });
              claim = await matrix.claim();
            }
            const deletedCodes = [];
            for (const kind of ['invoice', 'payment'] as const)
              deletedCodes.push(await probe(kind, 'vendor-deleted'));
            assert({
              given:
                'controlled scan exhaustion and a still-owed retained invoice/payment',
              should:
                'also refuse raw vendor-deleted acknowledgement under the same current claim',
              actual: deletedCodes,
              expected: Array(2).fill({ code: '23514', unchanged: true }),
            });
            const zero = await matrix.probe(async () => {
              await tx`delete from billing_customers where user_id=${userId}`;
              await acknowledge('no-vendor-effects');
            });
            await acknowledge('vendor-deleted');
            assert({
              given:
                'no retained observations or financial effects, and separately a valid completed scan/deletion result',
              should:
                'preserve genuine zero-effects and vendor-deleted success instead of disabling completion',
              actual: [zero, (await matrix.read()).status],
              expected: ['accepted', 'succeeded'],
            });
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      },
    ),
  15_000,
);
