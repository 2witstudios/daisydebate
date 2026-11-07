import { refundActionSchema } from './billing-refund';
import { advanceRefund } from './billing-refund-lifecycle';
export const at = (seconds: number) =>
  new Date(
    Date.parse('2026-11-05T00:00:00.000Z') + seconds * 1000,
  ).toISOString();
export const first = 'a'.repeat(24);
export const second = 'b'.repeat(24);
export const third = 'c'.repeat(24);
export const fourth = 'd'.repeat(24);
export const action = () =>
  refundActionSchema.parse({
    id: 'r'.repeat(24),
    userId: 'u'.repeat(24),
    mode: 'test',
    customerId: 'cus_original',
    chargeId: 'ch_original',
    invoiceId: 'in_original',
    vendorSubscriptionId: 'sub_original',
    amountMinor: 1000,
    currency: 'usd',
    paidAtSeconds: Date.parse(at(1)) / 1000,
    period: { startsAt: at(-86400), endsAt: at(29 * 86400) },
    closedAt: at(0),
    admittedAt: at(2),
    state: { kind: 'ready' },
    claim: null,
  });
export const context = (seconds: number) => ({
  now: at(seconds),
  authority: 'closed' as const,
});
export function changed(
  current: ReturnType<typeof action>,
  event: Parameters<typeof advanceRefund>[1],
  seconds: number,
) {
  const result = advanceRefund(current, event, context(seconds));
  if (result.kind !== 'changed')
    throw Error(`Expected transition, got ${result.kind}`);
  return result.action;
}
