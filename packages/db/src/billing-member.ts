import { createAppError } from '@daisy/errors';
import { readAllowanceLocked, type AllowancePolicy } from './usage-ledger';
import {
  lockPurchaseSubject,
  type PurchaseSubject,
} from './billing-purchase-authority';
import { z } from 'zod';
import { permitsNewSubscription } from './billing-purchase-mapping';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';

type Account = Awaited<ReturnType<typeof lockPurchaseSubject>>['account'];

/** Member reads share purchase/closure account fences and the canonical allowance quote. */
export function createBillingMember(input: {
  readonly run: BoundedTransaction;
  readonly manage: (account: Account) => boolean;
  readonly purchase: (account: Account) => boolean;
  readonly allowance: AllowancePolicy;
}) {
  const owned = async (
    tx: BoundedTransactionContext,
    subject: PurchaseSubject,
  ) => {
    const locked = await lockPurchaseSubject(tx, subject);
    if (!input.manage(locked.account) || locked.customer?.closedAt)
      throw createAppError('AUTHORIZATION');
    return locked;
  };
  return {
    portalCustomer: (subject: PurchaseSubject) =>
      input.run(async (tx) => {
        const { customer } = await owned(tx, subject);
        return customer
          ? {
              id: customer.vendorCustomerId,
              mode: z.enum(['test', 'live']).parse(customer.mode),
            }
          : null;
      }),
    read: (subject: PurchaseSubject) =>
      input.run(async (tx) => {
        const { account, customer, subscription } = await owned(tx, subject);
        const quote = await readAllowanceLocked(tx, {
          account,
          request: { kind: 'bot_debate', roundId: null, withJudge: false },
          decide: input.allowance,
        });
        const reservation = quote.quote?.reservations.find(
          (entry) => entry.kind === 'ai_round',
        );
        const spent =
          quote.facts.usage.find((entry) => entry.kind === 'ai_round')?.spent ??
          0;
        return {
          now: quote.now,
          evidence: quote.facts.billing,
          purchaseAllowed:
            input.purchase(account) && permitsNewSubscription(subscription),
          hasCustomer: customer !== undefined && customer !== null,
          subscriptionLifecycle: subscription?.evidence.lifecycle ?? null,
          botDebates:
            reservation && reservation.limit !== null
              ? {
                  kind: 'limited' as const,
                  remaining: Math.max(0, reservation.limit - spent),
                  limit: reservation.limit,
                  source: reservation.source,
                  available: quote.decision.kind === 'admit',
                }
              : { kind: 'unavailable' as const },
        };
      }),
  };
}
