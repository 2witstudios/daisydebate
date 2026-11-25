import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EntitlementGrant } from '@daisy/protocol/entitlements';
import { wearsPremiumMark } from './premium-holder';

setupRitewayBun();

const now = '2026-11-25T00:00:00.000Z';
const paid = (expiresAt: string): EntitlementGrant => ({
  entitlement: 'casual_capture',
  source: 'subscription',
  startsAt: '2026-11-01T00:00:00.000Z',
  expiresAt,
});
const beta: EntitlementGrant = {
  entitlement: 'ai_rounds',
  source: 'beta',
  startsAt: null,
  expiresAt: null,
} as never;

test('the Premium mark follows current Premium grants', () => {
  const wears = (
    grants: readonly EntitlementGrant[],
    betaGrantsPremium = false,
  ) => wearsPremiumMark(grants, { now, betaGrantsPremium });
  assert({
    given:
      'a paid grant in its period, one past its end, a beta grant while beta grants Premium and after, and no grant',
    should: 'mark only the member whose grant gives access now',
    actual: [
      wears([paid('2026-12-25T00:00:00.000Z')]),
      wears([paid('2026-11-20T00:00:00.000Z')]),
      wears([beta], true),
      wears([beta]),
      wears([]),
    ],
    expected: [true, false, true, false, false],
  });
});
