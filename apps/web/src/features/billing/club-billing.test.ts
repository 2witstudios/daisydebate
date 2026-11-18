import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatChangeKey } from './club-billing';

setupRitewayBun();

test('every Stripe seat change carries its own idempotency key', () => {
  const key = (nonce: string) =>
    seatChangeKey({ subscriptionId: 'sub_1', from: 5, to: 6, nonce });
  assert({
    given:
      'the same 5→6 change submitted twice (a recurring change, or a retry after a declined card)',
    should: 'send distinct keys, so Stripe never replays an earlier answer',
    actual: key('a'.repeat(24)) === key('b'.repeat(24)),
    expected: false,
  });
});
