import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cancelMediaWork } from './cancel-media-work';
import { trackedSignal } from './media-controller.test-support';
setupRitewayBun();

test('every settlement path removes its abort listener', async () => {
  const paths: Record<string, () => Promise<unknown>> = {
    resolved: async () => 'done',
    rejected: async () => {
      throw new Error('Refused');
    },
    thrown: () => {
      throw new Error('Thrown');
    },
  };
  const results = [];
  for (const work of Object.values(paths)) {
    const tracked = trackedSignal();
    await cancelMediaWork(tracked.signal, work).catch(() => undefined);
    results.push(tracked.listening());
  }
  const tracked = trackedSignal();
  const pending = cancelMediaWork(
    tracked.signal,
    () => new Promise(() => undefined),
  ).catch(() => 'cancelled');
  tracked.abort();
  results.push(await pending, tracked.listening());
  assert({
    given: 'work that resolves, rejects, throws or is cancelled',
    should: 'settle and leave no listener on the signal',
    actual: results,
    expected: [0, 0, 0, 'cancelled', 0],
  });
});
