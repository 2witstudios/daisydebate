import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advanceInvoicePass,
  startInvoicePass,
} from './billing-invoice-pass-lifecycle';
import {
  owner,
  authority,
  read,
  row,
  passWith,
  invoice,
  witness,
  must,
  head,
} from './billing-invoice-pass.test-support';
setupRitewayBun();

test('unknown frozen source cannot cover and final period disagreement defers only after retaining the actual positive fact', () => {
  const source = {
    kind: 'unresolved' as const,
    vendorSubscriptionId: null,
    priceId: null,
  };
  const unknownOwner = { ...owner, source, period: null };
  const value = { ...read(1), source };
  const initial = must(
    startInvoicePass('i'.repeat(24), unknownOwner, authority()),
  );
  const retained = must(
    advanceInvoicePass(
      initial,
      {
        kind: 'retained',
        beforeId: null,
        read: value,
        observation: row(value, authority(1)),
        more: false,
      },
      authority(1),
    ),
  );
  const ctx = authority(2),
    unknown = advanceInvoicePass(
      retained,
      {
        kind: 'head',
        receipt: head(retained, [value], ctx),
        retained: [row(value, ctx)],
      },
      ctx,
    );
  const base = read(1);
  if (base.evidence.kind !== 'partial')
    throw Error('Expected partial financial fixture');
  const changed = {
    ...base,
    evidence: {
      kind: 'partial' as const,
      facts: {
        ...base.evidence.facts,
        period: { ...owner.period!, endsAt: '2027-01-01T00:00:00.000Z' },
      },
    },
  };
  const started = must(startInvoicePass('i'.repeat(24), owner, authority()));
  const period = advanceInvoicePass(
    started,
    {
      kind: 'retained',
      beforeId: null,
      read: changed,
      observation: row(changed, authority(1)),
      more: false,
    },
    authority(1),
  );
  const unretained = advanceInvoicePass(
    retained,
    {
      kind: 'head',
      receipt: { ...head(retained, [value], ctx), hasMore: true },
      retained: [],
    },
    ctx,
  );
  assert({
    given:
      'an unknown original offer/period, a changed positive invoice period, or a multipage response with missing retained IDs',
    should:
      'never invent current offer or coverage and never advance unsupported membership past unretained facts',
    actual: [
      unknown.kind === 'defer' && unknown.reason,
      period.kind === 'defer' && period.reason,
      unretained.kind,
    ],
    expected: ['source_unknown', 'source_changed', 'refuse'],
  });
});

test('fresh reads can reuse unchanged durable knowledge without refreshing recognition time', () => {
  const pass = passWith(1),
    ctx = authority(2),
    value = read(1);
  const verified = must(
    advanceInvoicePass(
      pass,
      {
        kind: 'head',
        receipt: head(pass, [value], ctx),
        retained: [row(value, authority(0))],
      },
      ctx,
    ),
  );
  const final = authority(3);
  const result = advanceInvoicePass(
    verified,
    {
      kind: 'invoice',
      receipt: invoice(verified, final),
      observation: witness(authority(0)),
    },
    final,
  );
  const future = advanceInvoicePass(
    pass,
    {
      kind: 'head',
      receipt: head(pass, [value], ctx),
      retained: [row(value, authority(9))],
    },
    ctx,
  );
  assert({
    given:
      'fresh claim-bound producer reads and matching older unchanged retained rows, or a future-dated row',
    should:
      'accept current retained knowledge without recognition churn and reject impossible future knowledge',
    actual: [result.kind, future.kind],
    expected: ['covered', 'refuse'],
  });
});

test('a sparse new read cannot hide a retained original period contradiction', () => {
  const pass = passWith(1),
    ctx = authority(2),
    value = read(1),
    prior = row(value, ctx);
  if (
    prior.kind !== 'payment' ||
    prior.state.kind !== 'owed' ||
    prior.state.evidence.kind !== 'partial'
  )
    throw Error('Expected partial payment fixture');
  const known = {
    ...prior,
    state: {
      ...prior.state,
      evidence: {
        ...prior.state.evidence,
        facts: {
          ...prior.state.evidence.facts,
          period: { ...owner.period!, endsAt: '2027-01-01T00:00:00.000Z' },
        },
      },
    },
  };
  const result = advanceInvoicePass(
    pass,
    { kind: 'head', receipt: head(pass, [value], ctx), retained: [known] },
    ctx,
  );
  assert({
    given:
      'an unchanged sparse HEAD member and positive retained period different from the frozen pass',
    should:
      'keep the original period independently owed and refuse enumeration coverage',
    actual: result.kind === 'defer' && result.reason,
    expected: 'conflicting_evidence',
  });
});
