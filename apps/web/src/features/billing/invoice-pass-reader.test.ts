import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createInvoicePassReader } from './invoice-pass-reader';
import {
  facts,
  member,
  claimId,
  pass,
  clock,
} from './invoice-pass-reader.test-support';
import type { InvoicePassReadPort } from './invoice-pass-vendor';

setupRitewayBun();
const page = (data: unknown[], more = false) => ({
  object: 'list',
  data,
  has_more: more,
});
const build = (
  payments: InvoicePassReadPort['payments'],
  invoice = async () => facts.invoice,
) =>
  createInvoicePassReader({ mode: 'test', clock, port: { payments, invoice } });

test('retention reads one exact invoice member; final HEAD is a new unfiltered bounded request', async () => {
  const requests: unknown[] = [];
  const reader = build(async (request) => {
    requests.push(request);
    return page([member]);
  });
  const retained = await reader(pass('retaining'), claimId);
  const head = await reader(pass('verify-head'), claimId);
  assert({
    given:
      'one current selected invoice in retention followed by final membership verification',
    should:
      'issue separate exact-invoice requests and retain the whole HEAD evidence without claiming coverage',
    actual: {
      requests,
      retained: retained.kind === 'advance' && retained.event.kind,
      head: head.kind === 'advance' &&
        head.event.kind === 'head' && {
          count: head.event.receipt.reads.length,
          more: head.event.receipt.hasMore,
          id: head.event.receipt.reads[0]?.invoicePaymentId,
        },
    },
    expected: {
      requests: [
        { invoice: facts.invoice.id, limit: 1 },
        { invoice: facts.invoice.id, limit: 20 },
      ],
      retained: 'retained',
      head: { count: 1, more: false, id: member.id },
    },
  });
});

test('empty and multipage HEAD retain their actual uncertainty', async () => {
  const empty = await build(async () => page([]))(pass('verify-head'), claimId);
  const more = await build(async () => page([member], true))(
    pass('verify-head'),
    claimId,
  );
  assert({
    given: 'zero membership and a non-exhausted final HEAD response',
    should:
      'report the actual receipts so pure admission defers instead of inventing complete membership',
    actual: [
      empty.kind === 'advance' &&
        empty.event.kind === 'head' &&
        empty.event.receipt.reads.length,
      more.kind === 'advance' &&
        more.event.kind === 'head' &&
        more.event.receipt.hasMore,
    ],
    expected: [0, true],
  });
});

test('a current invoice read preserves changed period and refuses foreign ownership or failed transport', async () => {
  const changed = structuredClone(facts.invoice);
  changed.lines.data[0]!.period.end += 10;
  const period = await build(
    async () => {
      throw new Error('Unexpected list');
    },
    async () => changed,
  )(pass('verify-invoice'), claimId);
  const foreign = await build(
    async () => page([]),
    async () => ({ ...facts.invoice, customer: 'cus_foreign' }),
  )(pass('verify-invoice'), claimId);
  const failed = await build(
    async () => page([]),
    async () => {
      throw new Error('Controlled read failure');
    },
  )(pass('verify-invoice'), claimId);
  assert({
    given:
      'a changed current period, foreign customer and failed current invoice read',
    should:
      'preserve new period evidence for deferral and supply no successful invoice receipt for either refusal',
    actual: [
      period.kind === 'advance' &&
        period.event.kind === 'invoice' &&
        period.event.receipt.owner.period?.endsAt,
      foreign,
      failed,
    ],
    expected: [
      new Date(changed.lines.data[0]!.period.end * 1000).toISOString(),
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('a duplicate, foreign or malformed list member cannot supply a final receipt', async () => {
  const results = await Promise.all(
    [
      [member, member],
      [{ ...member, invoice: { ...facts.invoice, customer: 'cus_foreign' } }],
      [{ id: member.id }],
    ].map((data) =>
      build(async () => page(data))(pass('verify-head'), claimId),
    ),
  );
  assert({
    given:
      'duplicate identities, foreign expanded invoice ownership or an incomplete response',
    should:
      'refuse each receipt while retaining independently owned duplicate facts and never classifying an obligation as resolved',
    actual: results.map((result) =>
      result.kind === 'incomplete'
        ? {
            kind: result.kind,
            ids: result.reads.map((read) => read.invoicePaymentId),
          }
        : result,
    ),
    expected: [
      { kind: 'incomplete', ids: [member.id, member.id] },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});
