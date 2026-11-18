import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { clubSeatGrants } from './club-seat-grants';
import { currentEntitlementGrants } from './entitlement-validity';

setupRitewayBun();

const organizationId = 'o00000000000000000000001';
const user = (n: number) => `u${String(n).padStart(23, '0')}`;
const period = {
  subscriptionId: 's00000000000000000000001',
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
};
const graceEndsAt = '2026-12-08T00:00:00.000Z';
const paid: SubscriptionEvidence = {
  lifecycle: 'active',
  settlement: { kind: 'paid', invoiceId: 'in_paid', period },
};
const pastDue: SubscriptionEvidence = {
  lifecycle: 'past_due',
  settlement: {
    kind: 'renewal_failed',
    previous: { invoiceId: 'in_paid', period },
    invoiceId: 'in_failed',
    period: {
      ...period,
      startsAt: period.endsAt,
      endsAt: '2027-01-01T00:00:00.000Z',
    },
  },
};
const seat = (n: number, assignedAt = '2026-11-02T00:00:00.000Z') => ({
  userId: user(n),
  assignedAt,
});
const premium = [
  'round_analysis',
  'ai_rounds',
  'casual_ai_judge',
  'casual_capture',
  'recording_download',
];
const project = (
  evidence: SubscriptionEvidence | null,
  seatCount: number,
  seats: readonly ReturnType<typeof seat>[],
) => clubSeatGrants({ organizationId, evidence, seatCount, seats });

test('a funded seat on an active club plan carries the five Premium grants', () => {
  const projection = project(paid, 3, [seat(1), seat(2)]);
  assert({
    given: 'an active, paid club plan and two seat holders',
    should:
      'grant each holder exactly the five Premium entitlements from the club',
    actual: projection.map((holder) => [
      holder.userId,
      holder.grants.map((g) => g.entitlement),
    ]),
    expected: [
      [user(1), premium],
      [user(2), premium],
    ],
  });
  assert({
    given: 'one of those grants',
    should: 'name the club and the paid period',
    actual: projection[0]!.grants[0],
    expected: {
      entitlement: 'round_analysis',
      source: 'organization_seat',
      organizationId,
      startsAt: period.startsAt,
      expiresAt: period.endsAt,
    },
  });
});

test('no access means no seat grants', () => {
  const canceled: SubscriptionEvidence = { ...paid, lifecycle: 'canceled' };
  const unpaid: SubscriptionEvidence = {
    lifecycle: 'incomplete',
    settlement: { kind: 'unpaid' },
  };
  assert({
    given: 'a cancelled, unpaid or not-yet-observed club plan',
    should: 'hold every seat with no grants',
    actual: [canceled, unpaid, null].map((evidence) =>
      project(evidence, 2, [seat(1)]).map((h) => h.grants.length),
    ),
    expected: [[0], [0], [0]],
  });
});

test('past_due keeps seats through the 7-day renewal grace, AI Rounds paid-only', () => {
  const [holder] = project(pastDue, 2, [seat(1)]);
  const at = (now: string) =>
    currentEntitlementGrants(holder!.grants, { now, betaGrantsPremium: false })
      .map((g) => g.entitlement)
      .sort();
  assert({
    given: 'a failed renewal, one day into the grace',
    should: 'keep every Premium entitlement except bot Rounds',
    actual: at('2026-12-02T00:00:00.000Z'),
    expected: premium.filter((k) => k !== 'ai_rounds').sort(),
  });
  assert({
    given: 'the grace over',
    should: 'leave nothing',
    actual: at(graceEndsAt),
    expected: [],
  });
});

test('seats beyond the paid count hold no grants', () => {
  const projection = project(paid, 1, [
    seat(2, '2026-11-05T00:00:00.000Z'),
    seat(1, '2026-11-02T00:00:00.000Z'),
  ]);
  assert({
    given: 'two holders and a paid count of one',
    should: 'fund the earliest holder only',
    actual: projection.map((h) => [h.userId, h.grants.length]),
    expected: [
      [user(1), 5],
      [user(2), 0],
    ],
  });
});
