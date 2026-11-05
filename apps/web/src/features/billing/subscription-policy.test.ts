import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subscriptionAccess, subscriptionGrants } from './subscription-policy';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { currentEntitlementGrants } from '@daisy/auth/authorization';

setupRitewayBun();

const period = {
  subscriptionId: 'sub_test',
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
};
const paid: SubscriptionEvidence = {
  lifecycle: 'active',
  settlement: { kind: 'paid', invoiceId: 'in_paid', period },
};
const failed: SubscriptionEvidence = {
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

test('verified paid intervals are half-open and vendor active alone is insufficient', () => {
  assert({
    given:
      'verified payment before/start/end and active status with no paid evidence',
    should: 'grant only the verified current period',
    actual: [
      subscriptionAccess(paid, '2026-10-31T23:59:59.999Z'),
      subscriptionAccess(paid, period.startsAt),
      subscriptionAccess(paid, period.endsAt),
      subscriptionAccess(
        { lifecycle: 'active', settlement: { kind: 'unpaid' } },
        period.startsAt,
      ),
    ],
    expected: [
      { kind: 'none' },
      { kind: 'paid', period },
      { kind: 'none' },
      { kind: 'none' },
    ],
  });
});

test('failed renewal grace is anchored to previously verified paid-through, never observation time', () => {
  const grace = {
    kind: 'grace',
    period,
    expiresAt: '2026-12-08T00:00:00.000Z',
  };
  assert({
    given:
      'unchanged failed-renewal evidence before the edge, throughout grace and after seven days',
    should:
      'keep the paid period first, then exactly seven days of grace with no observation-based extension',
    actual: [
      '2026-11-30T23:59:59.999Z',
      period.endsAt,
      '2026-12-07T23:59:59.999Z',
      '2026-12-08T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ].map((now) => subscriptionAccess(failed, now)),
    expected: [
      { kind: 'paid', period },
      grace,
      grace,
      { kind: 'none' },
      { kind: 'none' },
    ],
  });
});

test('terminal and unsupported statuses never grant or grace even with old paid evidence', () => {
  assert({
    given:
      'canceled, unpaid, paused, incomplete, expired or trialing vendor states',
    should:
      'revoke all subscription capabilities rather than preserve an old paid/grace row',
    actual: (
      [
        'canceled',
        'unpaid',
        'paused',
        'incomplete',
        'incomplete_expired',
        'trialing',
      ] as const
    ).map((lifecycle) =>
      subscriptionAccess({ ...paid, lifecycle }, period.startsAt),
    ),
    expected: Array.from({ length: 6 }, () => ({ kind: 'none' })),
  });
});

test('malformed or unrelated period evidence cannot create paid access or grace', () => {
  const settlement = failed.settlement;
  if (settlement.kind !== 'renewal_failed')
    throw new Error('Expected renewal fixture');
  assert({
    given:
      'different subscription, a gap, reversed period or invalid evaluation time',
    should:
      'fail closed rather than stitch unrelated payments into a new grant',
    actual: [
      subscriptionAccess(
        {
          ...failed,
          settlement: {
            ...settlement,
            period: { ...settlement.period, subscriptionId: 'sub_other' },
          },
        },
        period.endsAt,
      ),
      subscriptionAccess(
        {
          ...failed,
          settlement: {
            ...settlement,
            period: {
              ...settlement.period,
              startsAt: '2026-12-02T00:00:00.000Z',
            },
          },
        },
        period.endsAt,
      ),
      subscriptionAccess(
        {
          ...paid,
          settlement: {
            kind: 'paid',
            invoiceId: 'in_paid',
            period: { ...period, endsAt: period.startsAt },
          },
        },
        period.startsAt,
      ),
      subscriptionAccess(paid, 'invalid'),
    ],
    expected: Array.from({ length: 4 }, () => ({ kind: 'none' })),
  });
});

test('explicit subscription mapping grants five paid capabilities and four during grace', () => {
  const kinds = (evidence: SubscriptionEvidence, now: string) =>
    currentEntitlementGrants(subscriptionGrants(evidence), {
      now,
      betaGrantsPremium: false,
    }).map((grant) => grant.entitlement);
  assert({
    given: 'verified paid, renewal grace, or absent access',
    should:
      'exclude fresh bot admissions during grace and remove all grants at the fixed deadline',
    actual: [
      kinds(paid, period.startsAt),
      kinds(failed, period.endsAt),
      kinds(failed, '2026-12-08T00:00:00.000Z'),
    ],
    expected: [
      [
        'round_analysis',
        'ai_rounds',
        'casual_ai_judge',
        'casual_capture',
        'recording_download',
      ],
      [
        'round_analysis',
        'casual_ai_judge',
        'casual_capture',
        'recording_download',
      ],
      [],
    ],
  });
});

test('a verified failed renewal projects the whole paid-to-grace interval before workers stop', () => {
  const grants = subscriptionGrants(failed);
  assert({
    given:
      'one persisted grant projection observed before paid-through and never rewritten',
    should:
      'retain four capabilities through fixed grace while bot admission expires at paid-through',
    actual: [period.startsAt, period.endsAt, '2026-12-09T00:00:00.000Z'].map(
      (now) =>
        currentEntitlementGrants(grants, { now, betaGrantsPremium: false }).map(
          (grant) => grant.entitlement,
        ),
    ),
    expected: [
      [
        'round_analysis',
        'ai_rounds',
        'casual_ai_judge',
        'casual_capture',
        'recording_download',
      ],
      [
        'round_analysis',
        'casual_ai_judge',
        'casual_capture',
        'recording_download',
      ],
      [],
    ],
  });
});
