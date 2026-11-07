import type { Purchase } from './billing-purchase';
import { advancePurchase } from './billing-purchase-lifecycle';
export const at = (seconds: number) =>
  new Date(Date.UTC(2026, 10, 5, 0, 0, seconds)).toISOString();
export const claimId = 'b'.repeat(24);
export const anotherClaim = 'c'.repeat(24);
export const base: Purchase = {
  id: 'a'.repeat(24),
  userId: 'u'.repeat(24),
  mode: 'test',
  priceId: 'price_premium',
  customerId: null,
  returnOrigin: 'https://daisy.example',
  admittedAt: at(0),
  state: { kind: 'admitted' },
};
export const context = (
  seconds: number,
  authority: 'active' | 'closed' | 'denied' = 'active',
) => ({ now: at(seconds), authority });
export function changed(
  purchase: Purchase,
  event: Parameters<typeof advancePurchase>[1],
  seconds: number,
) {
  const result = advancePurchase(purchase, event, context(seconds));
  if (result.kind !== 'changed') throw Error('Expected transition');
  return { ...purchase, state: result.state };
}
export const started = () => changed(base, { kind: 'claim', claimId }, 1);
export const observed = (
  purchase: Purchase,
  status: 'open' | 'expired',
  seconds: number,
) =>
  changed(
    purchase,
    {
      kind: 'observe',
      session: { kind: status, id: 'cs_test_owned', customerId: null },
    },
    seconds,
  );
