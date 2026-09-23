import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { closeResources } from './resources';

setupRitewayBun();

const savedState = Reflect.get(globalThis, 'daisyRealtimeResources');

describe('process resources shutdown', () => {
  test('resolves without draining when no resources exist', async () => {
    Reflect.deleteProperty(globalThis, 'daisyRealtimeResources');

    let drained = false;
    const restored = closeResources().then(() => {
      drained = true;
    });
    await restored;

    assert({
      given: 'a process that never created resources',
      should: 'resolve without touching any connections',
      actual: drained,
      expected: true,
    });
  });

  test('marks the process draining and closes pools exactly once', async () => {
    let closedConnections = 0;
    Reflect.set(globalThis, 'daisyRealtimeResources', {
      draining: false,
      database: {
        close: async () => {
          closedConnections += 1;
        },
      },
      redis: {
        close: async () => {
          closedConnections += 1;
        },
      },
    });
    await closeResources();
    const { daisyRealtimeResources } = globalThis as typeof globalThis & {
      daisyRealtimeResources?: { draining: boolean };
    };

    assert({
      given: 'a process holding pooled resources',
      should: 'flag draining and close every pool',
      actual: {
        draining: daisyRealtimeResources?.draining,
        closedConnections,
      },
      expected: { draining: true, closedConnections: 2 },
    });
  });

  test('leaves the previous resources state as it found it', () => {
    Reflect.set(globalThis, 'daisyRealtimeResources', savedState);

    assert({
      given: 'the end of the resource shutdown suite',
      should: 'restore any pre-existing process state',
      actual: Reflect.get(globalThis, 'daisyRealtimeResources') === savedState,
      expected: true,
    });
  });
});
