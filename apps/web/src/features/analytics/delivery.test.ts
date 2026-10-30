import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAnalyticsDelivery } from './delivery';

setupRitewayBun();
test('analytics delivery is bounded and shutdown discards waiting optional work', async () => {
  const seen: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = createAnalyticsDelivery({
    deliver: async (message) => {
      seen.push(message.userId);
      await held;
    },
    maxRunning: 1,
    maxQueued: 1,
  });
  const message = {
    userId: 'u'.repeat(24),
    consent: {
      version: 1,
      necessary: 'granted',
      analytics: 'granted',
      replay: 'unanswered',
    },
    productEvent: { event: 'room_created', properties: {} },
  } as const;
  assert({
    given: 'a vendor call that has not completed',
    should:
      'accept bounded optional work without awaiting the vendor and shed excess',
    actual: [
      queue.enqueue(message),
      queue.enqueue(message),
      queue.enqueue(message),
    ],
    expected: [true, true, false],
  });
  const closing = queue.close();
  release();
  await closing;
  assert({
    given: 'shutdown with queued work',
    should:
      'finish the in-flight call, discard waiting work and refuse new work',
    actual: [seen.length, queue.enqueue(message)],
    expected: [1, false],
  });
});
