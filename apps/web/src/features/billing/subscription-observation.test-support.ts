export const identity = {
  subscriptionId: 'a'.repeat(24),
  vendorSubscriptionId: 'sub_fixture',
  customerId: 'cus_fixture',
  priceId: 'price_fixture',
  mode: 'test' as const,
};
export const start = 1_793_491_200;
export const end = start + 30 * 86400;
export const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
export const subscription = {
  id: identity.vendorSubscriptionId,
  object: 'subscription',
  customer: identity.customerId,
  livemode: false,
  status: 'active',
  collection_method: 'charge_automatically',
  latest_invoice: 'in_current',
  cancel_at_period_end: false,
  cancel_at: null,
  items: {
    has_more: false,
    data: [
      {
        id: 'si_fixture',
        quantity: 1,
        current_period_start: start,
        current_period_end: end,
        price: {
          id: identity.priceId,
          currency: 'usd',
          unit_amount: 1000,
          livemode: false,
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
          },
        },
      },
    ],
  },
};
export const invoice = {
  id: 'in_current',
  object: 'invoice',
  livemode: false,
  customer: identity.customerId,
  currency: 'usd',
  status: 'paid',
  amount_remaining: 0,
  attempted: true,
  attempt_count: 1,
  billing_reason: 'subscription_cycle',
  collection_method: 'charge_automatically',
  status_transitions: { paid_at: start + 5 },
  parent: {
    type: 'subscription_details',
    subscription_details: { subscription: identity.vendorSubscriptionId },
  },
  lines: {
    has_more: false,
    data: [
      {
        id: 'il_fixture',
        currency: 'usd',
        amount: 1000,
        quantity: 1,
        livemode: false,
        period: { start, end },
        parent: {
          type: 'subscription_item_details',
          subscription_item_details: {
            subscription: identity.vendorSubscriptionId,
            subscription_item: 'si_fixture',
            proration: false,
          },
        },
        pricing: {
          type: 'price_details',
          price_details: { price: identity.priceId },
        },
      },
    ],
  },
};
export const prior = {
  ...invoice,
  id: 'in_previous',
  status_transitions: { paid_at: start - 30 * 86400 + 5 },
  lines: {
    ...invoice.lines,
    data: [
      {
        ...invoice.lines.data[0]!,
        period: { start: start - 30 * 86400, end: start },
      },
    ],
  },
};
