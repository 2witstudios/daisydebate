import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  billingPaymentObservationSchema,
  ownedPaymentObservationSchema,
} from '@daisy/protocol/billing';
import { createCleanupObservationDelivery } from './cleanup-observation-delivery';
setupRitewayBun();
type Input = Parameters<typeof createCleanupObservationDelivery>[0];
type Request = Parameters<
  ReturnType<typeof createCleanupObservationDelivery>
>[0];
const at = '2026-11-06T00:00:00.000Z';
const partial = {
  kind: 'partial',
  facts: {
    status: null,
    paidAtSeconds: null,
    amountPaidMinor: null,
    charge: { kind: 'unresolved' },
    period: null,
  },
};
const row = billingPaymentObservationSchema.parse({
  id: 'o'.repeat(24),
  userId: 'u'.repeat(24),
  kind: 'payment',
  mode: 'test',
  customerId: 'cus_owned',
  invoiceId: 'in_owned',
  invoicePaymentId: 'inpay_owned',
  refundActionId: null,
  closedAt: '2026-11-05T00:00:00.000Z',
  createdAt: at,
  observedAt: at,
  source: { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
  state: { kind: 'owed', reason: 'payment_unresolved', evidence: partial },
});
const read = ownedPaymentObservationSchema.parse({
  mode: row.mode,
  customerId: row.customerId,
  invoiceId: row.invoiceId,
  invoicePaymentId: 'inpay_owned',
  source: row.source,
  evidence: partial,
});
const request: Request = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  retryAt: at,
  work: {
    kind: 'scan',
    lane: 'observations',
    scan: {
      kind: 'selected',
      id: row.id,
      rest: ['r'.repeat(24)],
      lastId: 'r'.repeat(24),
      more: true,
      detail: { kind: 'resource' },
    },
  },
};
const unexpected = async () => {
  throw Error('Unexpected observation effect');
};
const resources = (): Input => ({
  running: () => true,
  read: async () => ({ kind: 'read', read }),
  store: {
    observations: unexpected,
    selectedObservation: async () => ({
      kind: 'observation',
      observation: row,
    }),
    retainObservation: unexpected,
    revisitPayment: unexpected,
    recordPayment: unexpected,
    record: unexpected,
  },
});

test('sticky observation contradictions advance only through retained-fact authority without fake vendor freshness', async () => {
  const retained: unknown[] = [];
  const conflict = billingPaymentObservationSchema.parse({
    ...row,
    state: { kind: 'owed', reason: 'conflicting_evidence', evidence: partial },
  });
  const deliver = createCleanupObservationDelivery({
    ...resources(),
    read: unexpected,
    store: {
      ...resources().store,
      selectedObservation: async () => ({
        kind: 'observation',
        observation: conflict,
      }),
      retainObservation: async (...args) => {
        retained.push(args);
        return 'progress';
      },
    },
  });
  assert({
    given: 'a retained payment contradiction with exact selected remainder',
    should:
      'preserve sticky evidence and use only the dedicated readonly retention transition',
    actual: [await deliver(request), retained],
    expected: ['progress', [[request.jobId, request.claimId, request.work]]],
  });
});

test('an actual late payment read can reopen knowledge once without reviving old cursor authority', async () => {
  const writes: unknown[] = [];
  let calls = 0;
  const deliver = createCleanupObservationDelivery({
    ...resources(),
    store: {
      ...resources().store,
      revisitPayment: async () => 'idle',
      recordPayment: async (...args) => {
        writes.push(args);
        return ++calls === 1 ? 'recorded' : 'unchanged';
      },
    },
  });
  assert({
    given: 'a successful fresh payment read whose original claim became stale',
    should:
      'retain through current account authority once and leave exact replay idle',
    actual: [await deliver(request), await deliver(request), writes],
    expected: [
      'reopened',
      'idle',
      [
        [row.userId, read],
        [row.userId, read],
      ],
    ],
  });
});

test('observation reread failure consumes only the current failure claim and DB failures never become fallback writes', async () => {
  const events: unknown[] = [];
  let late = 0;
  const unavailable = createCleanupObservationDelivery({
    ...resources(),
    read: async () => ({ kind: 'unavailable' }),
    store: {
      ...resources().store,
      record: async (_job, event) => {
        events.push(event);
        return 'failure';
      },
    },
  });
  const problem = Error('Controlled database failure');
  const broken = createCleanupObservationDelivery({
    ...resources(),
    store: {
      ...resources().store,
      revisitPayment: async () => {
        throw problem;
      },
      recordPayment: async () => {
        late++;
        return 'recorded';
      },
    },
  });
  let propagated = false;
  try {
    await broken(request);
  } catch (error) {
    propagated = error === problem;
  }
  assert({
    given:
      'unavailable vendor evidence or a distinct final transaction failure',
    should:
      'retry the former honestly while preserving the latter without a fallback mutation',
    actual: [await unavailable(request), events, propagated, late],
    expected: [
      'failure',
      [
        {
          kind: 'failure',
          claimId: request.claimId,
          work: request.work,
          retryAt: at,
        },
      ],
      true,
      0,
    ],
  });
});

test('stop after an in-flight read prevents both selected admission and late-account writes', async () => {
  let running = true,
    writes = 0;
  const deliver = createCleanupObservationDelivery({
    ...resources(),
    running: () => running,
    read: async () => {
      running = false;
      return { kind: 'read', read };
    },
    store: {
      ...resources().store,
      revisitPayment: async () => {
        writes++;
        return 'idle';
      },
      recordPayment: async () => {
        writes++;
        return 'recorded';
      },
    },
  });
  assert({
    given: 'shutdown while the exact owned payment read was in flight',
    should:
      'leave both execution and retained facts to future current authority',
    actual: [await deliver(request), writes],
    expected: ['idle', 0],
  });
});
