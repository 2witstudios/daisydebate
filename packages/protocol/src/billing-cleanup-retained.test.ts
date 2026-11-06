import { assert, setupRitewayBun, test } from 'riteway/bun';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import { cleanupWork, type CleanupEvent } from './billing-cleanup';
import {
  initial,
  empty,
  claimed,
  changed,
  page,
  context,
  first,
  second,
  at,
} from './billing-cleanup.test-support';
import { owner } from './billing-payment-observation.test-support';
import { billingPaymentObservationSchema } from './billing-payment-observation';
setupRitewayBun();
function selectedInvoice() {
  let value = empty(initial(), 0);
  value = empty(value, 2);
  value = claimed(value, 4);
  value = changed(value, page(value, [owner.invoiceId, 'in_later']), 4.1);
  value = empty(value, 6);
  value = empty(value, 8);
  return claimed(value, 10);
}
const witness = () =>
  billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
const owned = () => ({
  ...context(10.1),
  observationOwner: { userId: owner.userId, closedAt: owner.closedAt },
});

test('a retained owed invoice advances bounded discovery without pretending it was resolved or renewing its claim', () => {
  const value = selectedInvoice(),
    observation = witness();
  const result = advanceCleanup(
    value,
    {
      kind: 'retained',
      claimId: first,
      work: cleanupWork(value)!,
      observation,
    },
    owned(),
  );
  assert({
    given:
      'an exact current invoice claim and a durably retained invoice-only owed witness',
    should:
      'consume the claim, preserve owed evidence and advance only the exact selected remainder at fixed progress due',
    actual: [
      result.kind,
      result.kind !== 'idle' &&
        result.state.kind === 'scanning' && [
          result.state.scans.invoices,
          result.state.retryAt,
          result.state.claim,
        ],
      observation.state,
    ],
    expected: [
      'progress',
      [
        {
          kind: 'selected',
          id: 'in_later',
          rest: [],
          lastId: 'in_later',
          more: false,
          detail: { kind: 'invoice-payments', afterId: null },
        },
        at(11.1),
        null,
      ],
      { kind: 'owed', reason: 'enumeration_unavailable' },
    ],
  });
});

test('missing/foreign observation ownership, stale claim and unmatched invoice cannot authorize retention progress', () => {
  const value = selectedInvoice(),
    event: Extract<CleanupEvent, { kind: 'retained' }> = {
      kind: 'retained',
      claimId: first,
      work: cleanupWork(value)!,
      observation: witness(),
    };
  const attempts = [
    advanceCleanup(value, event, context(10.1)),
    advanceCleanup(value, event, {
      ...owned(),
      observationOwner: { userId: 'x'.repeat(24), closedAt: owner.closedAt },
    }),
    advanceCleanup(value, event, {
      ...owned(),
      observationOwner: { userId: owner.userId, closedAt: at(1) },
    }),
    advanceCleanup(value, { ...event, claimId: second }, owned()),
    advanceCleanup(
      value,
      { ...event, observation: { ...witness(), invoiceId: 'in_other' } },
      owned(),
    ),
    advanceCleanup(
      value,
      { ...event, observation: { ...witness(), observedAt: at(11) } },
      owned(),
    ),
  ];
  assert({
    given:
      'a current frame without the matching persisted identity/owner or current authority',
    should: 'refuse all without moving cursor or forgetting owed facts',
    actual: attempts,
    expected: attempts.map(() => ({ kind: 'idle' })),
  });
});
