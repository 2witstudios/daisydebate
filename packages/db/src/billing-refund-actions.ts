import { and, asc, eq, gt } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceRefund,
  nextRefundWork,
  type RefundAction,
  type RefundEvent,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import { checkBillingPage, type BillingPage } from './billing-pagination';
import {
  lockRefundAccount,
  lockRefundAction,
} from './billing-refund-authority';
import { billingRefundActions } from './schema/billing-refund-actions';
import {
  admitRefundAction,
  type RefundPayment,
} from './billing-refund-admission';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

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
    admit(userId: string, payment: RefundPayment) {
      return input.run(async (tx) => {
        const closedAt = await lockRefundAccount(tx, userId);
        const result = await admitRefundAction(tx, {
          userId,
          closedAt,
          payment,
          nextId: input.nextId,
        });
        if (result.kind === 'conflict') throw createAppError('CONFLICT');
        if (result.kind === 'admitted')
          await enqueuePrivacyJob(tx, {
            id: input.nextId(),
            subjectRef: userId,
            vendor: 'stripe',
            createdAt: (await readDatabaseTime(tx)).toISOString(),
          });
        return result;
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
