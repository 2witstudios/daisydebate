import {
  subscription,
  invoice,
  prior,
} from './subscription-observation.test-support';

export const seats = 14;
export const month = 30 * 86400;
const clubPrice = {
  ...subscription.items.data[0]!.price,
  unit_amount: 1000,
  lookup_key: 'daisy_club_seat_monthly_usd_10',
};
export const clubSubscription = (quantity = seats, delta: object = {}) => ({
  ...subscription,
  ...delta,
  items: {
    ...subscription.items,
    data: [{ ...subscription.items.data[0]!, quantity, price: clubPrice }],
  },
});
export const line = invoice.lines.data[0]!;
export const settling = (
  base: typeof invoice,
  quantity = seats,
  delta: object = {},
) => ({
  ...base,
  ...delta,
  lines: {
    ...base.lines,
    data: [{ ...base.lines.data[0]!, quantity, amount: 1000 * quantity }],
  },
});
export const renewal = settling(invoice);
export const previousRenewal = settling(prior);
