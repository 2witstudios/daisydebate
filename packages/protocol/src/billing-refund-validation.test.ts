import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  closurePaymentDisposition,
  refundActionSchema,
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
