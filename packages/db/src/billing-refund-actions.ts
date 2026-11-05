import { and, asc, eq, gt } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceRefund,
  closurePaymentDisposition,
  nextRefundWork,
  refundActionSchema,
  type RefundAction,
  type RefundEvent,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import { checkBillingPage, type BillingPage } from './billing-pagination';
import {
  lockRefundAccount,
  lockRefundAction,
  refundFromRow,
  requireRefundCustomer,
} from './billing-refund-authority';
import { billingRefundActions } from './schema/billing-refund-actions';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

type Payment = Pick<
  RefundAction,
  | 'mode'
  | 'customerId'
  | 'chargeId'
  | 'invoiceId'
  | 'vendorSubscriptionId'
  | 'amountMinor'
  | 'currency'
  | 'period'
  | 'paidAtSeconds'
>;
function originalPayment(action: RefundAction): Payment {
  return {
    mode: action.mode,
    customerId: action.customerId,
    chargeId: action.chargeId,
    invoiceId: action.invoiceId,
    vendorSubscriptionId: action.vendorSubscriptionId,
    amountMinor: action.amountMinor,
    currency: action.currency,
    period: action.period,
    paidAtSeconds: action.paidAtSeconds,
  };
}
function samePayment(action: RefundAction, other: RefundAction) {
  return (
    action.userId === other.userId &&
    action.closedAt === other.closedAt &&
    JSON.stringify(originalPayment(action)) ===
      JSON.stringify(originalPayment(other))
  );
}
function newRefundFact(before: RefundAction, after: RefundAction) {
  if (after.state.kind !== 'known') return false;
  return (
    before.state.kind !== 'known' ||
    before.state.refundId !== after.state.refundId ||
    before.state.status !== after.state.status
  );
}

/** Current service composition supplies the transaction; one original charge always retains one action/key. */
export function createBillingRefundActions(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    admit(userId: string, payment: Payment) {
      return input.run(async (tx) => {
        const closedAt = await lockRefundAccount(tx, userId);
        await requireRefundCustomer(
          tx,
          userId,
          payment.mode,
          payment.customerId,
        );
        const now = (await readDatabaseTime(tx)).toISOString();
        const disposition = closurePaymentDisposition({
          closedAt,
          paidAtSeconds: payment.paidAtSeconds,
          now,
        });
        if (disposition !== 'refund') return { kind: disposition };
        const action = refundActionSchema.parse({
          ...payment,
          id: input.nextId(),
          userId,
          closedAt,
          admittedAt: now,
          state: { kind: 'ready' },
          claim: null,
        });
        const inserted = await tx
          .insert(billingRefundActions)
          .values({
            id: action.id,
            userId,
            mode: action.mode,
            vendorCustomerId: action.customerId,
            vendorChargeId: action.chargeId,
            vendorInvoiceId: action.invoiceId,
            vendorSubscriptionId: action.vendorSubscriptionId,
            amountMinor: action.amountMinor,
            currency: action.currency,
            periodStartsAt: new Date(action.period.startsAt),
            periodEndsAt: new Date(action.period.endsAt),
            closedAt: new Date(closedAt),
            paidAtSeconds: action.paidAtSeconds,
            admittedAt: new Date(now),
            state: action.state,
            claim: null,
          })
          .onConflictDoNothing({
            target: [
              billingRefundActions.mode,
              billingRefundActions.vendorChargeId,
            ],
          })
          .returning();
        const [row] = await tx
          .select()
          .from(billingRefundActions)
          .where(
            and(
              eq(billingRefundActions.mode, action.mode),
              eq(billingRefundActions.vendorChargeId, action.chargeId),
            ),
          )
          .for('update');
        if (!row) throw createAppError('CONFLICT');
        const stored = refundFromRow(row);
        if (!samePayment(stored, action)) throw createAppError('CONFLICT');
        if (inserted.length === 0)
          return { kind: 'existing' as const, action: stored };
        await enqueuePrivacyJob(tx, {
          id: input.nextId(),
          subjectRef: userId,
          vendor: 'stripe',
          createdAt: now,
        });
        return { kind: 'admitted' as const, action: stored };
      });
    },
    claim(id: string) {
      return input.run(async (tx) => {
        const action = await lockRefundAction(tx, id);
        if (!action) return null;
        const context = {
          now: (await readDatabaseTime(tx)).toISOString(),
          authority: 'closed' as const,
        };
        const work = nextRefundWork(action, context);
        if (work === 'wait' || work === 'refuse') return { work, action };
        const transition = advanceRefund(
          action,
          { kind: 'claim', claimId: input.nextId() },
          context,
        );
        if (transition.kind !== 'changed') throw createAppError('CONFLICT');
        await tx
          .update(billingRefundActions)
          .set({
            state: transition.action.state,
            claim: transition.action.claim,
          })
          .where(eq(billingRefundActions.id, id));
        return { work, action: transition.action };
      });
    },
    record(id: string, event: Exclude<RefundEvent, { kind: 'claim' }>) {
      return input.run(async (tx) => {
        const action = await lockRefundAction(tx, id);
        if (!action) return 'missing' as const;
        const now = (await readDatabaseTime(tx)).toISOString();
        const transition = advanceRefund(action, event, {
          now,
          authority: 'closed',
        });
        if (transition.kind !== 'changed') return transition.kind;
        await tx
          .update(billingRefundActions)
          .set({
            state: transition.action.state,
            claim: transition.action.claim,
          })
          .where(eq(billingRefundActions.id, id));
        if (newRefundFact(action, transition.action))
          await enqueuePrivacyJob(tx, {
            id: input.nextId(),
            subjectRef: action.userId,
            vendor: 'stripe',
            createdAt: now,
          });
        return 'changed' as const;
      });
    },
    actions(page: BillingPage) {
      checkBillingPage(page);
      return input.run(async (tx) => {
        const rows = await tx
          .select({ actionId: billingRefundActions.id })
          .from(billingRefundActions)
          .where(
            and(
              eq(billingRefundActions.mode, page.mode),
              ...(page.afterId === undefined
                ? []
                : [gt(billingRefundActions.id, page.afterId)]),
            ),
          )
          .orderBy(asc(billingRefundActions.id))
          .limit(page.limit);
        return {
          rows,
          afterId: rows.at(-1)?.actionId ?? null,
          exhausted: rows.length < page.limit,
        };
      });
    },
  };
}
