import {
  identity,
  invoice,
  start,
  iso,
} from './subscription-observation.test-support';

export const owner = {
  customerId: identity.customerId,
  vendorSubscriptionId: identity.vendorSubscriptionId,
  priceId: identity.priceId,
  mode: identity.mode,
};
export const payment = {
  id: 'inpay_original',
  object: 'invoice_payment',
  invoice: invoice.id,
  livemode: false,
  currency: 'usd',
  status: 'paid',
  amount_paid: 1000,
  amount_requested: 1000,
  is_default: true,
  status_transitions: { paid_at: start + 5, canceled_at: null },
  payment: { type: 'payment_intent', payment_intent: 'pi_original' },
};
export const charge = {
  id: 'ch_original',
  object: 'charge',
  customer: owner.customerId,
  livemode: false,
  currency: 'usd',
  paid: true,
  captured: true,
  status: 'succeeded',
  amount: 1000,
  amount_captured: 1000,
  payment_intent: 'pi_original',
};
export const intent = {
  id: 'pi_original',
  object: 'payment_intent',
  customer: owner.customerId,
  livemode: false,
  currency: 'usd',
  status: 'succeeded',
  amount_received: 1000,
  latest_charge: charge.id,
};
export const facts = {
  owner,
  closedAt: iso(start + 4),
  now: iso(start + 10),
  invoice: { ...invoice, amount_paid: 1000 },
  invoicePayment: payment,
  charge,
  paymentIntent: intent,
};
