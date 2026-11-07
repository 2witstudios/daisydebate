import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  subscriptionEvidenceSchema,
  usageSourceSchema,
  usageStateSchema,
} from './billing';

setupRitewayBun();
const id = 'c8d4e2f6a1b3k5m7n9p2r4t6';
const startsAt = '2026-11-01T00:00:00.000Z';
const endsAt = '2026-12-01T00:00:00.000Z';
const period = { subscriptionId: id, startsAt, endsAt };

test('durable allowance attribution admits only explicit source and ordered period identities', () => {
  assert({
    given:
      'lifetime, beta and local subscription sources plus unbounded or mixed attribution',
    should:
      'accept the three exact shapes and reject implicit, reversed, vendor-id or hidden-field attribution',
    actual: [
      { kind: 'lifetime' },
      { kind: 'beta', startsAt, endsAt },
      { kind: 'subscription', ...period },
      { kind: 'subscription', subscriptionId: id },
      { kind: 'subscription', ...period, endsAt: startsAt },
      { kind: 'subscription', ...period, subscriptionId: 'sub_vendor' },
      { kind: 'lifetime', startsAt, endsAt },
      { kind: 'beta', startsAt: 'infinity', endsAt },
    ].map((source) => usageSourceSchema.safeParse(source).success),
    expected: [true, true, true, false, false, false, false, false],
  });
});

test('durable evidence excludes observation-time access snapshots and unrelated fields', () => {
  const paid = { invoiceId: 'in_test', period };
  assert({
    given:
      'verified evidence, a paid access snapshot, or an extra raw vendor object',
    should:
      'persist only the bounded normalized evidence required to rederive future access',
    actual: [
      { lifecycle: 'active', settlement: { kind: 'paid', ...paid } },
      {
        lifecycle: 'past_due',
        settlement: { kind: 'renewal_failed', ...paid, previous: paid },
      },
      { kind: 'paid', period },
      {
        lifecycle: 'active',
        settlement: { kind: 'paid', ...paid },
        customer: { email: 'not-stored@example.invalid' },
      },
    ].map((value) => subscriptionEvidenceSchema.safeParse(value).success),
    expected: [true, true, false, false],
  });
});

test('usage state refuses credits without provenance and releases that pretend to have dispatched', () => {
  assert({
    given:
      'valid accounting states alongside ambiguous or chronologically impossible credit/release states',
    should:
      'require exact semantic state, original count and valid credit provenance',
    actual: [
      { kind: 'reserved' },
      { kind: 'unknown', countedAt: startsAt, countBasis: 'dispatch_record' },
      {
        kind: 'refunded',
        countedAt: startsAt,
        countBasis: 'dispatch_record',
        refundedAt: endsAt,
      },
      {
        kind: 'credited',
        countedAt: startsAt,
        countBasis: 'dispatch_record',
        creditedAt: endsAt,
        provenance: { kind: 'recovery_bound', incidentId: id },
        providerOutcome: 'delivered',
      },
      {
        kind: 'credited',
        countedAt: startsAt,
        countBasis: 'dispatch_record',
        creditedAt: endsAt,
        provenance: { kind: 'recorded_restoration' },
        providerOutcome: 'unknown',
      },
      {
        kind: 'credited',
        countedAt: startsAt,
        countBasis: 'dispatch_record',
        creditedAt: endsAt,
        provenance: { kind: 'recorded_restoration', reason: 'invented' },
        providerOutcome: 'unknown',
      },
      {
        kind: 'credited',
        countedAt: startsAt,
        countBasis: 'dispatch_record',
        creditedAt: endsAt,
        providerOutcome: 'unknown',
      },
      {
        kind: 'refunded',
        countedAt: endsAt,
        countBasis: 'dispatch_record',
        refundedAt: startsAt,
      },
      { kind: 'released', releasedAt: endsAt, countedAt: startsAt },
      { kind: 'reserved', countedAt: startsAt },
    ].map((value) => usageStateSchema.safeParse(value).success),
    expected: [true, true, true, true, true, false, false, false, false, false],
  });
});
