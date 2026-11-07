import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupInvoiceDelivery } from './cleanup-invoice-delivery';
import { createInvoicePassReader } from './invoice-pass-reader';
import {
  facts,
  member,
  pass,
  clock,
  binding,
} from './invoice-pass-reader.test-support';
import {
  current,
  request,
  store,
  resources,
  frozen,
  unexpected,
} from './cleanup-invoice-delivery.test-support';

setupRitewayBun();

test('active invoice retention uses the exact existing pass and atomically submits its actual producer member', async () => {
  const steps: unknown[] = [];
  let allocations = 0;
  const deliver = createCleanupInvoiceDelivery({
    ...resources(),
    nextId: () => {
      allocations++;
      return 'n'.repeat(24);
    },
    readPass: createInvoicePassReader({
      mode: binding.mode,
      clock,
      port: {
        payments: async () => ({
          object: 'list',
          has_more: false,
          data: [member],
        }),
        invoice: unexpected,
      },
    }),
    store: {
      ...store(),
      invoicePassStep: async (_job, _claim, _work, step) => {
        steps.push(
          step.kind === 'advance' && step.event.kind === 'retained'
            ? [step.event.kind, step.event.beforeId, step.event.read]
            : step.kind,
        );
        return 'progress';
      },
    },
  });
  const result = await deliver(request(pass('retaining')));
  const saved = steps[0] as unknown[];
  assert({
    given:
      'one current selected pass and one actual normalized list member from controlled transport',
    should:
      'retain under the original pass claim without creating new pass authority or skipping its evidence',
    actual: [
      result,
      allocations,
      saved[0],
      saved[1],
      (saved[2] as { invoicePaymentId: string }).invoicePaymentId,
    ],
    expected: ['progress', 0, 'retained', null, member.id],
  });
});
test('unknown original offer starts only an unknown-source retention pass, never money or enumeration authority', async () => {
  const steps: unknown[] = [];
  const deliver = createCleanupInvoiceDelivery({
    ...resources(),
    port: {
      invoice: async () => ({
        object: 'invoice',
        id: binding.invoiceId,
        customer: binding.customerId,
        livemode: false,
      }),
    },
    store: {
      ...store(),
      invoicePassStep: async (_job, _claim, _work, step) => {
        if (step.kind === 'start')
          steps.push([
            step.owner.source,
            step.owner.period,
            step.owner.userId,
            step.owner.invoiceId,
          ]);
        return 'progress';
      },
    },
  });
  assert({
    given:
      'a positively owned invoice with unavailable frozen subscription offer/period',
    should:
      'retain honest unknown provenance without inventing a current price or a financial result',
    actual: [await deliver(request(null)), steps],
    expected: [
      'progress',
      [
        [
          { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
          null,
          current.userId,
          binding.invoiceId,
        ],
      ],
    ],
  });
});
test('starting an owned invoice pass preserves its original purchase and observed period', async () => {
  const steps: unknown[] = [];
  const deliver = createCleanupInvoiceDelivery({
    ...resources(),
    port: { invoice: async () => facts.invoice },
    store: {
      ...store(),
      frozenOffer: async () => frozen(),
      invoicePassStep: async (_job, _claim, _work, step) => {
        if (step.kind === 'start')
          steps.push([step.owner.source, step.owner.period]);
        return 'progress';
      },
    },
  });
  assert({
    given: 'an original durable offer and a current positively owned invoice',
    should:
      'start from that exact original source and actual period instead of a live configured price',
    actual: [await deliver(request(null)), steps],
    expected: ['progress', [[binding.source, pass('retaining').owner.period]]],
  });
});
test('new invoice facts reopen before pass admission and late HEAD members persist once without old cursor authority', async () => {
  let starts = 0,
    batches = 0;
  const newInvoice = createCleanupInvoiceDelivery({
    ...resources(),
    port: { invoice: async () => facts.invoice },
    store: {
      ...store(),
      recordInvoices: async () => 'recorded',
      invoicePassStep: async () => {
        starts++;
        return 'progress';
      },
    },
  });
  const final = pass('verify-invoice');
  if (final.phase !== 'verify-invoice') throw Error('Missing HEAD fixture');
  const late = createCleanupInvoiceDelivery({
    ...resources(),
    readPass: async () => ({
      kind: 'advance',
      event: { kind: 'head', receipt: final.head },
    }),
    store: {
      ...store(),
      invoicePassStep: async () => 'idle',
      recordPayments: async (_user, reads) => {
        batches++;
        if (!Array.isArray(reads) || reads.length !== 1)
          throw Error('Expected complete retained member batch');
        return 'recorded';
      },
    },
  });
  assert({
    given:
      'new owned invoice knowledge or a stale original claim with positively read HEAD members',
    should:
      'use current account-fenced retention once and grant no stale pass/cursor authority',
    actual: [
      await newInvoice(request(null)),
      await late(request(pass('verify-head'))),
      starts,
      batches,
    ],
    expected: ['reopened', 'reopened', 0, 1],
  });
});
test('unavailable reads, database failures and shutdown preserve their distinct outcomes', async () => {
  let failures = 0,
    lateWrites = 0,
    running = true;
  const problem = Error('Controlled database failure');
  const failed = createCleanupInvoiceDelivery({
    ...resources(),
    store: {
      ...store(),
      record: async () => {
        failures++;
        return 'failure';
      },
    },
  });
  const database = createCleanupInvoiceDelivery({
    ...resources(),
    readPass: async () => ({
      kind: 'advance',
      event: { kind: 'exhausted', beforeId: null },
    }),
    store: {
      ...store(),
      invoicePassStep: async () => {
        throw problem;
      },
      recordPayments: async () => {
        lateWrites++;
        return 'recorded';
      },
    },
  });
  let propagated = false;
  try {
    await database(request(pass('retaining')));
  } catch (error) {
    propagated = error === problem;
  }
  const stopped = createCleanupInvoiceDelivery({
    ...resources(),
    running: () => running,
    readPass: async () => {
      running = false;
      return { kind: 'unavailable' };
    },
    store: {
      ...store(),
      record: async () => {
        failures++;
        return 'failure';
      },
    },
  });
  assert({
    given:
      'one unavailable vendor read, actual DB failure, or stop while a read is in flight',
    should:
      'back off only vendor uncertainty, propagate DB failure and admit no post-stop retry/fallback',
    actual: [
      await failed(request(pass('retaining'))),
      propagated,
      await stopped(request(pass('retaining'))),
      failures,
      lateWrites,
    ],
    expected: ['failure', true, 'idle', 1, 0],
  });
});
