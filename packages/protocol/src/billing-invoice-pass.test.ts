import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advanceInvoicePass,
  startInvoicePass,
} from './billing-invoice-pass-lifecycle';
import { invoicePassSchema } from './billing-invoice-pass';
import {
  owner,
  authority,
  read,
  row,
  witness,
  must,
  passWith,
  head,
  invoice,
} from './billing-invoice-pass.test-support';
setupRitewayBun();

test('only full fresh HEAD membership plus retained evidence and a later current owned invoice can cover exact enumeration', () => {
  const pass = passWith(2),
    ctx = authority(3),
    values = [read(1), read(2)],
    rows = values.map((value) => row(value, ctx));
  const before = JSON.stringify(rows);
  const verified = must(
    advanceInvoicePass(
      pass,
      { kind: 'head', receipt: head(pass, values, ctx), retained: rows },
      ctx,
    ),
  );
  const final = authority(4),
    result = advanceInvoicePass(
      verified,
      {
        kind: 'invoice',
        receipt: invoice(verified, final),
        observation: witness(final),
      },
      final,
    );
  assert({
    given:
      'two honest unknown payment obligations retained before a fresh complete unfiltered HEAD and subsequent owned invoice read',
    should:
      'cover membership only while leaving every financial unknown untouched',
    actual: [
      verified.phase,
      result.kind,
      result.kind === 'covered' && result.coverage,
      JSON.stringify(rows),
      rows.map((value) => value.state.kind),
    ],
    expected: [
      'verify-invoice',
      'covered',
      {
        kind: 'complete',
        mode: owner.mode,
        customerId: owner.customerId,
        invoiceId: owner.invoiceId,
        paymentCount: 2,
        lastPaymentId: 'inpay_2',
      },
      before,
      ['owed', 'owed'],
    ],
  });
});

test('same first/count/last cannot hide changed middle membership or changed positive evidence', () => {
  const pass = passWith(3),
    ctx = authority(4);
  const changedId = [read(1), read(4), read(3)];
  const middle = read(2);
  if (middle.evidence.kind !== 'partial')
    throw Error('Expected partial fixture');
  const changedFacts = [
    read(1),
    {
      ...read(2),
      evidence: {
        kind: 'partial' as const,
        facts: {
          ...middle.evidence.facts,
          status: 'open' as const,
          paidAtSeconds: null,
          amountPaidMinor: 0,
          charge: { kind: 'unresolved' as const },
          period: null,
        },
      },
    },
    read(3),
  ];
  const results = [changedId, changedFacts].map((values) =>
    advanceInvoicePass(
      pass,
      {
        kind: 'head',
        receipt: head(pass, values, ctx),
        retained: values.map((value) => row(value, ctx)),
      },
      ctx,
    ),
  );
  assert({
    given:
      'a changed middle payment ID or positive allocation/status with identical first/last/count',
    should:
      'retain owned facts but defer coverage instead of accepting a tuple or cached witness',
    actual: results.map((result) => result.kind === 'defer' && result.reason),
    expected: ['membership_changed', 'membership_changed'],
  });
});

test('filtered/stale/wrong-pass receipts and missing retained facts refuse; empty or multipage HEAD cannot prove coverage', () => {
  const pass = passWith(2),
    ctx = authority(3),
    values = [read(1), read(2)],
    receipt = head(pass, values, ctx),
    rows = values.map((value) => row(value, ctx));
  const invalid = [
    { ...receipt, request: { ...receipt.request, startingAfter: null } },
    { ...receipt, passId: 'x'.repeat(24) },
    { ...receipt, claimId: 'x'.repeat(24) },
    { ...receipt, startedAt: authority(0).now },
    receipt,
  ];
  const invalidResults = invalid.map((value, index) =>
    advanceInvoicePass(
      pass,
      { kind: 'head', receipt: value, retained: index === 4 ? [] : rows },
      ctx,
    ),
  );
  const empty = advanceInvoicePass(
    pass,
    { kind: 'head', receipt: { ...receipt, reads: [] }, retained: [] },
    ctx,
  );
  const more = advanceInvoicePass(
    pass,
    { kind: 'head', receipt: { ...receipt, hasMore: true }, retained: rows },
    ctx,
  );
  assert({
    given: 'no source snapshot guarantee and an exact currently claimed pass',
    should:
      'refuse filtered/replayed/unretained proof and keep zero or larger membership owed',
    actual: [
      invalidResults.map((result) => result.kind),
      empty.kind === 'defer' && empty.reason,
      more.kind === 'defer' && more.reason,
    ],
    expected: [
      invalid.map(() => 'refuse'),
      'zero_membership',
      'multipage_continuity',
    ],
  });
});

test('comparison overflow never stops retaining later obligations and never invents larger automatic completion', () => {
  const pass = passWith(25),
    ctx = authority(26),
    values = Array.from({ length: 20 }, (_, index) => read(index + 1));
  const result = advanceInvoicePass(
    pass,
    {
      kind: 'head',
      receipt: { ...head(pass, values, ctx), hasMore: true },
      retained: values.map((value) => row(value, ctx)),
    },
    ctx,
  );
  assert({
    given:
      'twenty-five atomically retained payment steps with only a bounded comparison prefix',
    should:
      'advance every cursor beyond the window, keep exact prefix/count and leave multipage continuity unresolved without eviction',
    actual: [
      pass.phase,
      pass.afterId,
      pass.comparison.kind,
      pass.comparison.kind === 'overflow' && pass.comparison.retainedCount,
      pass.comparison.kind === 'overflow' &&
        pass.comparison.prefix.map((value) => value.invoicePaymentId),
      result.kind === 'defer' && result.reason,
    ],
    expected: [
      'verify-head',
      'inpay_25',
      'overflow',
      25,
      values.map((value) => value.invoicePaymentId),
      'multipage_continuity',
    ],
  });
});

test('changed final invoice, stale receipt and impossible cached final HEAD never create coverage', () => {
  const pass = passWith(1),
    ctx = authority(2),
    values = [read(1)],
    verified = must(
      advanceInvoicePass(
        pass,
        {
          kind: 'head',
          receipt: head(pass, values, ctx),
          retained: values.map((value) => row(value, ctx)),
        },
        ctx,
      ),
    );
  const final = authority(3),
    proof = invoice(verified, final);
  const changed = {
    ...proof,
    owner: {
      ...proof.owner,
      period: { ...owner.period!, endsAt: '2027-01-01T00:00:00.000Z' },
    },
  };
  const result = advanceInvoicePass(
    verified,
    { kind: 'invoice', receipt: changed, observation: witness(final) },
    final,
  );
  const stale = advanceInvoicePass(
    verified,
    {
      kind: 'invoice',
      receipt: { ...proof, startedAt: authority(0).now },
      observation: witness(authority(0)),
    },
    final,
  );
  const broken =
    verified.phase === 'verify-invoice'
      ? invoicePassSchema.safeParse({
          ...verified,
          head: { ...verified.head, hasMore: true },
        }).success
      : true;
  const empty = must(startInvoicePass('i'.repeat(24), owner, authority()));
  const zero = advanceInvoicePass(
    empty,
    { kind: 'exhausted', beforeId: null },
    authority(1),
  );
  assert({
    given:
      'freshness and frozen binding are separate from a prior matching head',
    should:
      'keep changed/unknown membership owed and reject stale or impossible coverage authority',
    actual: [
      result.kind === 'defer' && result.reason,
      stale.kind,
      broken,
      zero.kind === 'defer' && zero.reason,
    ],
    expected: ['invoice_changed', 'refuse', false, 'zero_membership'],
  });
});
