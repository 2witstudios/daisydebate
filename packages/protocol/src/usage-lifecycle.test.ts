import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  usageStateSchema,
  usageHoldingStates,
  type UsageState,
} from './billing';
import { advanceUsage } from './usage-lifecycle';

setupRitewayBun();
const admittedAt = '2026-11-05T00:00:00.000Z';
const dispatchBefore = '2026-11-05T01:00:00.000Z';
const countedAt = '2026-11-05T00:01:00.000Z';
const reserved: UsageState = { kind: 'reserved' };
const dispatched: UsageState = {
  kind: 'dispatched',
  countedAt,
  countBasis: 'dispatch_record',
};
const run = (
  state: UsageState,
  event: Parameters<typeof advanceUsage>[1],
  now = countedAt,
  authorized = true,
) =>
  advanceUsage({ kind: 'ai_round', state, admittedAt }, event, {
    now,
    authorized,
  });

test('first-model-call counting is once-only and cannot dispatch after its deadline', () => {
  assert({
    given:
      'a reservation, repeated dispatch and an undispatched reservation at its deadline',
    should:
      'count once, preserve original count time and refuse a new dispatch at the cutoff',
    actual: [
      run(reserved, { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' }),
      run(
        dispatched,
        { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' },
        '2026-11-05T00:02:00.000Z',
      ),
      run(
        reserved,
        { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' },
        dispatchBefore,
      ),
    ],
    expected: [
      { kind: 'changed', state: dispatched },
      { kind: 'unchanged', state: dispatched },
      { kind: 'refuse' },
    ],
  });
});

test('only proven non-dispatch can release an expired reservation', () => {
  const unknown: UsageState = {
    kind: 'unknown',
    countedAt,
    countBasis: 'dispatch_record',
  };
  assert({
    given: 'reserved, dispatched and unknown work at expiry',
    should:
      'release only the reservation that could not have made a model call',
    actual: [
      run(reserved, { kind: 'expire', before: dispatchBefore }, dispatchBefore),
      run(
        dispatched,
        { kind: 'expire', before: dispatchBefore },
        dispatchBefore,
      ),
      run(unknown, { kind: 'expire', before: dispatchBefore }, dispatchBefore),
    ],
    expected: [
      {
        kind: 'changed',
        state: { kind: 'released', releasedAt: dispatchBefore },
      },
      { kind: 'unchanged', state: dispatched },
      { kind: 'unchanged', state: unknown },
    ],
  });
});

test('an unknown result holds use and may become delivered but never refunds itself', () => {
  const unknown: UsageState = {
    kind: 'unknown',
    countedAt,
    countBasis: 'dispatch_record',
  };
  assert({
    given: 'a timeout, later success and an unresolved observation',
    should:
      'retain counted use throughout uncertainty and accept only definite later evidence',
    actual: [
      run(dispatched, { kind: 'settle', outcome: 'unknown' }),
      run(unknown, { kind: 'settle', outcome: 'delivered' }),
      run(unknown, { kind: 'settle', outcome: 'unknown' }),
    ],
    expected: [
      { kind: 'changed', state: unknown },
      {
        kind: 'changed',
        state: { kind: 'delivered', countedAt, countBasis: 'dispatch_record' },
      },
      { kind: 'unchanged', state: unknown },
    ],
  });
});

test('a terminal definite-failure refund is once-only and can never also deliver success', () => {
  const refunded: UsageState = {
    kind: 'refunded',
    countedAt,
    countBasis: 'dispatch_record',
    refundedAt: countedAt,
  };
  assert({
    given:
      'all provider calls definitively failed, a repeated settlement and an inconsistent late success',
    should:
      'refund exactly once, preserve its attribution and reject double benefit',
    actual: [
      run(dispatched, { kind: 'settle', outcome: 'definite_failure' }),
      run(refunded, { kind: 'settle', outcome: 'definite_failure' }),
      run(refunded, { kind: 'settle', outcome: 'delivered' }),
    ],
    expected: [
      { kind: 'changed', state: refunded },
      { kind: 'unchanged', state: refunded },
      { kind: 'refuse' },
    ],
  });
});

test('account revocation overrides continuation but a paid period edge alone does not', () => {
  assert({
    given:
      'current account authority revoked or retained inside an already admitted feature deadline',
    should:
      'refuse revoked dispatch while allowing authorized work without a fresh payment-source selection',
    actual: [
      run(
        reserved,
        { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' },
        countedAt,
        false,
      ),
      run(
        reserved,
        { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' },
        countedAt,
        true,
      ),
    ],
    expected: [{ kind: 'refuse' }, { kind: 'changed', state: dispatched }],
  });
});

test('abandonment before dispatch releases without inventing a counted refund', () => {
  const released: UsageState = { kind: 'released', releasedAt: countedAt };
  assert({
    given: 'never dispatched, already dispatched and already released work',
    should: 'release only proven non-dispatch and keep a repeat idempotent',
    actual: [
      run(reserved, { kind: 'abandon' }),
      run(dispatched, { kind: 'abandon' }),
      run(released, { kind: 'abandon' }),
      run(released, { kind: 'dispatch', before: '2026-11-05T01:00:00.000Z' }),
    ],
    expected: [
      { kind: 'changed', state: released },
      { kind: 'refuse' },
      { kind: 'unchanged', state: released },
      { kind: 'refuse' },
    ],
  });
});

test('known failed use without recorded relief stays distinct from a refund and cannot dispatch', () => {
  const failed: UsageState = {
    kind: 'definite_failure',
    countedAt,
    countBasis: 'dispatch_record',
  };
  assert({
    given: 'counted nonservice with no restoration event in its history',
    should:
      'preserve that fact on replay, never invent a refund instant, and refuse renewed execution or inconsistent delivery',
    actual: [
      run(failed, { kind: 'settle', outcome: 'definite_failure' }),
      run(failed, { kind: 'settle', outcome: 'unknown' }),
      run(failed, { kind: 'settle', outcome: 'delivered' }),
      run(failed, { kind: 'dispatch', before: dispatchBefore }),
      run(failed, { kind: 'abandon' }),
      run(failed, { kind: 'expire', before: dispatchBefore }, dispatchBefore),
    ],
    expected: [
      { kind: 'unchanged', state: failed },
      { kind: 'refuse' },
      { kind: 'refuse' },
      { kind: 'refuse' },
      { kind: 'refuse' },
      { kind: 'unchanged', state: failed },
    ],
  });
});

test('unrestored failure remains spent and strict while a recorded refund is restored', () => {
  assert({
    given:
      'known failure, a real refund and malformed invented restoration fields',
    should: 'keep failed use spent and require exact protocol state shapes',
    actual: [
      usageHoldingStates.includes('definite_failure'),
      (usageHoldingStates as readonly string[]).includes('refunded'),
      usageStateSchema.safeParse({
        kind: 'definite_failure',
        countedAt,
        countBasis: 'dispatch_record',
      }).success,
      usageStateSchema.safeParse({ kind: 'definite_failure' }).success,
      usageStateSchema.safeParse({
        kind: 'definite_failure',
        countedAt,
        countBasis: 'dispatch_record',
        refundedAt: countedAt,
      }).success,
    ],
    expected: [true, false, true, false, false],
  });
});

test('historical observation basis survives late outcome settlement and never becomes dispatch authority', () => {
  const historical: UsageState = {
    kind: 'unknown',
    countedAt,
    countBasis: 'historical_observation',
  };
  const failed: UsageState = {
    kind: 'definite_failure',
    countedAt,
    countBasis: 'historical_observation',
  };
  assert({
    given:
      'historical counted evidence recognized after its Round ended, then definitive late accounting',
    should:
      'retain recognition basis/count on delivery or one real refund, while known unrestored failure stays terminal',
    actual: [
      run(historical, { kind: 'settle', outcome: 'delivered' }),
      run(historical, { kind: 'settle', outcome: 'definite_failure' }),
      run(failed, { kind: 'dispatch', before: dispatchBefore }),
    ],
    expected: [
      { kind: 'changed', state: { ...historical, kind: 'delivered' } },
      {
        kind: 'changed',
        state: { ...historical, kind: 'refunded', refundedAt: countedAt },
      },
      { kind: 'refuse' },
    ],
  });
});
