import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  closurePaymentDisposition,
  refundActionSchema,
  mayDispatchRefund,
} from './billing-refund';
import { advanceRefund, nextRefundWork } from './billing-refund-lifecycle';
import {
  at,
  first,
  action,
  context,
  changed,
} from './billing-refund.test-support';
setupRitewayBun();
test('refund eligibility uses verified payment chronology, preserving second-resolution ambiguity', () => {
  const paidAt = Date.parse(at(0)) / 1000;
  assert({
    given:
      'a payment second wholly before/after closure, overlapping closure, unknown, or in the future',
    should:
      'refund only verified after-closure payment and leave ambiguity unresolved',
    actual: [
      closurePaymentDisposition({
        closedAt: at(0),
        paidAtSeconds: paidAt - 1,
        now: at(2),
      }),
      closurePaymentDisposition({
        closedAt: at(0),
        paidAtSeconds: paidAt,
        now: at(2),
      }),
      closurePaymentDisposition({
        closedAt: at(0),
        paidAtSeconds: paidAt + 1,
        now: at(2),
      }),
      closurePaymentDisposition({
        closedAt: at(0.5),
        paidAtSeconds: paidAt,
        now: at(2),
      }),
      closurePaymentDisposition({
        closedAt: at(0),
        paidAtSeconds: null,
        now: at(2),
      }),
      closurePaymentDisposition({
        closedAt: at(0),
        paidAtSeconds: paidAt + 3,
        now: at(2),
      }),
    ],
    expected: [
      'pre-closure',
      'unresolved',
      'refund',
      'unresolved',
      'unresolved',
      'unresolved',
    ],
  });
});

test('refund facts refuse invalid chronology and impossible authority states', () => {
  const valid = action();
  const claimed = changed(valid, { kind: 'claim', claimId: first }, 3);
  assert({
    given:
      'pre-closure payment, future admission, malformed time, active authority or an impossible ready claim',
    should: 'authorize no refund and admit no contradictory stored state',
    actual: [
      refundActionSchema.safeParse({
        ...valid,
        paidAtSeconds: Date.parse(at(-1)) / 1000,
      }).success,
      nextRefundWork(valid, context(1)),
      closurePaymentDisposition({
        closedAt: 'invalid',
        paidAtSeconds: 1,
        now: at(3),
      }),
      advanceRefund(
        claimed,
        {
          kind: 'observe',
          claimId: first,
          refundId: 're_original',
          status: 'succeeded',
        },
        { now: at(4), authority: 'denied' },
      ),
      refundActionSchema.safeParse({ ...valid, claim: claimed.claim }).success,
    ],
    expected: [false, 'refuse', 'unresolved', { kind: 'refuse' }, false],
  });
});

test('recorded equal-second financial facts remain readable without renewed creation authority', () => {
  const original = action();
  const boundary = {
    ...original,
    paidAtSeconds: Date.parse(original.closedAt) / 1000,
  };
  const before = changed(original, { kind: 'claim', claimId: first }, 3);
  const possible = { ...before, paidAtSeconds: boundary.paidAtSeconds };
  const known = {
    ...boundary,
    state: {
      kind: 'known' as const,
      startedAt: at(3),
      refundId: 're_original',
      status: 'succeeded' as const,
      observedAt: at(4),
    },
  };
  assert({
    given:
      'a retained current token for a prior possible call at the ambiguous boundary',
    should:
      'deny another vendor dispatch while retaining honest accounting of its eventual result',
    actual: [
      mayDispatchRefund(possible, first, context(4)),
      advanceRefund(
        possible,
        {
          kind: 'observe',
          claimId: first,
          refundId: 're_retained',
          status: 'pending',
        },
        context(4),
      ).kind,
    ],
    expected: [false, 'changed'],
  });
  assert({
    given:
      'original boundary facts with no dispatch, possible execution, or an already known refund',
    should:
      'preserve truth and routing while refusing any new create and allowing later discovery/retrieval',
    actual: [
      refundActionSchema.safeParse(boundary).success,
      nextRefundWork(boundary, context(3)),
      nextRefundWork({ ...possible, claim: null }, context(40)),
      nextRefundWork({ ...possible, claim: null }, context(304)),
      nextRefundWork(known, context(5)),
    ],
    expected: [true, 'refuse', 'wait', 'discover', 'retrieve'],
  });
});
