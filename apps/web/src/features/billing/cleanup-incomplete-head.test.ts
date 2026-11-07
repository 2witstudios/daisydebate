import { assert, setupRitewayBun, test } from 'riteway/bun';
import { z } from 'zod';
import { ownedPaymentObservationSchema } from '@daisy/protocol/billing';
import { createCleanupInvoiceDelivery } from './cleanup-invoice-delivery';
import { createInvoicePassReader } from './invoice-pass-reader';
import {
  member,
  pass,
  clock,
  binding,
} from './invoice-pass-reader.test-support';
import {
  resources,
  store,
  request,
  unexpected,
} from './cleanup-invoice-delivery.test-support';
setupRitewayBun();
const page = (data: unknown[]) => ({ object: 'list', has_more: false, data });
function build(
  data: unknown[],
  options: {
    refuse?: boolean;
    error?: Error;
    stopAfterRead?: boolean;
    invalidClaim?: boolean;
    rotated?: boolean;
  } = {},
) {
  const writes: { userId: string; ids: string[]; kinds: string[] }[] = [];
  const events: string[] = [];
  let running = true;
  const deliver = createCleanupInvoiceDelivery({
    ...resources(),
    running: () => running,
    readPass: createInvoicePassReader({
      mode: binding.mode,
      clock,
      port: {
        invoice: unexpected,
        payments: async () => {
          if (options.stopAfterRead) running = false;
          return page(data);
        },
      },
    }),
    store: {
      ...store(),
      recordPayments: async (userId, reads) => {
        const payments = z.array(ownedPaymentObservationSchema).parse(reads);
        writes.push({
          userId,
          ids: payments.map((r) => r.invoicePaymentId),
          kinds: payments.map((r) => r.evidence.kind),
        });
        if (options.error) throw options.error;
        return options.refuse ? 'refuse' : 'recorded';
      },
      invoicePassStep: async (_job, _claim, _work, step) => {
        events.push(step.kind === 'advance' ? step.event.kind : step.kind);
        return 'progress';
      },
      record: async (_job, event) => {
        events.push(event.kind);
        return options.rotated ? 'idle' : 'failure';
      },
    },
  });
  const selected = {
    ...request(pass('verify-head')),
    ...(options.invalidClaim ? { claimId: 'invalid' } : {}),
  };
  return { run: () => deliver(selected), writes, events };
}

test('an incomplete HEAD retains independently owned facts without any invoice pass advancement', async () => {
  const fixture = build([member, { id: 'inpay_incomplete' }]);
  const result = await fixture.run();
  assert({
    given:
      'one fully verified owned payment and one incomplete sibling in the same actual reader response',
    should:
      'persist the owned fact through the independent fenced writer and fail the page without cursor or coverage relief',
    actual: [result, fixture.writes, fixture.events],
    expected: [
      'failure',
      [{ userId: 'u'.repeat(24), ids: [member.id], kinds: ['verified'] }],
      ['failure'],
    ],
  });
});
test('foreign-only and malformed-only HEAD members cannot become writes or coverage', async () => {
  const results = [];
  for (const data of [
    [{ ...member, invoice: { ...member.invoice, customer: 'cus_foreign' } }],
    [{ id: 'inpay_incomplete' }],
  ]) {
    const fixture = build(data);
    results.push([await fixture.run(), fixture.writes, fixture.events]);
  }
  assert({
    given: 'no independently normalized owned member',
    should: 'preserve the failure/no-write/no-receipt boundary',
    actual: results,
    expected: [
      ['failure', [], ['failure']],
      ['failure', [], ['failure']],
    ],
  });
});
test('an owned HEAD member survives a foreign sibling without inheriting its identity', async () => {
  const fixture = build([
    member,
    {
      ...member,
      id: 'inpay_foreign',
      invoice: { ...member.invoice, customer: 'cus_foreign' },
    },
  ]);
  assert({
    given: 'an independently owned payment beside a foreign payment',
    should:
      'retain only the owned identity and preserve failure with no pass advancement',
    actual: [await fixture.run(), fixture.writes, fixture.events],
    expected: [
      'failure',
      [{ userId: 'u'.repeat(24), ids: [member.id], kinds: ['verified'] }],
      ['failure'],
    ],
  });
});
test('a complete HEAD still reaches its atomic pass writer rather than partial retention', async () => {
  const fixture = build([member]);
  const result = await fixture.run();
  assert({
    given: 'one complete owned HEAD',
    should: 'preserve the existing current-pass path',
    actual: [result, fixture.writes, fixture.events],
    expected: ['progress', [], ['head']],
  });
});
test('partial retention refusal cannot mutate the current claim or advance coverage', async () => {
  const fixture = build([member, { id: 'inpay_incomplete' }], { refuse: true });
  const result = await fixture.run();
  assert({
    given:
      'the independent writer refuses the owned-looking batch under its current binding checks',
    should: 'leave both claim and pass unchanged',
    actual: [result, fixture.writes.length, fixture.events],
    expected: ['idle', 1, []],
  });
});
test('a partial writer failure propagates and shutdown or malformed claim admits no write', async () => {
  const error = Error('Controlled database refusal');
  const failed = build([member, { id: 'inpay_incomplete' }], { error });
  let observed: unknown;
  try {
    await failed.run();
  } catch (cause) {
    observed = cause;
  }
  const stopped = build([member, { id: 'inpay_incomplete' }], {
    stopAfterRead: true,
  });
  const malformed = build([member, { id: 'inpay_incomplete' }], {
    invalidClaim: true,
  });
  assert({
    given:
      'an actual persistence failure, stopped delivery and invalid claim identity',
    should:
      'propagate the exact failure and preserve authority refusals without fabricated progress',
    actual: [
      observed === error,
      failed.events,
      await stopped.run(),
      stopped.writes,
      stopped.events,
      await malformed.run(),
      malformed.writes,
    ],
    expected: [true, [], 'idle', [], [], 'failure', []],
  });
});

test('a new partial fact may reopen cleanup but cannot consume its replacement job with the old claim', async () => {
  const fixture = build([member, { id: 'inpay_incomplete' }], {
    rotated: true,
  });
  const result = await fixture.run();
  assert({
    given:
      'the fenced writer atomically reopened cleanup and the old failure reply is now stale',
    should:
      'report retained knowledge without any pass step or replacement-claim mutation',
    actual: [result, fixture.writes.length, fixture.events],
    expected: ['reopened', 1, ['failure']],
  });
});
