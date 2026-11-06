import { test, assert, setupRitewayBun } from 'riteway/bun';
setupRitewayBun();
import { billingCleanupSchema, startCleanup } from './billing-cleanup';

test('current cleanup execution can select an invoice with no inherited pass authority', () => {
  const state = startCleanup('j'.repeat(24), '2026-11-06T12:00:00.000Z');
  if (state?.kind !== 'scanning') throw Error('Expected initial scan');
  const result = billingCleanupSchema.safeParse({
    ...state,
    turn: 'invoices',
    scans: {
      ...state.scans,
      invoices: {
        kind: 'selected',
        id: 'in_owned',
        rest: ['in_later'],
        lastId: 'in_later',
        more: false,
        detail: { kind: 'invoice-payments', pass: null },
      },
    },
  }).success;
  assert({
    given: 'a selected invoice with preserved remainder and null pass',
    should: 'store no inherited cursor coverage authority',
    actual: result,
    expected: true,
  });
});

test('retired unversioned execution cannot regain authority while historical acknowledgement remains readable', () => {
  const value = startCleanup('j'.repeat(24), '2026-11-06T12:00:00.000Z');
  if (!value || value.kind !== 'scanning') throw Error('Expected scanning');
  const { version, ...retired } = value;
  const acknowledged = {
    kind: 'acknowledged',
    outcome: 'vendor-deleted',
    jobId: value.jobId,
    checkedAt: '2026-11-06T12:00:00.000Z',
    nextAt: '2026-11-07T12:00:00.000Z',
  };
  assert({
    given:
      'fresh v2 execution, retired unversioned execution and historical acknowledged knowledge',
    should: 'require fresh execution version without rewriting historical ACK',
    actual: [
      version,
      billingCleanupSchema.safeParse(retired).success,
      billingCleanupSchema.safeParse(acknowledged).success,
    ],
    expected: [2, false, true],
  });
});
