import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advanceInvoiceIdentityDebt,
  invoiceIdentityDebtSchema,
  nextInvoiceIdentity,
  retainInvoiceIdentities,
} from './billing-invoice-identity-debt';

setupRitewayBun();
test('rotation merges exact known identities without eviction, fabricated routing or fresh authority', () => {
  const debt = retainInvoiceIdentities({ kind: 'none' }, [
    'in_first',
    'in_rest',
  ])!;
  assert({
    given:
      'an unresolved selected invoice and its nonempty remainder carried across repeated rotations',
    should: 'preserve every identity once without changing its next turn',
    actual: retainInvoiceIdentities(debt, ['in_rest', 'in_later']),
    expected: {
      kind: 'owed',
      ids: ['in_first', 'in_rest', 'in_later'],
      next: 'identity',
    },
  });
});
test('permanent unknown identity yields to observations and later identities instead of starving them', () => {
  const debt = retainInvoiceIdentities({ kind: 'none' }, [
    'in_first',
    'in_rest',
  ])!;
  const failed = advanceInvoiceIdentityDebt(debt, {
    kind: 'identity-failed',
    id: 'in_first',
  })!;
  const observed = advanceInvoiceIdentityDebt(failed, {
    kind: 'observation-step',
  })!;
  assert({
    given:
      'one unavailable invoice route and separately retained observation work',
    should:
      'retain the unavailable identity, run observation work next, then try the next identity',
    actual: [
      failed,
      nextInvoiceIdentity(failed, false),
      nextInvoiceIdentity(observed, false),
      nextInvoiceIdentity(failed, true),
    ],
    expected: [
      { kind: 'owed', ids: ['in_rest', 'in_first'], next: 'observations' },
      null,
      'in_rest',
      'in_rest',
    ],
  });
});
test('only exact positive retention removes identity debt; unrelated identities refuse', () => {
  const debt = retainInvoiceIdentities({ kind: 'none' }, ['in_first'])!;
  assert({
    given: 'a sole exact unresolved invoice identity',
    should: 'refuse a foreign step and remove only the exact retained identity',
    actual: [
      advanceInvoiceIdentityDebt(debt, {
        kind: 'identity-retained',
        id: 'in_foreign',
      }),
      advanceInvoiceIdentityDebt(debt, {
        kind: 'identity-retained',
        id: 'in_first',
      }),
    ],
    expected: [null, { kind: 'none' }],
  });
});
test('retained identity debt has no capped eviction, while predecessor input and shape remain strict', () => {
  const existing = Array.from({ length: 21 }, (_, n) => `in_prior${n}`);
  const debt = retainInvoiceIdentities(
    { kind: 'owed', ids: existing, next: 'identity' },
    ['in_new'],
  )!;
  assert({
    given:
      'more than one historical frame worth of retained identities and malformed/oversized new frames',
    should:
      'retain every existing identity and reject invalid frames without silently truncating them',
    actual: [
      debt.kind === 'owed' && debt.ids.length,
      retainInvoiceIdentities({ kind: 'none' }, existing),
      retainInvoiceIdentities({ kind: 'none' }, ['cus_foreign']),
      invoiceIdentityDebtSchema.safeParse({
        kind: 'owed',
        ids: ['in_first', 'in_first'],
        next: 'identity',
      }).success,
    ],
    expected: [22, null, null, false],
  });
});
