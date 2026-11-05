import {
  lockPurchaseSubject,
  ownedPurchase,
  parsePurchase,
  purchaseFromRow,
  savePurchase,
  type PurchaseSubject,
} from './billing-purchase-authority';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advancePurchase,
  nextPurchaseWork,
  type Purchase,
  type PurchaseEvent,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { requireFlagAdmission, type ReleaseAdmission } from './flags';
import { readDatabaseTime } from './database-clock';
import { billingPurchases } from './schema/billing-purchases';
import {
  completePurchaseMapping,
  permitsNewSubscription,
} from './billing-purchase-mapping';

type Subject = PurchaseSubject;
type Account = Awaited<ReturnType<typeof lockPurchaseSubject>>['account'];
export type BillingPurchasePolicies = {
  readonly purchase: (account: Account) => boolean;
  readonly manage: (account: Account) => boolean;
  readonly release: ReleaseAdmission;
};
type Offer = Pick<Purchase, 'mode' | 'priceId' | 'returnOrigin'>;
function existingOffer(purchase: Purchase, offer: Offer) {
  if (
    purchase.mode !== offer.mode ||
    purchase.priceId !== offer.priceId ||
    purchase.returnOrigin !== offer.returnOrigin
  )
    throw createAppError('CONFLICT');
  return { kind: 'existing' as const, purchase };
}

async function pendingPurchase(
  tx: BoundedTransactionContext,
  subject: Subject,
) {
  const [row] = await tx
    .select()
    .from(billingPurchases)
    .where(
      and(
        eq(billingPurchases.userId, subject.userId),
        sql`${billingPurchases.state}->>'kind' in ('admitted','creating','unknown','open')`,
      ),
    )
    .for('update');
  if (!row) return null;
  const purchase = purchaseFromRow(row);
  const now = (await readDatabaseTime(tx)).toISOString();
  const abandoned = advancePurchase(
    purchase,
    { kind: 'abandon' },
    { now, authority: 'active' },
  );
  if (abandoned.kind !== 'changed') return purchase;
  await savePurchase(tx, { ...purchase, state: abandoned.state });
  return null;
}

/** The one ordinary bounded control transaction; no vendor I/O or cached display flag enters admission. */
export function createBillingPurchases(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly policies: BillingPurchasePolicies;
}) {
  return {
    admit(subject: Subject, offer: Offer) {
      return input.run(
        async (
          tx,
        ): Promise<{
          readonly kind: 'admitted' | 'existing';
          readonly purchase: Purchase;
        }> => {
          const { account, customer, subscription } = await lockPurchaseSubject(
            tx,
            subject,
          );
          if (!input.policies.purchase(account) || customer?.closedAt)
            throw createAppError('AUTHORIZATION');
          if (customer && customer.mode !== offer.mode)
            throw createAppError('CONFLICT');
          const pending = await pendingPurchase(tx, subject);
          if (pending) return existingOffer(pending, offer);
          if (!permitsNewSubscription(subscription))
            throw createAppError('CONFLICT');
          // This final shared Flags lock uses a separate fresh post-lock snapshot/time.
          const { admittedAt } = await requireFlagAdmission(
            tx,
            subject.userId,
            input.policies.release,
          );
          const purchase = parsePurchase({
            id: input.nextId(),
            userId: subject.userId,
            mode: offer.mode,
            priceId: offer.priceId,
            returnOrigin: offer.returnOrigin,
            customerId: customer?.vendorCustomerId ?? null,
            admittedAt,
            state: { kind: 'admitted' },
          });
          await tx.insert(billingPurchases).values({
            id: purchase.id,
            userId: purchase.userId,
            mode: purchase.mode,
            priceId: purchase.priceId,
            vendorCustomerId: purchase.customerId,
            returnOrigin: purchase.returnOrigin,
            admittedAt: new Date(admittedAt),
            state: purchase.state,
          });
          return { kind: 'admitted', purchase };
        },
      );
    },
    read(subject: Subject, id: string) {
      return input.run(async (tx) => {
        const { account } = await lockPurchaseSubject(tx, subject);
        if (!input.policies.manage(account))
          throw createAppError('AUTHORIZATION');
        return ownedPurchase(tx, subject, id);
      });
    },
    recover(subject: Subject, id: string) {
      return input.run(async (tx) => {
        const { account, customer } = await lockPurchaseSubject(tx, subject);
        if (!input.policies.manage(account) || customer?.closedAt)
          throw createAppError('AUTHORIZATION');
        const purchase = await ownedPurchase(tx, subject, id);
        const context = {
          now: (await readDatabaseTime(tx)).toISOString(),
          authority: 'active' as const,
        };
        const work = nextPurchaseWork(purchase, context);
        if (work === 'create') {
          if (!input.policies.purchase(account))
            throw createAppError('AUTHORIZATION');
          const claimId = input.nextId();
          const transition = advancePurchase(
            purchase,
            { kind: 'claim', claimId },
            context,
          );
          if (transition.kind !== 'changed') throw createAppError('CONFLICT');
          const claimed = { ...purchase, state: transition.state };
          await savePurchase(tx, claimed);
          return { purchase: claimed, work, claimId };
        }
        if (work === 'abandon') {
          const transition = advancePurchase(
            purchase,
            { kind: 'abandon' },
            context,
          );
          if (transition.kind !== 'changed') throw createAppError('CONFLICT');
          const abandoned = { ...purchase, state: transition.state };
          await savePurchase(tx, abandoned);
          return { purchase: abandoned, work: 'none' as const, claimId: null };
        }
        return { purchase, work, claimId: null };
      });
    },
    record(
      subject: Subject,
      id: string,
      event:
        | Extract<PurchaseEvent, { kind: 'observe' | 'searched' }>
        | { readonly kind: 'unknown'; readonly claimId: string },
    ) {
      return input.run(async (tx) => {
        const { account, customer, subscription } = await lockPurchaseSubject(
          tx,
          subject,
        );
        if (!input.policies.manage(account) || customer?.closedAt)
          throw createAppError('AUTHORIZATION');
        const purchase = await ownedPurchase(tx, subject, id);
        const now = (await readDatabaseTime(tx)).toISOString();
        const transition = advancePurchase(purchase, event, {
          now,
          authority: 'active',
        });
        if (transition.kind !== 'changed') return transition.kind;
        const changed = { ...purchase, state: transition.state };
        if (changed.state.kind === 'complete')
          await completePurchaseMapping({
            tx,
            purchase: changed,
            customer,
            subscription,
            now,
            nextId: input.nextId,
          });
        await savePurchase(tx, changed);
        return 'changed' as const;
      });
    },
  };
}
