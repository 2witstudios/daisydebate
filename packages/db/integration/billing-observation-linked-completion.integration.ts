import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  advanceRefund,
  cleanupWork,
  type RefundStatus,
} from '@daisy/protocol/billing';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { seedObservedMoney } from './billing-payment-observation-money.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106004019_stripe_cleanup_observation_completion/migration.sql',
  import.meta.url,
);

test(
  'resolved observation routing still defeats absence and linked money completion requires current original known success',
  async () =>
    withClosedPurchase(true, async ({ fixture, subject, session, jobId }) => {
      const rollback = new Error('Linked completion matrix rollback');
      try {
        await fixture.sql.begin(async (tx) => {
          await tx.unsafe(await Bun.file(candidate).text());
          await tx`set local role daisy_web`;
          await tx`select * from public.daisy_authorization_accounts_v2(array[${subject.actorId}]::text[],null::text,true)`;
          const [purchase] =
            await tx`select id,admitted_at from billing_purchases where user_id=${subject.userId} and state->>'kind'='complete'`;
          const [clock] =
            await tx`select deleted_at,date_trunc('milliseconds',clock_timestamp()) as at from users where id=${subject.userId}`;
          const source = {
            kind: 'purchase',
            purchaseId: purchase!.id,
            vendorSubscriptionId: session.subscriptionId,
            priceId: 'price_fixture',
            admittedAt: purchase!.admitted_at.toISOString(),
          };
          const id = createId(),
            invoiceId = `in_${createId()}`,
            paymentId = `inpay_${createId()}`,
            paidAtSeconds = Math.floor(clock!.deleted_at.getTime() / 1000) - 1;
          const proof = {
            mode: 'test',
            customerId: session.customerId,
            invoiceId,
            invoicePaymentId: paymentId,
            vendorSubscriptionId: session.subscriptionId,
            priceId: 'price_fixture',
            status: 'paid',
            paidAtSeconds,
          };
          const resolved = {
            kind: 'resolved',
            basis: 'pre_closure',
            evidence: {
              kind: 'chronology',
              proof,
              facts: {
                status: 'paid',
                paidAtSeconds,
                amountPaidMinor: null,
                charge: { kind: 'unresolved' },
                period: null,
              },
            },
          };
          await tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
      values(${id},${subject.userId},'test',${session.customerId},${invoiceId},'payment',${paymentId},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(resolved)}::text::jsonb,${clock!.deleted_at},${clock!.at},${clock!.at})`;
          const matrix = cleanupCandidate(tx, jobId);
          let claim = await matrix.claim();
          const acknowledge = async (
            outcome: 'vendor-deleted' | 'no-vendor-effects',
          ) => {
            const checkedAt = await matrix.now();
            await matrix.persist(
              {
                kind: 'acknowledged',
                outcome,
                jobId,
                checkedAt,
                nextAt: new Date(
                  Date.parse(checkedAt) + 86_400_000,
                ).toISOString(),
              },
              'complete',
            );
          };
          await tx`savepoint retained_route_only`;
          // Fault-controlled producer removal isolates retained routing; all source evidence remains in the observation and rollback restores producers.
          await tx`delete from billing_customers where user_id=${subject.userId}`;
          await tx`delete from billing_purchases where user_id=${subject.userId}`;
          const [counts] =
            await tx`select (select count(*)::int from billing_customers where user_id=${subject.userId}) customers,
      (select count(*)::int from billing_purchases where user_id=${subject.userId}) purchases,(select count(*)::int from billing_refund_actions where user_id=${subject.userId}) actions`;
          const absence = await matrix.probe(() =>
            acknowledge('no-vendor-effects'),
          );
          assert({
            given:
              'only a positively resolved pre-closure observation remains, without any customer/purchase/action producer row',
            should:
              'still refuse no-effects because retained routing is not absence',
            actual: [
              counts,
              absence,
              (
                await tx`select source,state from billing_payment_observations where id=${id}`
              )[0],
            ],
            expected: [
              { customers: 0, purchases: 0, actions: 0 },
              '23514',
              { source, state: resolved },
            ],
          });
          await tx`rollback to savepoint retained_route_only`;
          await tx`release savepoint retained_route_only`;
          for (let lane = 0; lane < 4; lane++) {
            await matrix.apply({
              kind: 'page',
              claimId: matrix.token(claim),
              work: cleanupWork(claim)!,
              ids: [],
              more: false,
            });
            claim = await matrix.claim();
          }
          const seeded = await seedObservedMoney({
            tx,
            userId: subject.userId,
            customerId: session.customerId,
            invoiceId: `in_${createId()}`,
            subscriptionId: session.subscriptionId,
            source,
            closedAt: clock!.deleted_at,
          });
          await tx`update billing_payment_observations set refund_action_id=${seeded.actionId},state=${JSON.stringify(seeded.linked)}::text::jsonb where id=${seeded.id}`;
          let action = seeded.action;
          const persist = async () =>
            tx`update billing_refund_actions set state=${JSON.stringify(action.state)}::text::jsonb,claim=${action.claim === null ? null : JSON.stringify(action.claim)}::text::jsonb where id=${action.id}`;
          const claimAction = async () => {
            const next = advanceRefund(
              action,
              { kind: 'claim', claimId: createId() },
              { now: await matrix.now(), authority: 'closed' },
            );
            if (next.kind !== 'changed')
              throw Error('Missing refund observation claim');
            action = next.action;
            await persist();
          };
          const codes = [
            await matrix.probe(() => acknowledge('vendor-deleted')),
          ];
          await claimAction();
          codes.push(await matrix.probe(() => acknowledge('vendor-deleted')));
          for (const status of [
            'pending',
            'failed',
            'requires_action',
            'canceled',
            'succeeded',
          ] as readonly RefundStatus[]) {
            if (action.claim === null) await claimAction();
            const observed = advanceRefund(
              action,
              {
                kind: 'observe',
                claimId: action.claim!.id,
                refundId: 're_completion_original',
                status,
              },
              { now: await matrix.now(), authority: 'closed' },
            );
            if (observed.kind !== 'changed')
              throw Error('Missing current refund observation');
            action = observed.action;
            await persist();
            codes.push(await matrix.probe(() => acknowledge('vendor-deleted')));
          }
          const missing = await matrix.probe(
            () =>
              tx`update billing_payment_observations set refund_action_id=${createId()} where id=${seeded.id}`,
          );
          assert({
            given:
              'a resolved payment alongside one exact linked original action in ready, unknown, pending, failed, action-required, canceled and finally current succeeded states',
            should:
              'block every unresolved state, reject missing/replaced action identity and accept only current original known success',
            actual: [
              codes,
              missing,
              (
                await tx`select refund_action_id,state from billing_payment_observations where id=${seeded.id}`
              )[0],
            ],
            expected: [
              [
                '23514',
                '23514',
                '23514',
                '23514',
                '23514',
                '23514',
                'accepted',
              ],
              '23514',
              { refund_action_id: seeded.actionId, state: seeded.linked },
            ],
          });
          await acknowledge('vendor-deleted');
          assert({
            given:
              'current original known success and resolved observation obligations under a live deletion claim',
            should:
              'allow genuine vendor-deleted completion while preserving all original financial identities',
            actual: [(await matrix.read()).status, action.id, action.chargeId],
            expected: ['succeeded', seeded.actionId, seeded.payment.chargeId],
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }),
  15_000,
);
