import { assert, setupRitewayBun, test } from 'riteway/bun';
import { advanceBillingSync, type BillingSyncState } from './billing-sync';
setupRitewayBun();
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 10, 5, 0, 0, seconds)).toISOString();
const id = 'a'.repeat(24);
const replacement = 'b'.repeat(24);
const pending: BillingSyncState = {
  kind: 'pending',
  revision: 1,
  requestedAt: at(0),
  retryAt: at(0),
};
const claimed: BillingSyncState = {
  kind: 'claimed',
  revision: 1,
  requestedAt: at(0),
  claim: { id, claimedAt: at(1), expiresAt: at(31) },
};

test('duplicate webhook hints preserve a healthy synchronization claim while a new hint invalidates its response', () => {
  assert({
    given: 'the durable receipt already existed',
    should: 'leave the exact current claim unchanged',
    actual: advanceBillingSync(
      claimed,
      { kind: 'notify', newReceipt: false },
      at(2),
    ),
    expected: { kind: 'unchanged' },
  });
  const newer = advanceBillingSync(
    claimed,
    { kind: 'notify', newReceipt: true },
    at(2),
  );
  assert({
    given: 'a newly inserted hint arrives during an older fetch',
    should: 'advance durable generation before any later response applies',
    actual: newer,
    expected: {
      kind: 'changed',
      state: {
        kind: 'pending',
        revision: 2,
        requestedAt: at(2),
        retryAt: at(2),
      },
    },
  });
  if (newer.kind !== 'changed') throw Error('Expected new hint');
  assert({
    given: 'the original vendor response finishes last',
    should: 'refuse without replacing newer pending work',
    actual: advanceBillingSync(
      newer.state,
      { kind: 'complete', revision: 1, claimId: id },
      at(3),
    ),
    expected: { kind: 'refuse' },
  });
});

test('claim recovery requires a fresh identity and invalidates the expired attempt even if it later returns', () => {
  assert({
    given: 'a still-live claim',
    should: 'refuse a second claimant',
    actual: advanceBillingSync(
      claimed,
      { kind: 'claim', claimId: replacement },
      at(30),
    ),
    expected: { kind: 'refuse' },
  });
  assert({
    given: 'recovery at exact lease expiry reuses the old identity',
    should: 'refuse replay',
    actual: advanceBillingSync(claimed, { kind: 'claim', claimId: id }, at(31)),
    expected: { kind: 'refuse' },
  });
  const next = advanceBillingSync(
    claimed,
    { kind: 'claim', claimId: replacement },
    at(31),
  );
  assert({
    given: 'a fresh claimant at exact lease expiry',
    should: 'advance generation and replace the bounded lease',
    actual: next,
    expected: {
      kind: 'changed',
      state: {
        kind: 'claimed',
        revision: 2,
        requestedAt: at(0),
        claim: { id: replacement, claimedAt: at(31), expiresAt: at(61) },
      },
    },
  });
  if (next.kind !== 'changed') throw Error('Expected recovered claim');
  assert({
    given: 'the expired attempt returns after recovery',
    should: 'refuse its otherwise successful response',
    actual: advanceBillingSync(
      next.state,
      { kind: 'complete', revision: 1, claimId: id },
      at(32),
    ),
    expected: { kind: 'refuse' },
  });
});

test('retry after a failed fetch retains pending work and fences all old completions', () => {
  const retry = advanceBillingSync(
    claimed,
    { kind: 'retry', revision: 1, claimId: id },
    at(2),
  );
  assert({
    given: 'an unsuccessful current fetch',
    should:
      'retain bounded retry work without claiming reconciliation succeeded',
    actual: retry,
    expected: {
      kind: 'changed',
      state: {
        kind: 'pending',
        revision: 2,
        requestedAt: at(0),
        retryAt: at(7),
      },
    },
  });
  if (retry.kind !== 'changed') throw Error('Expected retry');
  assert({
    given: 'the retry has not reached its due instant',
    should: 'refuse early claim and old response',
    actual: [
      advanceBillingSync(
        retry.state,
        { kind: 'claim', claimId: replacement },
        at(6),
      ),
      advanceBillingSync(
        retry.state,
        { kind: 'complete', revision: 1, claimId: id },
        at(6),
      ),
    ],
    expected: [{ kind: 'refuse' }, { kind: 'refuse' }],
  });
});

test('scheduled reconciliation starts only due work and never churns a live webhook claim', () => {
  const settled = advanceBillingSync(
    claimed,
    { kind: 'complete', revision: 1, claimId: id },
    at(3),
  );
  assert({
    given: 'a current verified response completed within its lease',
    should: 'record its own observation and next reconciliation instant',
    actual: settled,
    expected: {
      kind: 'changed',
      state: {
        kind: 'settled',
        revision: 1,
        observedAt: at(3),
        nextAt: at(303),
      },
    },
  });
  if (settled.kind !== 'changed') throw Error('Expected settlement');
  assert({
    given: 'a periodic scan before due time or during a healthy claim',
    should: 'leave both unchanged',
    actual: [
      advanceBillingSync(settled.state, { kind: 'poll' }, at(302)),
      advanceBillingSync(claimed, { kind: 'poll' }, at(2)),
    ],
    expected: [{ kind: 'unchanged' }, { kind: 'unchanged' }],
  });
  assert({
    given: 'a missed-event repair at its exact scheduled instant',
    should: 'create a fresh pending generation',
    actual: advanceBillingSync(settled.state, { kind: 'poll' }, at(303)),
    expected: {
      kind: 'changed',
      state: {
        kind: 'pending',
        revision: 2,
        requestedAt: at(303),
        retryAt: at(303),
      },
    },
  });
});

test('invalid clocks, stale claims and expired completions cannot change synchronization state', () => {
  assert({
    given: 'invalid or backwards clocks, another claimant, or exact expiry',
    should: 'refuse each without a new observed state',
    actual: [
      advanceBillingSync(pending, { kind: 'claim', claimId: id }, 'invalid'),
      advanceBillingSync(
        claimed,
        { kind: 'complete', revision: 1, claimId: id },
        at(0),
      ),
      advanceBillingSync(
        claimed,
        { kind: 'complete', revision: 1, claimId: replacement },
        at(2),
      ),
      advanceBillingSync(
        claimed,
        { kind: 'complete', revision: 1, claimId: id },
        at(31),
      ),
    ],
    expected: Array.from({ length: 4 }, () => ({ kind: 'refuse' })),
  });
});
