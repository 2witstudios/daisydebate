import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatChangeKey } from './club-billing';

setupRitewayBun();

test('a recurring seat transition gets a new idempotency key; a retry keeps its own', () => {
  const key = (latestInvoice: string | null, from: number, to: number) =>
    seatChangeKey({ subscriptionId: 'sub_1', latestInvoice, from, to });
  // 5→6 (paid, invoice in_a), 6→5 (no invoice), then 5→6 again.
  const first = key('in_0', 5, 6);
  const back = key('in_a', 6, 5);
  const again = key('in_a', 5, 6);
  assert({
    given: '5→6, 6→5, then 5→6 within a day, and a retry of the first submit',
    should: 'give the repeated 5→6 its own key and the retry the same one',
    actual: [first === again, first === key('in_0', 5, 6), back !== first],
    expected: [false, true, true],
  });
});
